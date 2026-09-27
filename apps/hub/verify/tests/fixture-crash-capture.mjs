// A stand-in for the Hub's adapter wrapper in compose.test.mjs (Hub #495). Every
// operation runs the real scripts/verify.mjs, except that a `capture` dies,
// printing nothing, as soon as the orchestrator has frozen the consumer for it:
// the crash that `compose inject` must survive by thawing, clearing the
// handshake and printing its own result.
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const args = process.argv.slice(2);
const child = spawn(process.execPath, [join(root, 'scripts/verify.mjs'), ...args], {cwd: root, stdio: ['ignore', args[0] === 'capture' ? 'ignore' : 'inherit', 'inherit']});
if (args[0] === 'capture') {
  const stateRoot = process.env.APP_VERIFY_STATE_ROOT ? resolve(process.env.APP_VERIFY_STATE_ROOT) : join(homedir(), '.local/state/app-verify');
  const state = join(stateRoot, args[1] ?? '', 'compose-inject-state');
  for (;;) {
    const phase = await readFile(state, 'utf8').then(text => JSON.parse(text).phase, () => undefined);
    if (phase === 'frozen') break;
    await new Promise(done => setTimeout(done, 100));
  }
  child.kill('SIGTERM');
  await new Promise(done => child.once('exit', done));
  process.exit(1);
}
child.once('exit', code => process.exit(code ?? 1));
