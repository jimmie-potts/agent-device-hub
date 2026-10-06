// Receipt-lock interleavings that real processes reach only when suspended in a
// microsecond window. The file system calls of the core are wrapped (through
// syncBuiltinESMExports) so the test decides exactly when each step happens.
//
//   swept:         this operation is suspended for over a minute between
//                  mkdtemp and rename (the clock jumps 61 s), another
//                  operation's sweep removes its prepared lock directory, and
//                  a live operation holds the lock for a moment when it resumes.
//   stale-breaker: an operation that read a dead breaker's record resumes after
//                  another operation cleared that breaker and took a new one,
//                  and a third operation grabs the name if it is moved aside.
//
// Prints {applied, errors, displaced?} as one JSON line.
import {mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {createRequire, syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {basename, join} from 'node:path';
import {ProofStore} from '../../dist/receipt.js';

const [mode, receiptJson] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const fsp = require('node:fs/promises');
const original = {readFile: fsp.readFile, rename: fsp.rename};
const deferred = () => {
  let resolve;
  const promise = new Promise(r => (resolve = r));
  return {promise, resolve};
};
const startTime = async pid => {
  const text = await original.readFile(`/proc/${pid}/stat`, 'utf8');
  return text.slice(text.lastIndexOf(')') + 2).split(' ')[19];
};
const live = async tag => `${process.pid} ${await startTime(process.pid)} ${tag}\n`;
/** A record whose process has exited. */
const dead = tag => `${process.pid + 4194304} 1 ${tag}\n`;

const dir = await realpath(await mkdtemp(join(tmpdir(), 'app-verify-race-')));
const lock = join(dir, '.receipt.lock'), breaker = `${lock}.break`;
await writeFile(join(dir, 'receipt.json'), receiptJson);
const counter = async () => JSON.parse(await original.readFile(join(dir, 'receipt.json'), 'utf8')).counter ?? 0;
const bump = receipt => {
  receipt.counter = (receipt.counter ?? 0) + 1;
};
const errors = [];
const attempt = store => store.update(bump).catch(error => errors.push(`${error.constructor.name}: ${error.message}`));

try {
  if (mode === 'swept') {
    let swept = false;
    fsp.rename = async function (from, to) {
      if (!swept && basename(from).startsWith('.receipt.lock.new-')) {
        // Suspended past the sweep's minute: the wait's deadline has long passed and the prepared directory is gone.
        swept = true;
        const now = Date.now.bind(Date);
        Date.now = () => now() + 61000;
        await rm(from, {recursive: true, force: true});
        // Meanwhile a live operation took the lock; it releases it shortly after this one resumes.
        await mkdir(lock);
        await writeFile(join(lock, 'holder'), await live('other'));
        setTimeout(() => void rm(lock, {recursive: true, force: true}), 300);
      }
      return original.rename.call(this, from, to);
    };
    syncBuiltinESMExports();
    await attempt(new ProofStore(dir));
    process.stdout.write(JSON.stringify({applied: await counter(), errors, swept}) + '\n');
  } else if (mode === 'stale-breaker') {
    // A dead main lock and a dead breaker, as a killed holder and a killed breaker leave them.
    for (const [path, record] of [[lock, dead('holder')], [breaker, dead('breaker')]]) {
      await mkdir(path);
      await writeFile(join(path, 'holder'), record);
    }
    const third = await live('third');
    let stage = 'armed', taken, after;
    const reached = deferred(), resume = deferred(), release = deferred(), attempted = deferred();
    fsp.readFile = async function (path, ...rest) {
      const value = await original.readFile.call(this, path, ...rest);
      if (stage === 'armed' && path === join(breaker, 'holder')) {
        // The second operation holds the dead breaker's record and pauses before acting on it.
        stage = 'stale';
        reached.resolve();
        await resume.promise;
      }
      return value;
    };
    fsp.rename = async function (from, to) {
      if (stage === 'held' && from === breaker) {
        // The second operation acts on its stale record while the first holds the live breaker.
        try {
          const result = await original.rename.call(this, from, to);
          // The live breaker was moved aside: a third operation takes the free name at once.
          await mkdir(breaker);
          await writeFile(join(breaker, 'holder'), third);
          return result;
        } finally {
          attempted.resolve();
        }
      }
      const result = await original.rename.call(this, from, to);
      if (stage === 'stale' && to === breaker && basename(from).startsWith('.receipt.lock.new-')) {
        // The first operation cleared the dead breaker and now holds a new, live one.
        stage = 'held';
        taken = await original.readFile(join(breaker, 'holder'), 'utf8');
        resume.resolve();
        await release.promise;
      }
      return result;
    };
    syncBuiltinESMExports();
    const second = attempt(new ProofStore(dir));
    await reached.promise;
    const first = attempt(new ProofStore(dir));
    await resume.promise;
    // Once the second operation has acted on its stale record (or declined to), look at who holds the breaker.
    await Promise.race([attempted.promise, new Promise(resolve => setTimeout(resolve, 3000))]);
    await new Promise(resolve => setTimeout(resolve, 100));
    after = await original.readFile(join(breaker, 'holder'), 'utf8').catch(() => null);
    stage = 'done';
    release.resolve();
    await Promise.all([first, second]);
    process.stdout.write(JSON.stringify({applied: await counter(), errors, displaced: after !== taken}) + '\n');
  } else throw new Error(`unknown mode ${mode}`);
} finally {
  await rm(dir, {recursive: true, force: true});
}
