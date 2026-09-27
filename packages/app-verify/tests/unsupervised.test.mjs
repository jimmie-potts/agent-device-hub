// The capture rules without a supervisor: these run on any CI host, including
// one without `systemd --user`, so the negative controls always execute.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {runCaptureStep} from '@jimmie-potts/app-verify';
import {createPlugin} from './fixture-app/plugin.mjs';

const server = fileURLToPath(new URL('fixture-app/server.mjs', import.meta.url));
const magic = async (path, bytes) => (await readFile(path)).subarray(0, bytes.length).equals(Buffer.from(bytes));

/** Start the fixture app directly, as an adapter's CI would, and return its URL. */
async function serve(base, name, behavior) {
  const data = join(base, name);
  await mkdir(data);
  await writeFile(join(data, 'scenario.json'), JSON.stringify({name, behavior, start: 0}));
  const child = spawn(process.execPath, [server, '--data', data, '--port', '0'], {stdio: ['ignore', 'pipe', 'inherit']});
  const url = await new Promise((resolve, reject) => {
    let text = '';
    child.stdout.on('data', chunk => {
      text += chunk;
      const line = text.split('\n').find(l => l.startsWith('{'));
      if (line) resolve(JSON.parse(line).url);
    });
    child.on('exit', code => reject(new Error(`fixture exited ${code}`)));
  });
  return {url, data, stop: () => new Promise(resolve => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
  })};
}

test('runCaptureStep: the reference passes, and a wrong expectation, a broken app and a silent step fail', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'app-verify-unsupervised-')));
  const plugin = createPlugin({root: base, app: 'avt-unsupervised'});
  const reference = await serve(base, 'reference', 'reference');
  const broken = await serve(base, 'broken', 'broken');
  try {
    const passed = await runCaptureStep(plugin, 'count-twice', {url: reference.url, outputDir: join(base, 'out-1'), dataDir: reference.data});
    assert.equal(passed.outcome, 'passed', passed.reason);
    assert.ok(await magic(passed.screenshot, [0x89, 0x50, 0x4e, 0x47]));
    assert.ok(await magic(passed.video, [0x1a, 0x45, 0xdf, 0xa3]));
    assert.deepEqual(passed.assertions.map(a => [a.name, a.outcome]), [['the counter advanced by 2', 'passed']]);
    const log = JSON.parse(await readFile(passed.log, 'utf8'));
    assert.equal(log.supervised, false);
    assert.equal(log.outcome, 'passed');

    const control = await runCaptureStep(plugin, 'control-wrong-expectation', {url: reference.url, outputDir: join(base, 'out-2')});
    assert.equal(control.outcome, 'failed', 'a control-* step fails by design; nothing turns it into a pass');
    assert.match(control.reason, /^assertion failed: the counter advanced by 3/);
    assert.ok(control.screenshot, 'the failure keeps its screenshot');

    const wrongApp = await runCaptureStep(plugin, 'count-twice', {url: broken.url, outputDir: join(base, 'out-3'), scenario: 'broken'});
    assert.equal(wrongApp.outcome, 'failed');
    assert.match(wrongApp.reason, /expected Count: 2, saw Count: 4/);

    const silent = await runCaptureStep(plugin, 'no-assertions', {url: reference.url, outputDir: join(base, 'out-4')});
    assert.equal(silent.outcome, 'failed');
    assert.equal(silent.reason, 'no assertions recorded: a screenshot alone never passes');

    const missing = await runCaptureStep(createPlugin({root: base, app: 'avt-unsupervised', playwright: ['app-verify-no-such-playwright']}), 'count-twice', {url: reference.url, outputDir: join(base, 'out-5')});
    assert.equal(missing.outcome, 'unavailable');
    assert.equal(existsSync(join(base, 'out-5/assertions.json')), true);

    await assert.rejects(runCaptureStep(plugin, 'count-twice', {url: reference.url.replace('127.0.0.1', 'localhost'), outputDir: join(base, 'out-6')}), /127\.0\.0\.1/);
    await assert.rejects(runCaptureStep(plugin, 'count-twice', {url: reference.url, outputDir: join(base, 'out-1')}), /empty output directory/);
  } finally {
    await reference.stop();
    await broken.stop();
    await rm(base, {recursive: true, force: true});
  }
});
