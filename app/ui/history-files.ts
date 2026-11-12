// The tab keeps the same cache across reloads; clearing history removes its blobs.
export class HistoryFiles {
  private memory = new Map<string, Blob>();
  private database: Promise<IDBDatabase | undefined>;
  constructor(name: string) {
    this.database = this.open(name).catch(() => undefined);
  }
  private async open(name: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files");
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
  }
  async clear(): Promise<void> {
    const db = await this.database;
    if (db) await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    this.memory.clear();
  }
  async put(id: string, file: Blob): Promise<void> {
    this.memory.set(id, file);
    const db = await this.database;
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put(file, id);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }).catch(() => { /* Current-page downloads still work if disk quota is full. */ });
  }
  async get(id: string): Promise<Blob | undefined> {
    if (this.memory.has(id)) return this.memory.get(id);
    const db = await this.database;
    if (!db) return;
    return new Promise((resolve) => {
      const request = db.transaction("files").objectStore("files").get(id);
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : undefined);
      request.onerror = () => resolve(undefined);
    });
  }
}

let tabId: string = crypto.randomUUID();
try {
  tabId = sessionStorage.getItem("farol:tab-id") ?? tabId;
  sessionStorage.setItem("farol:tab-id", tabId);
} catch { /* memory fallback */ }
export const historyFiles = new HistoryFiles(`farol-temporary-${tabId}`);
