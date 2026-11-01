/**
 * Keeps the screen on while streaming or receiving — a dimmed sender or a locked
 * receiver silently stalls a transfer. Browsers drop the lock whenever the page
 * is hidden, so it is re-requested when the page becomes visible again.
 */
export class ScreenWakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  constructor() {
    document.addEventListener("visibilitychange", () => {
      if (this.wanted && document.visibilityState === "visible") void this.request();
    });
  }

  async acquire(): Promise<void> {
    this.wanted = true;
    await this.request();
  }

  release(): void {
    this.wanted = false;
    void this.sentinel?.release();
    this.sentinel = null;
  }

  private async request(): Promise<void> {
    if (!("wakeLock" in navigator) || (this.sentinel && !this.sentinel.released)) return;
    try {
      this.sentinel = await navigator.wakeLock.request("screen");
    } catch {
      // Refused (battery saver, insecure origin): the transfer still works, the screen may dim.
    }
  }
}
