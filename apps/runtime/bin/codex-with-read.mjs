#!/usr/bin/env node
// An explicit launch selection, with no edits to the app, its profile, hooks or personal settings.
import {spawn, spawnSync} from 'node:child_process';
import {dirname, isAbsolute, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {qualifiedCodexVersions} from '../dist/src/read-receipts/qualification.js';

const check = process.argv[2] === '--check';
const args = process.argv.slice(check ? 3 : 2);
if (args.length !== 2 || args.some(arg => !isAbsolute(arg)) || process.platform !== 'darwin') {
  process.stderr.write('Usage on macOS: codex-with-read.mjs [--check] <absolute app bundle> <absolute producer.json>\n');
  process.exit(2);
}
const [bundle, producer] = args;
const native = join(bundle, 'Contents/Resources/codex-cli/bin/codex');
const info = join(bundle, 'Contents/Info.plist');
const inspect = (file, args) => {
  const result = spawnSync(file, args, {encoding: 'utf8', timeout: 1500, maxBuffer: 4096, stdio: ['ignore', 'pipe', 'ignore']});
  return result.status === 0 ? result.stdout.trim() : '';
};
const desktop = inspect('/usr/libexec/PlistBuddy', ['-c', 'Print:CFBundleShortVersionString', info]);
const build = inspect('/usr/libexec/PlistBuddy', ['-c', 'Print:CFBundleVersion', info]);
const executable = inspect('/usr/libexec/PlistBuddy', ['-c', 'Print:CFBundleExecutable', info]);
const version = inspect(native, ['--version']);
const supported = qualifiedCodexVersions(desktop, build, version);
if (check) {
  process.stdout.write(JSON.stringify({status: supported ? 'version-supported' : 'version-unsupported', desktop, build, native: version,
    installedAcceptance: false}) + '\n');
  process.exit(supported ? 0 : 2);
}
if (!executable || executable.includes('/')) process.exit(2);
const env = {...process.env};
if (supported) {
  Object.assign(env, {CODEX_CLI_PATH: fileURLToPath(new URL('./codex-observer.mjs', import.meta.url)), CODEX_APP_SERVER_FORCE_CLI: '1',
    BUNNY_CODEX_NATIVE: native, BUNNY_CODEX_RECEIPT_PRODUCER: producer, BUNNY_CODEX_DESKTOP_VERSION: desktop, BUNNY_CODEX_DESKTOP_BUILD: build,
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}`});
} else {
  process.stderr.write('This Desktop version has not been qualified for read receipts. Starting Desktop normally.\n');
}
const child = spawn(join(bundle, 'Contents/MacOS', executable), [], {env, stdio: 'inherit'});
const terminate = () => {child.kill('SIGTERM');}, interrupt = () => {child.kill('SIGINT');};
process.on('SIGTERM', terminate); process.on('SIGINT', interrupt);
child.once('error', () => {process.exit(1);});
child.once('exit', (code, signal) => {
  process.removeListener('SIGTERM', terminate); process.removeListener('SIGINT', interrupt);
  if (signal) process.kill(process.pid, signal); else process.exit(code ?? 1);
});
