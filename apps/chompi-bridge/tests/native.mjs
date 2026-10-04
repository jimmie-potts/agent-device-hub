// Native Windows check: run with native Windows Node 24 after `npm run build`. It enumerates HID devices read-only
// (nothing is opened, read or written), checks that the matcher rejects the attached stock CHOMPI, checks the
// named-pipe single-instance lock across processes, then runs the portable suites under this runtime.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeHidTransport, loadNodeHid } from '../dist/node-hid-transport.js';
import { matchesController } from '../dist/matcher.js';
import { acquireInstanceLock, defaultLockPath, InstanceLockHeldError } from '../dist/lock.js';

assert.equal(process.platform, 'win32', 'native CHOMPI bridge check requires Windows');
assert.equal(process.versions.node.split('.')[0], '24', 'native CHOMPI bridge check requires Node 24');
const here = dirname(fileURLToPath(import.meta.url));

const hid = await loadNodeHid();
const devices = await createNodeHidTransport(async () => hid).list();
const stock = devices.filter(device => device.vendorId === 0x0483 && device.productId === 0x5740);
assert.equal(stock.some(device => matchesController(device)), false, 'the stock CHOMPI ID must never match');
assert.equal(matchesController({ vendorId: 0x0483, productId: 0x5740, product: 'CHOMPI', usagePage: 0xff00, usage: 0x01 }), false);
const controllers = devices.filter(device => matchesController(device));
for (const device of controllers) assert.equal(device.vendorId === 0x1209 && device.productId === 0x000c && device.product === 'Agent Controller', true);

const pipe = `${defaultLockPath()}-native-check-${process.pid}`;
assert.match(pipe, /^\\\\\.\\pipe\\agent-chompi-bridge-/);
const lockModule = new URL('../dist/lock.js', import.meta.url).href;
async function holder() {
  const source = `const {acquireInstanceLock}=await import(${JSON.stringify(lockModule)});
const lock=await acquireInstanceLock(${JSON.stringify(pipe)});
process.stdout.write('held\\n');
process.stdin.on('data',async()=>{await lock.release();process.exit(0);});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['pipe', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', data => { out += data; });
  while (!out.includes('held')) {
    if (child.exitCode !== null) throw new Error('lock holder exited early');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return child;
}

const graceful = await holder();
await assert.rejects(acquireInstanceLock(pipe), InstanceLockHeldError, 'a second holder must be refused');
graceful.stdin.write('release\n');
assert.deepEqual(await once(graceful, 'exit'), [0, null]);
await (await acquireInstanceLock(pipe)).release();

const killed = await holder();
await assert.rejects(acquireInstanceLock(pipe), InstanceLockHeldError);
killed.kill();
await once(killed, 'exit');
await (await acquireInstanceLock(pipe)).release();

// node --test treats its arguments as globs, where Windows backslashes are escapes; pass names relative to cwd.
// The codec fixture suite stays on the Linux runs: it resolves the protocol workspace through a symlink that
// Windows does not follow on a \\wsl.localhost checkout, and it has no platform-specific code.
const suites = ['bridge', 'simulator', 'lock', 'node-hid-transport', 'os-adapter'].map(name => `${name}.test.mjs`);
const portable = spawnSync(process.execPath, ['--test', ...suites], { cwd: here, encoding: 'utf8', timeout: 120000 });
assert.equal(portable.status, 0, portable.stdout + portable.stderr);
const count = /^ℹ pass (\d+)$/m.exec(portable.stdout)?.[1];

console.log(JSON.stringify({
  result: 'passed',
  scope: 'read-only HID enumeration, matcher, named-pipe lock and portable suites; no device opened',
  node: process.versions.node,
  hidapi: hid.getHidapiVersion?.() ?? null,
  hidInterfaces: devices.length,
  stockChompiHidInterfaces: stock.length,
  controllerMatches: controllers.length,
  lock: { secondHolderRefused: true, releasedOnExit: true, releasedOnKill: true },
  portableTestsPassed: Number(count),
}));
