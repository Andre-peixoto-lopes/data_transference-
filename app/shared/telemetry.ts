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
  readonly hitRate: number; // framesDecoded / framesCaptured
  readonly captureFps: number; // framesCaptured / durationSeconds
  readonly goodputKBs: number; // fileBytes / 1024 / durationSeconds
  readonly bytesPerFrame: number; // QR capacity per frame (header + fountain symbol)
  readonly decodeWorkers: number;
  readonly cameraResolution: string; // e.g. "1920x1080"
  readonly userAgent: string;
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
