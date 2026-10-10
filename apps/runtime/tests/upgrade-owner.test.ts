import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createUpgradeOwnerObserver} from '../src/upgrade-owner.js';

void test('observes the fixed runtime service and binds its live process start and arguments', async t => {
  const uid = process.getuid?.();
  assert.ok(typeof uid === 'number');
  const service = ['LoadState=loaded', 'ActiveState=active', 'SubState=running', 'MainPID=421',
    'ExecMainStartTimestampMonotonic=999999', 'FragmentPath=/home/synthetic/runtime.service',
    'DropInPaths=', 'ControlGroup=/user.slice/synthetic.service'].join('\n') + '\n';
  const stat = '421 (synthetic ) runtime) S ' + Array<string>(18).fill('0').join(' ') + ' 12345 0\n';
  const argv = ['/opt/node/bin/node', '/private/release/apps/runtime/dist/src/main.js', '--port', '8788',
    '--state-dir', '/private/state', '--config', '/private/runtime.json', '--environment', 'production', '--edge'];
  const io = {
    show: () => Promise.resolve(service),
    owner: (pid: number) => { assert.equal(pid, 421); return Promise.resolve(uid); },
    read: (pid: number, name: string) => {
      assert.equal(pid, 421);
      if (name === 'stat') return Promise.resolve(Buffer.from(stat));
      assert.equal(name, 'cmdline');
      return Promise.resolve(Buffer.from(argv.join('\0') + '\0'));
    },
    link: (pid: number, name: string) => {
      assert.equal(pid, 421);
      return Promise.resolve(name === 'exe' ? '/opt/node/bin/node' : '/private/release');
    },
  };
  const observed = await createUpgradeOwnerObserver(io)();
  assert.equal(observed.service, 'bunny-runtime.service');
  assert.equal(observed.pid, 421);
  assert.equal(observed.startTicks, '12345');
  assert.equal(observed.startMonotonic, '999999');
  assert.equal(observed.entry, argv[1]);
  assert.deepEqual(observed.argv, argv);
  assert.deepEqual(observed.units, ['/home/synthetic/runtime.service']);
  assert.deepEqual(observed.options, {port: 8788, stateDir: '/private/state', config: '/private/runtime.json',
    environment: 'production', edge: true, simulate: false, recordSpans: false, lagLimitMs: 10000, logLevel: 'info'});

  await t.test('a restart during observation refuses', async () => {
    let shows = 0;
    await assert.rejects(createUpgradeOwnerObserver({...io, show: () => Promise.resolve(++shows === 1
      ? service : service.replace('Monotonic=999999', 'Monotonic=999998'))})(), /^Error: runtime-upgrade-owner-refused$/);
  });
  await t.test('PID reuse during observation refuses', async () => {
    let stats = 0;
    await assert.rejects(createUpgradeOwnerObserver({...io, read: (pid, name) => name === 'stat'
      ? Promise.resolve(Buffer.from(++stats === 1 ? stat : stat.replace('12345', '54321'))) : io.read(pid, name)})(),
    /^Error: runtime-upgrade-owner-refused$/);
  });
  await t.test('a process owned by another user refuses', async () => {
    await assert.rejects(createUpgradeOwnerObserver({...io, owner: () => Promise.resolve(uid + 1)})(),
      /^Error: runtime-upgrade-owner-refused$/);
  });
  await t.test('missing or duplicate service observations cannot select a process', async () => {
    for (const changed of [service.replace('MainPID=421\n', ''), service + 'MainPID=422\n',
      service.replace('ActiveState=active', 'ActiveState=inactive')]) {
      await assert.rejects(createUpgradeOwnerObserver({...io, show: () => Promise.resolve(changed),
        owner: () => { assert.fail('must refuse before inspecting a guessed process'); }})(),
      /^Error: runtime-upgrade-owner-refused$/);
    }
  });
  await t.test('unavailable service manager refuses without exposing its message', async () => {
    await assert.rejects(createUpgradeOwnerObserver({...io, show: () =>
      Promise.reject(new Error('synthetic private service-manager detail'))})(), /^Error: runtime-upgrade-owner-refused$/);
  });
  await t.test('incomplete cmdline and unknown runtime arguments refuse', async () => {
    for (const command of [Buffer.from(argv.join('\0')), Buffer.from([...argv, '--secret', 'synthetic-secret'].join('\0') + '\0')]) {
      await assert.rejects(createUpgradeOwnerObserver({...io, read: (pid, name) => name === 'cmdline'
        ? Promise.resolve(command) : io.read(pid, name)})(), /^Error: runtime-upgrade-owner-refused$/);
    }
  });
});
