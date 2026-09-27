// The capture rules without a supervisor: these run on any CI host, including
// one without `systemd --user`, so the negative controls always execute.
import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import test from 'node:test';
import {runCaptureStep} from '@jimmie-potts/app-verify';
import {createPlugin} from './fixture-app/plugin.mjs';

const server = fileURLToPath(new URL('fixture-app/server.mjs', import.meta.url));
const judge = fileURLToPath(new URL('fixture-app/judge.mjs', import.meta.url));
const magic = async (path, bytes) => (await readFile(path)).subarray(0, bytes.length).equals(Buffer.from(bytes));
const PNG = [0x89, 0x50, 0x4e, 0x47], WEBM = [0x1a, 0x45, 0xdf, 0xa3];

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

/**
 * A Playwright browser directory built from the real cache: Chromium kept, and
 * ffmpeg either removed or replaced by a stub script.
 */
async function browsers(base, name, ffmpeg) {
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache/ms-playwright');
  const directory = join(base, name);
  await mkdir(directory);
  for (const entry of await readdir(cache)) {
    if (entry.startsWith('.')) continue;
    if (!entry.startsWith('ffmpeg')) await symlink(join(cache, entry), join(directory, entry));
    else if (ffmpeg) {
      await mkdir(join(directory, entry));
      for (const file of await readdir(join(cache, entry))) {
        await writeFile(join(directory, entry, file), ffmpeg);
        await chmod(join(directory, entry, file), 0o755);
      }
    }
  }
  return directory;
}

/** runCaptureStep in a child process with its own Playwright environment. */
async function judged(base, step, url, outputDir, env) {
  const {stdout} = await promisify(execFile)(process.execPath, [judge, base, step, url, outputDir, 'reference'], {env: {...process.env, ...env}});
  return JSON.parse(stdout.trim().split('\n').at(-1));
}

test('runCaptureStep: the reference passes, and wrong expectations, false predicates, a broken app and a silent step fail', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'app-verify-unsupervised-')));
  const plugin = createPlugin({root: base, app: 'avt-unsupervised'});
  const reference = await serve(base, 'reference', 'reference');
  const broken = await serve(base, 'broken', 'broken');
  try {
    const passed = await runCaptureStep(plugin, 'count-twice', {url: reference.url, outputDir: join(base, 'out-1'), dataDir: reference.data});
    assert.equal(passed.outcome, 'passed', passed.reason);
    assert.ok(await magic(passed.screenshot, PNG));
    assert.ok(await magic(passed.video, WEBM));
    assert.deepEqual(passed.assertions.map(a => [a.name, a.outcome]), [['the counter advanced by 2', 'passed']]);
    const log = JSON.parse(await readFile(passed.log, 'utf8'));
    assert.equal(log.supervised, false);
    assert.equal(log.outcome, 'passed');

    const attached = await runCaptureStep(plugin, 'attach-proof', {url: reference.url, outputDir: join(base, 'out-7')});
    assert.equal(attached.outcome, 'passed', attached.reason);
    assert.deepEqual(attached.attachments, ['clicked.png', 'observed.json', 'label.txt'].map(name => join(base, 'out-7', name)));

    const control = await runCaptureStep(plugin, 'control-wrong-expectation', {url: reference.url, outputDir: join(base, 'out-2')});
    assert.equal(control.outcome, 'failed', 'a control-* step fails by design; nothing turns it into a pass');
    assert.match(control.reason, /^assertion failed: the counter advanced by 3/);
    assert.ok(control.screenshot, 'the failure keeps its screenshot');

    // Playwright predicates answer false instead of throwing; false is a failed observation.
    for (const [step, name] of [['control-returns-false', 'the counter shows 999'], ['control-not-visible', 'a missing heading is visible']]) {
      const result = await runCaptureStep(plugin, step, {url: reference.url, outputDir: join(base, `out-${step}`)});
      assert.equal(result.outcome, 'failed', step);
      assert.equal(result.reason, `assertion failed: ${name}: check returned false`);
      assert.deepEqual(result.assertions.map(a => [a.outcome, a.error]), [['failed', 'check returned false']]);
    }

    const wrongApp = await runCaptureStep(plugin, 'count-twice', {url: broken.url, outputDir: join(base, 'out-3'), scenario: 'broken'});
    assert.equal(wrongApp.outcome, 'failed');
    assert.match(wrongApp.reason, /expected Count: 2, saw Count: 4/);

    const silent = await runCaptureStep(plugin, 'no-assertions', {url: reference.url, outputDir: join(base, 'out-4')});
    assert.equal(silent.outcome, 'failed');
    assert.equal(silent.reason, 'no assertions recorded: a screenshot alone never passes');

    const missing = await runCaptureStep(createPlugin({root: base, app: 'avt-unsupervised', playwright: ['app-verify-no-such-playwright']}), 'count-twice', {url: reference.url, outputDir: join(base, 'out-5')});
    assert.equal(missing.outcome, 'unavailable');
    assert.match(missing.reason, /Playwright is not installed/);
    assert.equal(existsSync(join(base, 'out-5/assertions.json')), true);

    await assert.rejects(runCaptureStep(plugin, 'count-twice', {url: reference.url.replace('127.0.0.1', 'localhost'), outputDir: join(base, 'out-6')}), /127\.0\.0\.1/);
    await assert.rejects(runCaptureStep(plugin, 'count-twice', {url: reference.url, outputDir: join(base, 'out-1')}), /empty output directory/);
    // The caller owns the starting state: a step pinned to another scenario is refused, and an inherited name is no step.
    await assert.rejects(runCaptureStep(plugin, 'fresh-count', {url: reference.url, outputDir: join(base, 'out-8'), scenario: 'second'}), /pinned to scenario reference/);
    await assert.rejects(runCaptureStep(plugin, 'constructor', {url: reference.url, outputDir: join(base, 'out-9')}), /unknown capture step/);
  } finally {
    await reference.stop();
    await broken.stop();
    await rm(base, {recursive: true, force: true});
  }
});

