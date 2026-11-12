import { historyFiles } from "./history-files.js";

export type TransferKind = "send" | "receive" | "demo-send" | "demo-receive";
export interface TransferEntry {
  id: string;
  kind: TransferKind;
  filename: string;
  bytes: number;
  at: number;
  report?: object;
  hasImage?: boolean;
}
type TabStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const KEY = "farol:temporary-transfers";

/** Tab-scoped records survive reloads and internal navigation until explicitly cleared. */
export class TemporaryHistory {
  private entries: TransferEntry[] = [];
  constructor(private storage?: TabStorage) {
    this.restore();
  }
  private restore(): void {
    try {
      if (!this.storage) return;
      const stored: unknown = JSON.parse(this.storage.getItem(KEY) ?? "[]");
      if (Array.isArray(stored)) this.entries = stored.filter((e): e is TransferEntry =>
        e && typeof e.id === "string" && typeof e.filename === "string" &&
        ["send", "receive", "demo-send", "demo-receive"].includes(e.kind) &&
        Number.isFinite(e.bytes) && e.bytes >= 0 && Number.isFinite(e.at)).slice(0, 100);
    } catch { /* Storage may be blocked; memory-only history still works. */ }
  }
  list(): readonly TransferEntry[] { this.restore(); return this.entries; }
  clear(): void {
    this.storage?.removeItem(KEY);
    this.entries = [];
  }
  add(kind: TransferKind, filename: string, bytes: number, report?: object, hasImage = false): TransferEntry {
    this.restore();
    const at = Date.now();
    const entry = { id: crypto.randomUUID(), kind, filename, bytes, at, hasImage,
      report: report ?? { kind, fileName: filename, fileBytes: bytes, startedAt: new Date(at).toISOString() } };
    this.entries = [entry, ...this.entries].slice(0, 100);
    try { this.storage?.setItem(KEY, JSON.stringify(this.entries)); } catch { /* optional storage */ }
    return entry;
  }
}

let tabStorage: Storage | undefined;
try { if (typeof window !== "undefined") tabStorage = window.sessionStorage; } catch { /* memory fallback */ }
export const transferHistory = new TemporaryHistory(tabStorage);
export async function clearHistory(): Promise<void> {
  await historyFiles.clear();
  transferHistory.clear();
  window.dispatchEvent(new Event("farol:history"));
}
export async function recordTransfer(kind: TransferKind, filename: string, bytes: number, report?: object, image?: Blob): Promise<void> {
  const entry = transferHistory.add(kind, filename, bytes, report, !!image);
  if (image) await historyFiles.put(entry.id, image);
  window.dispatchEvent(new Event("farol:history"));
}

