#!/usr/bin/env node
// An explicit launch selection, with no edits to the app, its profile, hooks or personal settings.
import {spawn, spawnSync} from 'node:child_process';
import {accessSync, constants, statSync} from 'node:fs';
import {dirname, isAbsolute, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const check = process.argv[2] === '--check';
const args = process.argv.slice(check ? 3 : 2);
if (args.length !== 2 || args.some(arg => !isAbsolute(arg)) || process.platform !== 'darwin') {
  process.stderr.write('Usage on macOS: codex-with-read.mjs [--check] <absolute app bundle> <absolute producer.json>\n');
  process.exit(2);
}
const [bundle, producer] = args;
const native = join(bundle, 'Contents/Resources/codex-cli/bin/codex');
const info = join(bundle, 'Contents/Info.plist');
const observer = fileURLToPath(new URL('./codex-observer.mjs', import.meta.url));
const available = path => {
  try {accessSync(path, constants.X_OK); return statSync(path).isFile();} catch {return false;}
};
const inspect = (file, args) => {
  const result = spawnSync(file, args, {encoding: 'utf8', timeout: 1500, maxBuffer: 4096, stdio: ['ignore', 'pipe', 'ignore']});
  return result.status === 0 ? result.stdout.trim() : '';
};
const desktop = inspect('/usr/libexec/PlistBuddy', ['-c', 'Print:CFBundleShortVersionString', info]);
const build = inspect('/usr/libexec/PlistBuddy', ['-c', 'Print:CFBundleVersion', info]);
const executable = inspect('/usr/libexec/PlistBuddy', ['-c', 'Print:CFBundleExecutable', info]);
const bundleId = inspect('/usr/libexec/PlistBuddy', ['-c', 'Print:CFBundleIdentifier', info]);
const application = executable && executable !== '.' && executable !== '..' && !executable.includes('/')
  ? join(bundle, 'Contents/MacOS', executable) : undefined;
const selected = bundleId === 'com.openai.codex' && application !== undefined && available(application) && available(native) && available(observer);
const version = bundleId === 'com.openai.codex' ? inspect(native, ['--version']) : '';
if (check) {
  process.stdout.write(JSON.stringify({status: selected ? 'observer-ready' : 'observer-unavailable', bundleId, desktop, build, native: version,
    compatibility: 'checked-per-action', installedAcceptance: false}) + '\n');
  process.exit(selected ? 0 : 2);
}
if (application === undefined) process.exit(2);
const env = {...process.env};
if (selected) {
  Object.assign(env, {CODEX_CLI_PATH: observer, CODEX_APP_SERVER_FORCE_CLI: '1',
    BUNNY_CODEX_NATIVE: native, BUNNY_CODEX_RECEIPT_PRODUCER: producer,
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}`});
} else {
  process.stderr.write('The read observer is unavailable for this application. Starting it normally.\n');
}
const child = spawn(application, [], {env, stdio: 'inherit'});
const terminate = () => {child.kill('SIGTERM');}, interrupt = () => {child.kill('SIGINT');};
process.on('SIGTERM', terminate); process.on('SIGINT', interrupt);
child.once('error', () => {process.exit(1);});
child.once('exit', (code, signal) => {
  process.removeListener('SIGTERM', terminate); process.removeListener('SIGINT', interrupt);
  if (signal) process.kill(process.pid, signal); else process.exit(code ?? 1);
});
