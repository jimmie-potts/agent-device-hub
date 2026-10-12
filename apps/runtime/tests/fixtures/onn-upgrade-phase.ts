// One process per compatibility phase, using the production module and its stores.
// This is a synthetic restart proof; it does not select or qualify a release artifact.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createOnnModule, type OnnTransport, type HistoryPage, type HistoryState} from '@jimmie-potts/onn';
import {InProcessBus, type Scheduler} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';

const [directory, phase] = process.argv.slice(2);
assert.ok(typeof directory === 'string' && directory.length > 0);
const index = ['baseline', 'candidate', 'recovery', 'reupgrade'].indexOf(phase ?? '');
assert.ok(index >= 0);
let now = 1_800_000_000_000 + index * 60_000, effects = 0;
const timers: Array<{ms: number; work: () => void; canceled: boolean}> = [];
const scheduler: Scheduler = {after: (ms, work) => {
  const timer = {ms, work, canceled: false}; timers.push(timer);
  return () => {timer.canceled = true;};
}};
const turns = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve));
};
const transport: OnnTransport = {
  execute: () => {effects++; return Promise.resolve({result: 'succeeded', evidence: 'transmitted', connection: 'available'});},
  read: () => Promise.resolve({app: 'stremio', metadata: {
    schema: 'onn-metadata/2.0', deviceElapsedMs: 1000 + index * 60_000,
    sessions: (['youtube', 'stremio'] as const).map(app => ({app, metadata: {
      title: app === 'youtube' ? 'Synthetic selected title' : 'Synthetic series',
      displayTitle: app === 'youtube' ? null : `Synthetic episode ${index}`,
      subtitle: null, artist: 'Synthetic creator', album: null, genre: null,
      description: 'Original synthetic metadata '.repeat(40), mediaId: `synthetic-${app}`,
      durationMs: 600_000,
    }, playback: {state: index === 1 ? 2 : 3, positionMs: 10_000 + index * 20_000,
      speed: index === 1 ? 0 : 1, positionUpdatedElapsedMs: 1000 + index * 60_000}, omissions: []})),
  }}),
};
const bus = new InProcessBus({now: () => now}), operator = bus.connect('bunny/parts/upgrade-proof');
const received: object[] = [];
await operator.subscribe('bunny.event.*.*', message => {if (message.kind === 'outcome') received.push(message);});
const module = createOnnModule({transport});
const host = new ModuleHarness(module, {bus, stateDir: directory, clock: {now: () => now}, scheduler,
  section: {id: 'onn', configurationRevision: 1, historyEnabled: true,
    adbSocket: '/not-configured/socket', serial: '192.0.2.10:12345', hostExecutable: '/not-configured/adb',
    hostExecutableSha256: '0'.repeat(64), hostVersion: '37.0.1', hostKeyDirectory: '/not-configured/keys'},
});
try {
  await host.start();
  const database = host.moduleDatabase(); assert.ok(database);
  const command = (family: 'onn-text' | 'onn-key-press', data: object, requestId: string) => operator.request(
    `bunny.cmd.${family}.onn`, {type: family === 'onn-text' ? 'org.bunny.onn.text.requested' : 'org.bunny.onn-key.press.requested',
      subject: 'onn', dataschema: `https://bunny.invalid/events/${family}/2.0`, data}, {requestId, timeoutMs: 1000});
  const text = {text: 'SYNTHETIC_MEMORY_ONLY_INPUT'};
  if (index === 0) {
    assert.equal((await command('onn-text', text, 'retained-text')).status, 'accepted'); await turns();
    for (const id of ['interrupted-accepted', 'interrupted-started']) {
      assert.equal((await command('onn-key-press', {key: 'left'}, id)).status, 'accepted'); await turns();
      // Model loss at these durable journal stages, before outcome publication.
      database.prepare("DELETE FROM bunny_outbox WHERE json_extract(message, '$.data.requestId') = ?").run(id);
      database.prepare("UPDATE onn_requests SET record = json_remove(json_set(record, '$.state', ?), '$.outcome') WHERE request_id = ?")
        .run(id.endsWith('accepted') ? 'accepted' : 'started', id);
    }
    database.exec("UPDATE bunny_outbox SET published = 0 WHERE kind = 'outcome'");
  } else {
    assert.equal((await command('onn-text', text, 'retained-text')).status, 'accepted');
    const conflict = await command('onn-text', {text: 'DIFFERENT_SYNTHETIC_INPUT'}, 'retained-text');
    assert.ok('error' in conflict); assert.equal(conflict.error.error.code, 'duplicate-conflict');
  }
  const timer = timers.find(row => !row.canceled && row.ms === 0); assert.ok(timer);
  timer.canceled = true; now += 1; timer.work(); await turns();
  const read = async <T>(name: string): Promise<T> => {
    const result = await module.manifest.content?.(name, {query: {}, signal: AbortSignal.timeout(1000)});
    assert.ok(result && 'bytes' in result); return JSON.parse(Buffer.from(result.bytes).toString()) as T;
  };
  const page = await read<HistoryPage>('history'), state = await read<HistoryState>('history-state');
  assert.equal(state.status, 'fresh'); assert.equal(state.current.length, 2);
  assert.equal(state.current[0]?.playback?.positionMs, 10_000 + index * 20_000);
  const snapshot = {
    phase, pid: process.pid, effects, received,
    originals: database.prepare('SELECT * FROM onn_history_intakes ORDER BY sequence').all(),
    observations: database.prepare('SELECT * FROM onn_history_observations ORDER BY id').all(),
    gaps: database.prepare('SELECT * FROM onn_history_gaps ORDER BY sequence').all(),
    requests: database.prepare('SELECT record FROM onn_requests ORDER BY request_id').all(),
    outcomes: database.prepare("SELECT id, message FROM bunny_outbox WHERE kind='outcome' ORDER BY seq").all(),
    privateKeySha256: createHash('sha256').update(await readFile(join(directory, 'onn', 'request-digest.key'))).digest('hex'),
    cursorKey: database.prepare('SELECT key FROM onn_history_key').get(), page, state,
  };
  process.stdout.write(JSON.stringify(snapshot));
} finally {
  await host.stop(); await operator.close();
  assert.deepEqual(host.failures, []); assert.equal(host.databaseOpen(), false);
}
