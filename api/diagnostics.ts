import { timingSafeEqual } from "node:crypto";
import { get, list, put } from "@vercel/blob";
import {
  DIAGNOSTICS_KEY_HEADER,
  type DiagnosticsMessage,
  MAX_DIAGNOSTICS_BYTES,
  parseDiagnosticsMessage,
} from "../app/shared/diagnostics.js";
import type { SenderAnnouncement } from "../app/shared/telemetry.js";

// Deployed counterpart of the dev-server collector in vite.config.ts, backed by a private Vercel Blob store.

const REPORT_NAME = /^farol-report-[\w-]+\.json$/;
const NO_STORE = { "cache-control": "private, no-store" };

function status(code: number): Response {
  return new Response(null, { status: code, headers: NO_STORE });
}

/** Shared key in constant time; without DIAGNOSTICS_KEY configured the endpoint stays closed. */
function authorized(request: Request): boolean {
  const expected = Buffer.from(process.env.DIAGNOSTICS_KEY ?? "");
  const given = Buffer.from(request.headers.get(DIAGNOSTICS_KEY_HEADER) ?? "");
  return expected.length > 0 && expected.length === given.length && timingSafeEqual(expected, given);
}

const senderPath = (sessionId: number): string => `senders/${sessionId}.json`;

async function readSender(sessionId: number): Promise<SenderAnnouncement | null> {
  const result = await get(senderPath(sessionId), { access: "private", useCache: false });
  return result?.statusCode === 200 ? ((await new Response(result.stream).json()) as SenderAnnouncement) : null;
}

async function write(pathname: string, value: unknown, allowOverwrite = false): Promise<void> {
  await put(pathname, JSON.stringify(value, null, 2) + "\n", {
    access: "private",
    contentType: "application/json",
    allowOverwrite,
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) return status(401);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return status(415);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_DIAGNOSTICS_BYTES) return status(413);
  const body = await request.text();
  if (body.length > MAX_DIAGNOSTICS_BYTES) return status(413);

  let message: DiagnosticsMessage | null;
  try {
    message = parseDiagnosticsMessage(JSON.parse(body));
  } catch {
    message = null;
  }
  if (!message) return status(400);

  if (message.kind === "sender-announce") {
    await write(senderPath(message.announcement.sessionId), { ...message.announcement, stalls: 0 }, true);
  } else if (message.kind === "sender-stall") {
    const sender = await readSender(message.sessionId);
    if (sender) await write(senderPath(message.sessionId), { ...sender, stalls: (sender.stalls ?? 0) + 1 }, true);
  } else {
    const sender = await readSender(message.report.sessionId);
    const name = `farol-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await write(`reports/${name}`, sender ? { ...message.report, sender } : message.report);
  }
  return status(204);
}

/** No query: the stored report names. `?name=`: that report — what `npm run reports:pull` downloads. */
export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) return status(401);
  const name = new URL(request.url).searchParams.get("name");
  if (name !== null) {
    if (!REPORT_NAME.test(name)) return status(400);
    const result = await get(`reports/${name}`, { access: "private" });
    if (result?.statusCode !== 200) return status(404);
    return new Response(result.stream, {
      headers: { ...NO_STORE, "content-type": "application/json", "x-content-type-options": "nosniff" },
    });
  }

  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: "reports/", cursor });
    names.push(...page.blobs.map((blob) => blob.pathname.slice("reports/".length)));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return Response.json({ names }, { headers: NO_STORE });
}
