import { describe, expect, it, vi } from "vitest";
import { recordTransfer, TemporaryHistory, transferHistory } from "./history.js";
import { HistoryFiles, historyFiles } from "./history-files.js";

function tabStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const data = new Map<string, string>();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: (key) => { data.delete(key); } };
}
describe("temporary transfer history lifecycle", () => {
  it("preserves the original JSON report and received-document reference during navigation", () => {
    const storage = tabStorage();
    const report = { complete: true, fileName: "documento.docx", fileBytes: 70314, durationSeconds: 12.5, sessionId: 42 };
    const history = new TemporaryHistory(storage);
    history.add("receive", "documento.docx", 70314, report, true);
    const restored = new TemporaryHistory(storage).list()[0];
    expect(JSON.parse(JSON.stringify(restored.report))).toEqual(report);
    expect(restored.hasFile).toBe(true);
    expect(new TemporaryHistory(storage).list()[0].report).toEqual(report);
    history.clear();
    expect(new TemporaryHistory(storage).list()).toEqual([]);
  });
  it("restores image references saved by earlier versions", () => {
    const storage = tabStorage();
    const legacyEntry = { id: "old-image", kind: "receive", filename: "foto.png", bytes: 4, at: Date.now(), hasImage: true };
    storage.setItem("farol:temporary-transfers", JSON.stringify([legacyEntry]));
    expect(new TemporaryHistory(storage).list()[0]).toEqual(legacyEntry);
  });
  it.each(["receive", "demo-receive"] as const)("retains document bytes through %s recording for history downloads", async (kind) => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    try {
      const bytes = new Uint8Array([80, 75, 3, 4, 0, 255]);
      const file = new Blob([bytes], { type: "application/octet-stream" });
      await recordTransfer(kind, "documento.docx", bytes.length, { complete: true }, file);
      const entry = transferHistory.list()[0];
      expect(entry.filename).toBe("documento.docx");
      expect(entry.hasFile).toBe(true);
      expect(new Uint8Array(await (await historyFiles.get(entry.id))!.arrayBuffer())).toEqual(bytes);
      expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "farol:history" }));
    } finally {
      transferHistory.clear();
      await historyFiles.clear();
      vi.unstubAllGlobals();
    }
  });
  it("retains received image bytes for downloads when IndexedDB is unavailable", async () => {
    const files = new HistoryFiles("test-memory");
    const original = new Blob([new Uint8Array([137, 80, 78, 71, 0, 255])]);
    await files.put("image-1", original);
    expect(new Uint8Array(await (await files.get("image-1"))!.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71, 0, 255]));
    expect(await files.get("unknown")).toBeUndefined();
    await files.clear();
    expect(await files.get("image-1")).toBeUndefined();
  });
  it("keeps sends and receptions across navigation and reloads until manually cleared", () => {
    const storage = tabStorage();
    const sendPage = new TemporaryHistory(storage);
    sendPage.add("send", "mensagem.txt", 123);
    const receivePage = new TemporaryHistory(storage);
    expect(receivePage.list()[0].filename).toBe("mensagem.txt");
    receivePage.add("receive", "foto.png", 456);
    // A restored browser page must see newer entries, rather than its old memory snapshot.
    expect(sendPage.list().map((e) => e.kind)).toEqual(["receive", "send"]);
    const reloadedPage = new TemporaryHistory(storage);
    expect(reloadedPage.list().map((entry) => entry.kind)).toEqual(["receive", "send"]);
    reloadedPage.clear();
    expect(reloadedPage.list()).toEqual([]);
    expect(sendPage.list()).toEqual([]);
    expect(new TemporaryHistory(storage).list()).toEqual([]);
  });
  it("keeps histories isolated between tabs", () => {
    const first = new TemporaryHistory(tabStorage());
    first.add("send", "a.txt", 1);
    expect(new TemporaryHistory(tabStorage()).list()).toEqual([]);
  });
  it("still records in memory when browser storage is denied", () => {
    const denied = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
    const history = new TemporaryHistory(denied);
    history.add("receive", "ok.txt", 5);
    expect(history.list()).toHaveLength(1);
  });
});
