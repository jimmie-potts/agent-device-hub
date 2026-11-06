#!/usr/bin/env node
// Synthetic JSON only. No process discovery, media, permission or native APIs.
import {basename} from 'node:path';
const now = () => Number(process.hrtime.bigint()) / 1e6;
const output = value => process.stdout.write(JSON.stringify(value) + '\n');
const name = basename(process.argv[1]);
const sampledAt = now();
const interval = {startedMonotonicMs: sampledAt, endedMonotonicMs: sampledAt};
const field = value => ({status: 'observed', value, interval});
if (process.argv[2] === '--clock') {
  output({schema: 'music-playback-clock/1.0', monotonicMs: now()});
} else if (name.startsWith('hang')) {
  process.stdout.write('{'); setInterval(() => {}, 1000);
} else if (process.argv[2] === '--control-existing-music') {
  const [action, expectedSourceInstance, deadline] = process.argv.slice(3);
  const startedMonotonicMs = now();
  const done = () => {const endedMonotonicMs = now(); output({schema: 'music-playback-control/1.0', status: 'sent', action, expectedSourceInstance,
    interval: {startedMonotonicMs, endedMonotonicMs}, sendInterval: {startedMonotonicMs, endedMonotonicMs}});};
  if (name.startsWith('late')) {process.on('SIGTERM', () => {}); setTimeout(done, Math.max(0, Number(deadline) - now()) + 100);} else done();
} else {
  const value = {schema: 'music-playback-read/1.0', status: 'sample', sourceInstance: 'a'.repeat(64), interval,
    state: field('playing'), position: field(0), item: field('ABCD'), itemAssociation: {status: 'bounded-match', interval},
    metadata: {title: field('Synthetic title'), artist: field('Synthetic artist'), album: field('Synthetic album'), durationSeconds: field(100)},
    outputSelection: {status: 'observed', provenance: 'music-declared-selection', interval, selectionInterval: interval,
      airPlayEnabled: field(true), devices: []}};
  const bytes = JSON.stringify(value) + '\n';
  process.stdout.write(bytes.slice(0, 37)); setImmediate(() => process.stdout.write(bytes.slice(37)));
}
