import { describe, expect, it } from "vitest";
import { parseDiagnosticsMessage } from "./diagnostics.js";
import type { TransferReport } from "./telemetry.js";

const report: TransferReport = {
  startedAt: "2026-10-23T20:00:00.000Z",
  durationSeconds: 7.5,
  complete: true,
  progress: 1,
  fileName: "a.pdf",
  fileBytes: 98693,
  k: 69,
  framesCaptured: 211,
  framesDecoded: 72,
  overhead: 1.04,
  hitRate: 0.34,
  captureFps: 28,
  goodputKBs: 12.8,
  bytesPerFrame: 1465,
  decodeWorkers: 4,
  cameraResolution: "1920x1080",
  userAgent: "UA",
  protocolVersion: 2,
  sessionId: 0x1a2b,
  codesPerFrame: 2,
  payloadBytes: 98800,
  framesDuplicate: 40,
  framesRedundant: 0,
  seqSpan: 90,
  catchRate: 0.8,
  acquisitionSeconds: 1.2,
  cameraFps: 30,
  decodeResolution: "1080x1920",
  tag: "e1-fps24-r1",
};

describe("diagnostics endpoint validation (untrusted POST bodies)", () => {
  it("accepts a well-formed receiver report and keeps only whitelisted fields", () => {
    const parsed = parseDiagnosticsMessage({ kind: "receiver-report", report: { ...report, injected: "<script>" } });
    expect(parsed).toEqual({ kind: "receiver-report", report });
  });

  it("rejects wrong types, non-finite numbers, oversized strings and unknown kinds", () => {
    expect(parseDiagnosticsMessage({ kind: "receiver-report", report: { ...report, k: "69" } })).toBeNull();
    expect(parseDiagnosticsMessage({ kind: "receiver-report", report: { ...report, goodputKBs: Infinity } })).toBeNull();
    expect(parseDiagnosticsMessage({ kind: "receiver-report", report: { ...report, fileName: "x".repeat(600) } })).toBeNull();
    expect(parseDiagnosticsMessage({ kind: "receiver-report", report: { ...report, sessionId: 70000 } })).toBeNull();
    expect(parseDiagnosticsMessage({ kind: "write-file", path: "/etc/passwd" })).toBeNull();
    expect(parseDiagnosticsMessage(null)).toBeNull();
  });

  it("validates stall events", () => {
    expect(parseDiagnosticsMessage({ kind: "sender-stall", sessionId: 7, seconds: 1.5 })).toEqual({
      kind: "sender-stall",
      sessionId: 7,
      seconds: 1.5,
    });
    expect(parseDiagnosticsMessage({ kind: "sender-stall", sessionId: 7, seconds: -1 })).toBeNull();
  });
});
