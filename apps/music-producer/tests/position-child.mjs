#!/usr/bin/env node
// Synthetic pipe fixture. It imports no macOS frameworks and sends no AppleEvents.
import {basename} from 'node:path';
if (process.argv.length !== 3 || process.argv[2] !== '--read-existing-music') process.exit(2);
const mode = basename(process.argv[1]);
const now = () => Number(process.hrtime.bigint()) / 1e6;
const interval = () => ({startedMonotonicMs: now(), endedMonotonicMs: now()});
const startedMonotonicMs = now();
const state = {value: 'playing', interval: interval()};
const positionInterval = interval();
const position = mode.includes('partial') ? {status: 'unavailable', interval: positionInterval,
  error: {code: 'unavailable', retryable: true, detail: 'The selected Music process or read is unavailable.'}} :
  {status: 'observed', seconds: 12.5, interval: positionInterval};
const sample = {schema: 'music-position-read/1.0', status: 'sample', sourceInstance: 'c'.repeat(64), state, position,
  interval: {startedMonotonicMs, endedMonotonicMs: now()}};
if (mode.includes('hang')) {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
}
if (!mode.includes('timeout')) {
  const line = JSON.stringify(sample) + '\n';
  process.stdout.write(line.slice(0, 80));
  setTimeout(() => process.stdout.write(line.slice(80)), 10);
}
