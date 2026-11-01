/**
 * A reproducible per-transfer report — the unit the Python analysis harness
 * consumes. One JSON file is produced each time the receiver completes a file.
 */
export interface TransferReport {
  readonly startedAt: string; // ISO 8601, moment the stream locked
  readonly durationSeconds: number;
  readonly complete: boolean; // true = SHA-256 verified; false = mid-transfer snapshot
  readonly progress: number; // 0..1
  readonly fileName: string;
  readonly fileBytes: number;
  readonly k: number; // source block count
  readonly framesCaptured: number; // frames handed to the decoder pool
  readonly framesDecoded: number; // distinct Farol symbols recovered
  readonly overhead: number; // framesDecoded / k
  readonly hitRate: number; // framesDecoded / (framesCaptured * codesPerFrame)
  readonly captureFps: number; // framesCaptured / durationSeconds
  readonly goodputKBs: number; // fileBytes / 1024 / durationSeconds
  readonly bytesPerFrame: number; // QR capacity per frame (header + fountain symbol)
  readonly decodeWorkers: number;
  readonly cameraResolution: string; // e.g. "1920x1080"
  readonly userAgent: string;
  readonly protocolVersion: number;
  readonly sessionId: number; // pairs this report with the sender's announcement
  readonly codesPerFrame: number; // codes the sender tiles per displayed frame
  readonly payloadBytes: number; // fountain payload (container, after gzip)
  readonly framesDuplicate: number; // re-reads of a seq already counted
  readonly framesRedundant: number; // new seqs that carried no new information
  readonly seqSpan: number; // seqs the sender emitted while we watched
  readonly catchRate: number; // framesDecoded / seqSpan — low = the receiver missed displayed codes
  readonly acquisitionSeconds: number; // camera start -> capture of the first locked frame
  readonly cameraFps: number; // rate the camera actually delivers (track settings)
  readonly decodeResolution: string; // pixels handed to the decoder, e.g. "1080x1920"
  readonly tag: string; // experiment label from ?tag= (docs/ROTEIRO-TESTES.md)
  readonly sender?: SenderAnnouncement; // merged by the dev diagnostics endpoint
}

/** What the sender was set to — the receiver only learns k/blockLen/codes from the wire. */
export interface SenderAnnouncement {
  readonly sessionId: number;
  readonly fileName: string;
  readonly fileBytes: number;
  readonly payloadBytes: number;
  readonly k: number;
  readonly qrVersion: number;
  readonly ecc: string;
  readonly codes: number;
  readonly targetFps: number;
  readonly displayFps: number; // effective: refreshHz / vsyncs per frame
  readonly refreshHz: number;
  readonly userAgent: string;
  readonly stalls?: number; // display-loop freezes > 1 s, counted by the dev endpoint
}

/** Triggers a browser download of the report as pretty-printed JSON. */
export function downloadReport(report: TransferReport): void {
  const stamp = report.startedAt.replace(/[:.]/g, "-");
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `farol-report-${stamp}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
