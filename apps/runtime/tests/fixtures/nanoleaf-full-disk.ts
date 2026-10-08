// The Nanoleaf migration on a real full disk (Hub #933), run by nanoleaf-full-disk.test.ts inside a user and mount
// namespace whose small tmpfs is mounted at the given directory, so SQLite and the file writes meet ENOSPC. It writes a
// synthetic bridge state there, then migrates it while the disk fills at each stage of the write: for the final
// checkpoint and the close alone, before the secret files, and before the tool starts. Then it frees the disk and migrates and verifies
// again. It prints one JSON line per step: the tool's exit code and line, and what is left of the destination.
//   node nanoleaf-full-disk.js <tmpfs mount>
import {closeSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, writeSync} from 'node:fs';
import {join} from 'node:path';
import {writeSyntheticNanoleafState} from '@jimmie-potts/nanoleaf';
import {runNanoleafMigration, type NanoleafMigrationOptions} from '../../src/nanoleaf-migration.js';

const mount = process.argv[2] ?? '';
if (mount === '') throw new Error('usage: nanoleaf-full-disk.js <tmpfs mount>');
const print = (line: object): void => { process.stdout.write(`${JSON.stringify(line)}\n`); };
const filler = join(mount, 'filler');

function fill(): void {
  const descriptor = openSync(filler, 'w');
  const chunk = Buffer.alloc(4096, 1);
  try {
    for (;;) writeSync(descriptor, chunk);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOSPC')) throw error;
  } finally {
    closeSync(descriptor);
  }
}

const bridge = join(mount, 'bridge');
mkdirSync(bridge, {mode: 0o700});
await writeSyntheticNanoleafState(bridge);

/**
 * Runs one operation into the destination `name`, with the disk filled at `stage` and, when `freeAt` names a later stage,
 * freed again there, and reports what is left.
 */
async function run(step: string, operation: 'migrate' | 'verify', name: string, stage?: string, freeAt?: string): Promise<void> {
  const state = join(mount, name);
  const secrets = join(mount, `${name}-secrets`);
  const section = join(mount, `${name}-out`, 'section.json');
  let text = '';
  const options: NanoleafMigrationOptions = {write: line => { text += line; }};
  if (stage === 'start') fill();
  else if (stage !== undefined) {
    options.stage = name => {
      if (name === stage) fill();
      if (name === freeAt) rmSync(filler, {force: true});
      return Promise.resolve();
    };
  }
  const exit = await runNanoleafMigration([operation, '--source', bridge, '--state-dir', state, '--secrets-dir', secrets, '--section', section], options);
  const line = JSON.parse(text) as {result: string; code?: string; destination?: string};
  const modules = join(state, 'modules');
  const left = [
    ...(existsSync(modules) ? readdirSync(modules).filter(entry => entry.startsWith('nanoleaf')) : []),
    ...(existsSync(secrets) ? readdirSync(secrets) : []), ...(existsSync(section) ? ['section'] : []),
  ].sort();
  rmSync(filler, {force: true});
  print({step, exit, result: line.result, code: line.code, destination: line.destination, left});
}

// Full only for the final checkpoint and the close: the disk has room again before the secret files, so only the
// checkpoint can catch it.
await run('checkpoint-full', 'migrate', 'a', 'checkpoint', 'closed');
await run('secrets-full', 'migrate', 'b', 'secrets');
await run('start-full', 'migrate', 'c', 'start');
await run('room-again', 'migrate', 'd');
await run('verified', 'verify', 'd');