test('runCaptureStep: missing Chromium or ffmpeg is unavailable, and an unfinalized or truncated video fails', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'app-verify-tooling-')));
  const app = await serve(base, 'reference', 'reference');
  try {
    const empty = join(base, 'empty-browsers');
    await mkdir(empty);
    const noChromium = await judged(base, 'count-twice', app.url, join(base, 'o1'), {PLAYWRIGHT_BROWSERS_PATH: empty});
    assert.equal(noChromium.outcome, 'unavailable');
    assert.match(noChromium.reason, /Chromium build .* is not installed/);

    const noFfmpeg = await judged(base, 'count-twice', app.url, join(base, 'o2'), {PLAYWRIGHT_BROWSERS_PATH: await browsers(base, 'no-ffmpeg')});
    assert.equal(noFfmpeg.outcome, 'unavailable');
    assert.match(noFfmpeg.reason, /ffmpeg/);

    // An encoder that writes nothing: every assertion passes and the capture still fails.
    const silentEncoder = await judged(base, 'count-twice', app.url, join(base, 'o3'), {PLAYWRIGHT_BROWSERS_PATH: await browsers(base, 'silent-ffmpeg', '#!/bin/sh\ncat > /dev/null\nexit 0\n')});
    assert.equal(silentEncoder.outcome, 'failed');
    assert.equal(silentEncoder.reason, 'the video was not finalized');
    assert.equal(silentEncoder.video, null);
    assert.deepEqual(silentEncoder.assertions.map(a => a.outcome), ['passed']);

    // An encoder that writes the WebM magic and noise: a header alone is not a finalized video, whether the
    // encoder then reports success (the file itself is judged) or crashes (closing the context fails).
    const truncated = code => `#!/bin/sh\nfor out; do :; done\nprintf '\\032\\105\\337\\243' > "$out"\nhead -c 4000 /dev/urandom >> "$out"\ncat > /dev/null\nexit ${code}\n`;
    for (const [name, code] of [['o4', 0], ['o5', 1]]) {
      const result = await judged(base, 'count-twice', app.url, join(base, name), {PLAYWRIGHT_BROWSERS_PATH: await browsers(base, `truncating-ffmpeg-${code}`, truncated(code))});
      assert.equal(result.outcome, 'failed', `encoder exit ${code}`);
      assert.equal(result.reason, 'the video was not finalized');
      assert.equal(result.video, null);
      assert.equal(existsSync(join(base, name, 'interaction.webm')), false, 'no claimed video remains under the finalized name');
    }
  } finally {
    await app.stop();
    await rm(base, {recursive: true, force: true});
  }
});
