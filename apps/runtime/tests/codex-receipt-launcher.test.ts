import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CODEX_APP_SERVER_VERSION, CODEX_DESKTOP_BUILD, CODEX_DESKTOP_VERSION, isCodexStdioServer, qualifiedCodexVersions} from '../src/read-receipts/qualification.js';
import {it, stateDir} from './support.js';

const SCRIPT = fileURLToPath(new URL('../../bin/codex-observer.mjs', import.meta.url));

it('only the selected version tuple and native stdio launch pattern enable observation', () => {
  assert.ok(qualifiedCodexVersions(CODEX_DESKTOP_VERSION, CODEX_DESKTOP_BUILD, `codex-cli ${CODEX_APP_SERVER_VERSION}`));
  for (const values of [['other', CODEX_DESKTOP_BUILD, `codex-cli ${CODEX_APP_SERVER_VERSION}`],
    [CODEX_DESKTOP_VERSION, 'other', `codex-cli ${CODEX_APP_SERVER_VERSION}`], [CODEX_DESKTOP_VERSION, CODEX_DESKTOP_BUILD, 'codex-cli other']]) {
    assert.equal(qualifiedCodexVersions(values[0] ?? '', values[1] ?? '', values[2] ?? ''), false);
  }
  for (const args of [['app-server'], ['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled'],
    ['app-server', '-c', 'features.code_mode_host=true']]) assert.equal(isCodexStdioServer(args), true);
  for (const args of [['--version'], ['exec', 'app-server'], ['-c', 'app-server'], ['app-server', 'daemon', 'version'],
    ['app-server', '--listen', 'ws://127.0.0.1:0'], ['app-server', '--listen=ws://127.0.0.1:0']]) assert.equal(isCodexStdioServer(args), false);
});

it('the delivered observer executable preserves supported, unsupported and unrelated native invocations with no producer', async context => {
  const dir = await stateDir(context), native = join(dir, 'native-fixture');
  for (const supported of [true, false]) {
    await writeFile(native, `#!${process.execPath}\nif (process.argv[2] === '--version') process.stdout.write(${JSON.stringify(`codex-cli ${supported ? CODEX_APP_SERVER_VERSION : 'unqualified'}\n`)});\nelse {process.stdin.pipe(process.stdout); process.stdin.on('end', () => {process.stderr.write('native stderr\\n'); process.exitCode = 19;});}\n`, {mode: 0o700});
    for (const args of [['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled'], ['unrelated-command']]) {
      const child = spawn(process.execPath, [SCRIPT, ...args], {env: {...process.env, BUNNY_CODEX_NATIVE: native,
        BUNNY_CODEX_RECEIPT_PRODUCER: join(dir, 'absent.json'), BUNNY_CODEX_DESKTOP_VERSION: CODEX_DESKTOP_VERSION,
        BUNNY_CODEX_DESKTOP_BUILD: CODEX_DESKTOP_BUILD}, stdio: ['pipe', 'pipe', 'pipe']});
      const stdout: Buffer[] = [], stderr: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => {stdout.push(chunk);}); child.stderr.on('data', (chunk: Buffer) => {stderr.push(chunk);});
      child.stdin.on('error', () => {});
      const bytes = Buffer.from('unchanged native bytes\n'); child.stdin.end(bytes);
      const deadline = setTimeout(() => {child.kill('SIGKILL');}, 4000);
      const {code, signal} = await new Promise<{code: number | null; signal: NodeJS.Signals | null}>(resolve => {
        child.once('close', (code, signal) => {resolve({code, signal});});
      });
      clearTimeout(deadline);
      assert.equal(code, 19); assert.equal(signal, null);
      assert.deepEqual(Buffer.concat(stdout), bytes); assert.equal(Buffer.concat(stderr).toString(), 'native stderr\n');
    }
  }
});
