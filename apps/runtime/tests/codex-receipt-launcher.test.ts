import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isCodexStdioServer} from '../src/read-receipts/qualification.js';
import {it, stateDir} from './support.js';

const SCRIPT = fileURLToPath(new URL('../../bin/codex-observer.mjs', import.meta.url));

it('only the native stdio launch pattern enables observation', () => {
  for (const args of [['app-server'], ['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled'],
    ['app-server', '-c', 'features.code_mode_host=true']]) assert.equal(isCodexStdioServer(args), true);
  for (const args of [['--version'], ['exec', 'app-server'], ['-c', 'app-server'], ['app-server', 'daemon', 'version'],
    ['app-server', '--listen', 'ws://127.0.0.1:0'], ['app-server', '--listen=ws://127.0.0.1:0']]) assert.equal(isCodexStdioServer(args), false);
});

it('the delivered observer executable preserves native invocations across versions with no producer', async context => {
  const dir = await stateDir(context), native = join(dir, 'native-fixture');
  for (const version of ['0.166.0-alpha.5.1', '1.0.0', 'future-native']) {
    await writeFile(native, `#!${process.execPath}\nif (process.argv[2] === '--version') process.stdout.write(${JSON.stringify(`codex-cli ${version}\n`)});\nelse {process.stdin.pipe(process.stdout); process.stdin.on('end', () => {process.stderr.write('native stderr\\n'); process.exitCode = 19;});}\n`, {mode: 0o700});
    for (const args of [['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled'], ['unrelated-command'], ['--version']]) {
      const child = spawn(process.execPath, [SCRIPT, ...args], {env: {...process.env, BUNNY_CODEX_NATIVE: native,
        BUNNY_CODEX_RECEIPT_PRODUCER: join(dir, 'absent.json')}, stdio: ['pipe', 'pipe', 'pipe']});
      const stdout: Buffer[] = [], stderr: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => {stdout.push(chunk);}); child.stderr.on('data', (chunk: Buffer) => {stderr.push(chunk);});
      child.stdin.on('error', () => {});
      const bytes = Buffer.from('unchanged native bytes\n'); child.stdin.end(bytes);
      const deadline = setTimeout(() => {child.kill('SIGKILL');}, 4000);
      const {code, signal} = await new Promise<{code: number | null; signal: NodeJS.Signals | null}>(resolve => {
        child.once('close', (code, signal) => {resolve({code, signal});});
      });
      clearTimeout(deadline);
      const versionOnly = args[0] === '--version';
      assert.equal(code, versionOnly ? 0 : 19); assert.equal(signal, null);
      assert.deepEqual(Buffer.concat(stdout), versionOnly ? Buffer.from(`codex-cli ${version}\n`) : bytes);
      assert.equal(Buffer.concat(stderr).toString(), versionOnly ? '' : 'native stderr\n');
    }
  }
});

it('a stalled producer read cannot keep the observer alive after native output and exit', async context => {
  const dir = await stateDir(context), native = join(dir, 'native-fixture'), fifo = join(dir, 'stalled-read');
  const marker = join(dir, 'read-entered'), preload = join(dir, 'stall-selected-producer.mjs');
  execFileSync('mkfifo', ['-m', '600', fifo]);
  await writeFile(preload, `import fs from 'node:fs/promises';
import {writeFileSync, constants} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const original = fs.open;
fs.open = (path, ...args) => {
  if (path !== process.env.BUNNY_CODEX_RECEIPT_PRODUCER) return original(path, ...args);
  writeFileSync(process.env.BUNNY_TEST_READ_MARKER, 'entered');
  return original(process.env.BUNNY_TEST_READ_FIFO, constants.O_RDONLY);
};
syncBuiltinESMExports();
`);
  await writeFile(native, `#!${process.execPath}
import {existsSync} from 'node:fs';
if (process.argv[2] === '--version') process.stdout.write('codex-cli future-native\\n');
else {
  const finish = () => {
    if (!existsSync(process.env.BUNNY_TEST_READ_MARKER)) return setTimeout(finish, 10);
    process.stdout.write('native finished\\n', () => process.exit(23));
  };
  finish();
}
`, {mode: 0o700});
  const child = spawn(process.execPath, ['--import', preload, SCRIPT, 'app-server'], {env: {...process.env,
    BUNNY_CODEX_NATIVE: native,
    BUNNY_CODEX_RECEIPT_PRODUCER: join(dir, 'producer.json'), BUNNY_TEST_READ_MARKER: marker, BUNNY_TEST_READ_FIFO: fifo},
  stdio: ['ignore', 'pipe', 'pipe']});
  context.after(() => {if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');});
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => {stdout.push(chunk);}); child.stderr.on('data', (chunk: Buffer) => {stderr.push(chunk);});
  let forced = false;
  const deadline = setTimeout(() => {forced = true; child.kill('SIGKILL');}, 4000);
  const result = await new Promise<{code: number | null; signal: NodeJS.Signals | null}>(resolve => {
    child.once('close', (code, signal) => {resolve({code, signal});});
  });
  clearTimeout(deadline);
  assert.equal(await readFile(marker, 'utf8'), 'entered');
  assert.equal(Buffer.concat(stdout).toString(), 'native finished\n');
  assert.equal(Buffer.concat(stderr).toString(), '');
  assert.equal(forced, false, 'the observer must stop itself without the test supervisor');
  assert.deepEqual(result, {code: null, signal: 'SIGKILL'});
});
