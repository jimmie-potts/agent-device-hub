import {PassThrough} from 'node:stream';
import type {Scheduler} from '@jimmie-potts/sdk';
import type {ChildPort} from '../src/native.js';

export function timerWorld() {
  let now = 1000, wallOffset = 0;
  const scheduled = new Set<{at: number; callback: () => void}>();
  const scheduler: Scheduler = {after: (ms, callback) => {
    const entry = {at: now + ms, callback}; scheduled.add(entry); return () => {scheduled.delete(entry);};
  }};
  return {scheduler, clock: () => ({wallMs: 1_000_000 + now + wallOffset, monotonicMs: now}),
    shiftWall(ms: number) {wallOffset += ms;}, advance(ms: number) {
    const end = now + ms;
    for (;;) {
      const next = [...scheduled].filter(value => value.at <= end).sort((a, b) => a.at - b.at)[0];
      if (next === undefined) break;
      scheduled.delete(next); now = next.at; next.callback();
    }
    now = end;
  }};
}
export function fakeChild() {
  const stdout = new PassThrough(), stderr = new PassThrough(), stdin = new PassThrough();
  let onSpawn = () => {}, onError = () => {}, onExit = (_code: number | null, _signal: NodeJS.Signals | null) => {};
  const killed: NodeJS.Signals[] = [];
  const port: ChildPort = {stdout, stderr, stdin,
    onSpawn: callback => {onSpawn = callback;}, onError: callback => {onError = callback;}, onExit: callback => {onExit = callback;},
    kill: signal => {killed.push(signal); return true;}};
  return {port, killed, spawn: () => onSpawn(), error: () => onError(), exit: (code: number | null, signal: NodeJS.Signals | null = null) => onExit(code, signal),
    output: (value: unknown) => {stdout.write(JSON.stringify(value) + '\n');}, raw: (value: string) => {stdout.write(value);}};
}
export const flush = async (): Promise<void> => {for (let n = 0; n < 10; n += 1) await Promise.resolve();};
