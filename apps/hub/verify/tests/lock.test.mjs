// Hub #495: the composition lock under contention, with holders that die while
// holding it. No two live processes may ever be inside at once, and a dead
// holder's lock must be broken so the others keep going. Needs no systemd.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const contender = fileURLToPath(new URL('lock-contender.mjs', import.meta.url));

test('the composition lock admits one live holder at a time, and breaks a dead holder\'s lock', {timeout: 60000}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'compose-lock-'));
  try {
    const until = Date.now() + 8000;
    let exits = 0, crashes = 0;
    const one = () => new Promise(resolve => {
      const child = spawn(process.execPath, [contender, dir, String(until), '5'], {stdio: ['ignore', 'ignore', 'inherit']});
      child.on('exit', code => {
        exits++;
        if (code === 9) crashes++;
        else assert.equal(code, 0, 'a contender failed');
        // A crashed contender is replaced while time remains, so the contention continues.
        resolve(Date.now() < until ? one() : undefined);
      });
    });
    await Promise.all(Array.from({length: 8}, one));
    const overlaps = existsSync(join(dir, 'overlaps')) ? (await readFile(join(dir, 'overlaps'), 'utf8')).trim() : '';
    assert.equal(overlaps, '', 'no two live holders were inside at once');
    assert.ok(crashes >= 5, `holders died while holding the lock (${crashes} of ${exits} exits)`);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
