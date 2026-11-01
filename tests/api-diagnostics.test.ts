import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransferReport } from "../app/shared/telemetry.js";

const store = vi.hoisted(() => new Map<string, string>());
vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string, body: string, options: { allowOverwrite?: boolean }) => {
    if (store.has(pathname) && !options.allowOverwrite) throw new Error("blob already exists");
    store.set(pathname, body);
  }),
  get: vi.fn(async (pathname: string) => {
    const body = store.get(pathname);
    return body === undefined ? null : { statusCode: 200, stream: new Response(body).body };
  }),
  list: vi.fn(async ({ prefix }: { prefix: string }) => ({
    blobs: [...store.keys()].filter((pathname) => pathname.startsWith(prefix)).map((pathname) => ({ pathname })),
    hasMore: false,
  })),
}));

const { GET, POST } = await import("../api/diagnostics.js");

const KEY = "segredo-de-teste";
const report: TransferReport = {
  startedAt: "2026-10-31T23:00:00.000Z",
  durationSeconds: 25,
  complete: true,
  progress: 1,
  fileName: "benchmark-1mb.bin",
  fileBytes: 1048576,
  k: 436,
  framesCaptured: 760,
  framesDecoded: 438,
  overhead: 1.005,
  hitRate: 0.58,
  captureFps: 30,
  goodputKBs: 40.9,
  bytesPerFrame: 2431,
  decodeWorkers: 4,
  cameraResolution: "1080x1920",
  userAgent: "UA",
  protocolVersion: 2,
  sessionId: 0x1a2b,
  codesPerFrame: 1,
  payloadBytes: 1048658,
  framesDuplicate: 0,
  framesRedundant: 0,
  seqSpan: 500,
  catchRate: 0.876,
  acquisitionSeconds: 1.1,
  cameraFps: 30,
  decodeResolution: "1080x1920",
  tag: "e1-ios-fps20-r1",
};
const announcement = {
  sessionId: 0x1a2b,
  fileName: "benchmark-1mb.bin",
  fileBytes: 1048576,
  payloadBytes: 1048658,
  k: 436,
  qrVersion: 36,
  ecc: "L",
  codes: 1,
  targetFps: 20,
  displayFps: 20,
  refreshHz: 120,
  userAgent: "UA",
};

function post(message: unknown, key = KEY): Promise<Response> {
  return POST(
    new Request("https://farol.test/api/diagnostics", {
      method: "POST",
      headers: { "content-type": "application/json", "x-farol-key": key },
      body: JSON.stringify(message),
    }),
  );
}

function get(query = "", key = KEY): Promise<Response> {
  return GET(new Request(`https://farol.test/api/diagnostics${query}`, { headers: { "x-farol-key": key } }));
}

describe("api/diagnostics (Vercel collector)", () => {
  beforeEach(() => {
    store.clear();
    vi.stubEnv("DIAGNOSTICS_KEY", KEY);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("stays closed without the right key, and when no key is configured at all", async () => {
    expect((await post({ kind: "sender-stall", sessionId: 1, seconds: 2 }, "errada")).status).toBe(401);
    vi.stubEnv("DIAGNOSTICS_KEY", "");
    expect((await post({ kind: "sender-stall", sessionId: 1, seconds: 2 }, "")).status).toBe(401);
    expect((await get("", "")).status).toBe(401);
    expect(store.size).toBe(0);
  });

  it("rejects malformed messages", async () => {
    expect((await post({ kind: "receiver-report", report: { ...report, k: "436" } })).status).toBe(400);
  });

  it("stores the report merged with the sender's announcement and stalls, then serves it to reports:pull", async () => {
    expect((await post({ kind: "sender-announce", announcement })).status).toBe(204);
    expect((await post({ kind: "sender-stall", sessionId: 0x1a2b, seconds: 1.5 })).status).toBe(204);
    expect((await post({ kind: "receiver-report", report })).status).toBe(204);

    const { names } = (await (await get()).json()) as { names: string[] };
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^farol-report-.+\.json$/);
    const saved = await (await get(`?name=${names[0]}`)).json();
    expect(saved).toEqual({ ...report, sender: { ...announcement, stalls: 1 } });
  });

  it("serves only report names, never arbitrary blob paths", async () => {
    await post({ kind: "sender-announce", announcement });
    expect((await get("?name=../senders/6699.json")).status).toBe(400);
    expect((await get("?name=farol-report-nao-existe.json")).status).toBe(404);
  });
});
