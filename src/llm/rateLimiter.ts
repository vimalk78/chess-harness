// Sliding-window limiter: at most `max` acquisitions per `windowMs`.
// Shared by both sides, because OpenRouter's free-model limit is per account.

export class RateLimiter {
  private stamps: number[] = [];
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;

  constructor(
    max: number,
    windowMs: number,
    now: () => number = Date.now,
    sleep: (ms: number, signal: AbortSignal) => Promise<void> = abortableSleep,
  ) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
    this.sleep = sleep;
  }

  /** Waits for a free slot. `onWait` is told how long each wait will be (in ms). */
  async acquire(signal: AbortSignal, onWait?: (ms: number) => void): Promise<void> {
    while (true) {
      const t = this.now();
      this.stamps = this.stamps.filter((s) => t - s < this.windowMs);
      if (this.stamps.length < this.max) {
        this.stamps.push(t);
        return;
      }
      const ms = this.stamps[0] + this.windowMs - t + 50;
      onWait?.(ms);
      await this.sleep(ms, signal);
    }
  }
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const id = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
