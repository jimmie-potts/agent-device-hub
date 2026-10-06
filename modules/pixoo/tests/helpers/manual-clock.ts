import type { Clock } from '../../packages/device/src/index.js';

export class ManualClock implements Clock {
  private time = 0;
  private sequence = 0;
  private timers = new Map<number, { at: number; callback: () => void }>();
  now() { return this.time; }
  schedule(delayMs: number, callback: () => void) {
    const id = ++this.sequence;
    this.timers.set(id, { at: this.time + delayMs, callback });
    return () => { this.timers.delete(id); };
  }
  advance(ms: number) {
    const end = this.time + ms;
    for (;;) {
      const next = [...this.timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next || next[1].at > end) break;
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.time = end;
  }
  get pendingTimers() { return this.timers.size; }
}
