import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {stopChild, ownedChild} from '../scripts/compatibility-process.mjs';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('a fixture that ignores graceful shutdown is killed and reaped before cleanup', async () => {
  const {child, exited} = ownedChild(process.execPath, ['-e', "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"], {stdio: ['ignore', 'pipe', 'ignore']});
  try {
    await once(child.stdout, 'data');
    await stopChild(child, exited, 30, true);
    assert.equal(child.signalCode, 'SIGKILL');
    assert.throws(() => process.kill(child.pid, 0), {code: 'ESRCH'});
  } finally {
    if (child.exitCode === null && child.signalCode === null) {child.kill('SIGKILL');await exited;}
  }
});

test('missing pinned source leaves a failed report without launching services', async () => {
  const root = await mkdtemp(join(tmpdir(), 'compatibility-negative-'));
  const report = join(root, 'report.json');
  try {
    const child = spawn(process.execPath, ['scripts/check-hub-compatibility.mjs', root, root, report], {stdio: 'ignore'});
    const [code] = await once(child, 'exit');
    assert.notEqual(code, 0);
    const result = JSON.parse(await readFile(report));
    assert.equal(result.status, 'failed');
    assert.equal(result.stage, 'preflight');
    assert.equal(result.cleanup, true);
    assert.deepEqual(result.scenarios, []);
  } finally {await rm(root, {recursive: true, force: true});}
});
