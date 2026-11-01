import {randomUUID} from 'node:crypto';
import type {Observer, ReachyTransport, MoveEvent} from './transport.js';
/** Deterministic transport for conformance; this is separate from vendor MuJoCo. */
export class SimulatedReachy implements ReachyTransport {
  online = true;
  mismatch = false;
  effects: {kind: 'move' | 'cancel'; id: string; target?: readonly [number, number]}[] = [];
  observer: Observer | undefined;
  readonly events: MoveEvent[] = [];
  #event(event:MoveEvent):void {this.events.push(event); if(this.events.length>128)this.events.shift();this.observer?.event(event);}
  state() {return {online:this.online,mismatch:this.mismatch,antennas:[...this.antennas],effects:this.effects.length,moves:this.effects.filter(x=>x.kind==='move').length,events:[...this.events]};}
  readonly tasks = new Map<string, {target: readonly [number, number]; done: () => void}>();
  autoComplete = true;
  antennas: [number, number] = [0, 0];
  async connect(observer: Observer, signal: AbortSignal): Promise<() => void> {
    await Promise.resolve();
    if (!this.online || this.mismatch) {observer.lost(this.mismatch); throw new Error('offline');}
    this.observer = observer; observer.state({antennas: [...this.antennas]});
    const timer=setInterval(()=>{if(this.online)observer.state({antennas:[...this.antennas]});},200);timer.unref();
    const close = (): void => {clearInterval(timer);signal.removeEventListener('abort',close);if (this.observer === observer) this.observer = undefined;};
    signal.addEventListener('abort', close, {once: true}); return close;
  }
  async move(target: readonly [number, number], signal: AbortSignal, beforeEffect: () => void = () => {}): Promise<string> {
    await Promise.resolve();
    signal.throwIfAborted(); if (!this.online) throw new Error('offline');
    beforeEffect(); const id = randomUUID(); this.effects.push({kind: 'move', id, target});
    const done = (): void => {if (!this.tasks.has(id)) return; this.antennas = [target[0], target[1]]; this.observer?.state({antennas: [...this.antennas]}); this.#event({uuid: id, type: 'move_completed'}); this.tasks.delete(id);};
    this.tasks.set(id, {target, done}); this.#event({uuid: id, type: 'move_started'});
    if (this.autoComplete) queueMicrotask(done);
    return id;
  }
  async cancel(id: string, signal: AbortSignal): Promise<void> {
    await Promise.resolve();
    signal.throwIfAborted(); this.effects.push({kind: 'cancel', id}); this.tasks.delete(id); this.#event({uuid: id, type: 'move_cancelled'});
  }
  act(action: string): void {this.online = action !== 'offline'; if (!this.online) this.observer?.lost(); else this.observer?.state({antennas: [...this.antennas]});}
}
