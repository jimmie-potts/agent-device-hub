export {FakeGatt, scheduler} from '../src/testing.js';
export class MotionClock {
  value = 1_000_000;
  timers = new Set<{at: number; run: () => void}>();
  now = (): number => this.value;
  after = (ms: number, run: () => void): (() => void) => {const task = {at: this.value + ms, run}; this.timers.add(task); return () => {this.timers.delete(task);};};
  async tick(ms: number): Promise<void> {
    const end = this.value + ms;
    for (;;) {
      await this.flush();
      const next = [...this.timers].filter(t => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (next === undefined) break;
      this.value = next.at; this.timers.delete(next); next.run();
    }
    this.value = end; await this.flush();
  }
  async flush(): Promise<void> {for (let i = 0; i < 40; i++) await Promise.resolve();}
}
