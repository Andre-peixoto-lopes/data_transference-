import type { SenderAnnouncement, TransferReport } from "./telemetry.js";

/**
 * Diagnostics rig: pages POST transfer reports here. The Vite dev server saves them
 * straight into `analysis/reports/` (vite.config.ts); a deployed site stores them in a
 * private Blob store (api/diagnostics.ts), fetched later with `npm run reports:pull`.
 * Either way they are merged with the sender's settings by `sessionId`.
 */
export const DIAGNOSTICS_PATH = "/api/diagnostics";
export const DIAGNOSTICS_KEY_HEADER = "x-farol-key";
export const MAX_DIAGNOSTICS_BYTES = 32 * 1024;
const MAX_STRING_LENGTH = 512;
const KEY_STORAGE = "farol.diagnosticsKey";

export type DiagnosticsMessage =
  | { readonly kind: "receiver-report"; readonly report: TransferReport }
  | { readonly kind: "sender-announce"; readonly announcement: SenderAnnouncement }
  | { readonly kind: "sender-stall"; readonly sessionId: number; readonly seconds: number };

type FieldKind = "number" | "string" | "boolean";

const REPORT_FIELDS: Record<keyof Omit<TransferReport, "sender">, FieldKind> = {
  startedAt: "string",
  durationSeconds: "number",
  complete: "boolean",
  progress: "number",
  fileName: "string",
  fileBytes: "number",
  k: "number",
  framesCaptured: "number",
  framesDecoded: "number",
  overhead: "number",
  hitRate: "number",
  captureFps: "number",
  goodputKBs: "number",
  bytesPerFrame: "number",
  decodeWorkers: "number",
  cameraResolution: "string",
  userAgent: "string",
  protocolVersion: "number",
  sessionId: "number",
  codesPerFrame: "number",
  payloadBytes: "number",
  framesDuplicate: "number",
  framesRedundant: "number",
  seqSpan: "number",
  catchRate: "number",
  acquisitionSeconds: "number",
  cameraFps: "number",
  decodeResolution: "string",
  tag: "string",
};

const SENDER_FIELDS: Record<keyof Omit<SenderAnnouncement, "stalls">, FieldKind> = {
  sessionId: "number",
  fileName: "string",
  fileBytes: "number",
  payloadBytes: "number",
  k: "number",
  qrVersion: "number",
  ecc: "string",
  codes: "number",
  targetFps: "number",
  displayFps: "number",
  refreshHz: "number",
  userAgent: "string",
};

/** Copies exactly the whitelisted, well-typed fields — anything else rejects the message. */
function pick(source: unknown, fields: Record<string, FieldKind>): Record<string, unknown> | null {
  if (typeof source !== "object" || source === null) return null;
  const record = source as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  for (const [name, kind] of Object.entries(fields)) {
    const value = record[name];
    const valid =
      kind === "number"
        ? typeof value === "number" && Number.isFinite(value)
        : kind === "string"
          ? typeof value === "string" && value.length <= MAX_STRING_LENGTH
          : typeof value === "boolean";
    if (!valid) return null;
    clean[name] = value;
  }
  return clean;
}

function isSessionId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff;
}

/** Server-side validation of an untrusted POST body (the dev server may be reachable through a tunnel). */
export function parseDiagnosticsMessage(input: unknown): DiagnosticsMessage | null {
  if (typeof input !== "object" || input === null) return null;
  const message = input as Record<string, unknown>;
  switch (message.kind) {
    case "receiver-report": {
      const report = pick(message.report, REPORT_FIELDS);
      return report && isSessionId(report.sessionId) ? { kind: "receiver-report", report: report as unknown as TransferReport } : null;
    }
    case "sender-announce": {
      const announcement = pick(message.announcement, SENDER_FIELDS);
      return announcement && isSessionId(announcement.sessionId)
        ? { kind: "sender-announce", announcement: announcement as unknown as SenderAnnouncement }
        : null;
    }
    case "sender-stall": {
      const { sessionId, seconds } = message;
      return isSessionId(sessionId) && typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
        ? { kind: "sender-stall", sessionId, seconds }
        : null;
    }
    default:
      return null;
  }
}

/**
 * Browser only. The dev server needs no key (""); a deployed site reports only after
 * `?key=…` was opened once on this device (null = reporting off). The key is kept in
 * localStorage and removed from the address bar.
 */
export function reportingKey(devServer: boolean): string | null {
  if (devServer) return "";
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get("key");
  if (fromUrl) {
    localStorage.setItem(KEY_STORAGE, fromUrl);
    url.searchParams.delete("key");
    history.replaceState(history.state, "", url);
  }
  return fromUrl || localStorage.getItem(KEY_STORAGE);
}

/** Sends a message to the collector; resolves false when there is none (or it refused). */
export async function postDiagnostics(message: DiagnosticsMessage, key: string): Promise<boolean> {
  try {
    const response = await fetch(DIAGNOSTICS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { [DIAGNOSTICS_KEY_HEADER]: key } : {}) },
      body: JSON.stringify(message),
    });
    return response.ok;
  } catch {
    return false;
  }
}
