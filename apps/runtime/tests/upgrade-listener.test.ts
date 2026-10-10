import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createUpgradeListenerObserver, type UpgradeListenerReader} from '../src/upgrade-listener.js';

const header = 'sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode';
const uid = process.getuid?.() ?? -1;
const row = (inode = '987654', address = '0100007F', owner = uid): string =>
  `0: ${address}:2254 00000000:0000 0A 00000000:00000000 00:00000000 00000000 ${owner} 0 ${inode}`;

function fixture(overrides: Partial<UpgradeListenerReader> = {}): UpgradeListenerReader {
  return {
    owner: () => Promise.resolve(uid),
    tcp: (_pid, version) => Promise.resolve(Buffer.from(header + '\n' + (version === 'tcp' ? row() : '') + '\n')),
    sockets: () => Promise.resolve(['socket:[987654]', '/synthetic/ordinary-file']),
    ...overrides,
  };
}

void test('listener observation binds the selected loopback port to the named runtime PID', async t => {
  assert.deepEqual(await createUpgradeListenerObserver(fixture())(12345, 8788),
    {port: 8788, inode: '987654', uid});

  await t.test('a listener owned by another process cannot establish runtime identity', async () => {
    const reader = fixture({sockets: () => Promise.resolve(['socket:[111111]'])});
    await assert.rejects(createUpgradeListenerObserver(reader)(12345, 8788), /^Error: runtime-upgrade-listener-refused$/);
  });
  await t.test('another user, a wildcard address or a second listener refuses', async () => {
    for (const reader of [
      fixture({owner: () => Promise.resolve(uid + 1)}),
      fixture({tcp: () => Promise.resolve(Buffer.from(header + '\n' + row('987654', '0100007F', uid + 1)))}),
      fixture({tcp: () => Promise.resolve(Buffer.from(header + '\n' + row('987654', '00000000')))}),
      fixture({tcp: (_pid, version) => Promise.resolve(Buffer.from(header + '\n' + (version === 'tcp' ? row() + '\n' + row('123456') : '')))}),
    ]) await assert.rejects(createUpgradeListenerObserver(reader)(12345, 8788), /^Error: runtime-upgrade-listener-refused$/);
  });
  await t.test('a replaced socket during inspection refuses', async () => {
    let observations = 0;
    const reader = fixture({
      tcp: (_pid, version) => Promise.resolve(Buffer.from(header + '\n' + (version === 'tcp' ? row(++observations === 1 ? '987654' : '123456') : ''))),
      sockets: () => Promise.resolve(['socket:[987654]', 'socket:[123456]']),
    });
    await assert.rejects(createUpgradeListenerObserver(reader)(12345, 8788), /^Error: runtime-upgrade-listener-refused$/);
  });
  await t.test('missing, oversized and malformed observations refuse without exposing underlying errors', async () => {
    for (const reader of [
      fixture({tcp: () => Promise.resolve(Buffer.from(header + '\n'))}),
      fixture({tcp: () => Promise.resolve(Buffer.alloc(1024 * 1024 + 1))}),
      fixture({tcp: () => Promise.resolve(Buffer.from(header + '\nmalformed'))}),
      fixture({sockets: () => Promise.reject(new Error('synthetic-private-detail'))}),
    ]) await assert.rejects(createUpgradeListenerObserver(reader)(12345, 8788), /^Error: runtime-upgrade-listener-refused$/);
  });
  await t.test('invalid process and port inputs refuse before reading', async () => {
    let reads = 0;
    const observe = createUpgradeListenerObserver(fixture({owner: () => { reads++; return Promise.resolve(uid); }}));
    for (const [pid, port] of [[0, 8788], [12345, 0], [12345, 65536], [1.5, 8788]]) {
      await assert.rejects(observe(pid as number, port as number), /^Error: runtime-upgrade-listener-refused$/);
    }
    assert.equal(reads, 0);
  });
});
