// Current production module/store/outbox, isolated synthetic restart evidence.
// Actual cross-release artifacts and installed acceptance remain separate.
import assert from 'node:assert/strict';
import {createCompanionsModule} from '@jimmie-potts/companions';
import type {CompanionState} from '@jimmie-potts/event-contracts/v2/companions';
import {InProcessBus, type Scheduler} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';

type Saved = {state: CompanionState; received: string[]; admissions: Array<{key: string; atMs: number}>;
  allowances: {live: {day: string; count: number; lastAtMs: number | null}; scenario: {day: string; count: number; lastAtMs: number | null}}};

const [directory, phase] = process.argv.slice(2);
assert.ok(typeof directory === 'string' && directory.length > 0
  && ['baseline', 'candidate', 'recovery', 'reupgrade'].includes(phase ?? ''));
const now = 1_800_000_000_000;
const scheduler: Scheduler = {after: () => () => {}};
const bus = new InProcessBus({now: () => now});
const core = bus.connect('bunny/core'), operator = bus.connect('bunny/parts/qualification');
const sync = await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
const outcomes: string[] = [];
await operator.subscribe('bunny.event.*.*', message => {if (message.kind === 'outcome') outcomes.push(message.id);});
const module = createCompanionsModule();
const host = new ModuleHarness(module, {bus, stateDir: directory, clock: {now: () => now}, scheduler});
const turns = async () => {for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));};
try {
  await host.start();
  const db = host.moduleDatabase(); assert.ok(db);
  const record = () => JSON.parse((db.prepare('SELECT record FROM companion_state WHERE id=1').get() as {record: string}).record) as Saved;
  const boot = record();
  assert.equal(module.pending(), 0, 'restart never reconstructs pending reaction candidates');
  if (phase === 'baseline') {
    const reply = await core.request('bunny.cmd.companion-settings-set.reachy', {
      type: 'org.bunny.companion-settings.set.requested', subject: 'reachy',
      dataschema: 'https://bunny.invalid/events/companion-settings-set/2.0',
      data: {requestId: 'synthetic-settings', expectedRevision: boot.state.revision,
        enabled: false, muted: ['coding-notice'], snooze: 'one-hour'},
    }, {requestId: 'synthetic-settings', timeoutMs: 1000});
    assert.equal(reply.status, 'accepted', JSON.stringify(reply)); await turns();
    const saved = record();
    saved.received = ['synthetic-consumed-origin'];
    saved.admissions = [{key: 'synthetic-admission-key', atMs: now - 10_000}];
    saved.allowances = {live: {day: '2027-01-15', count: 2, lastAtMs: now - 1000},
      scenario: {day: '2027-01-15', count: 1, lastAtMs: now - 2000}};
    saved.state.presentation = {text: 'Synthetic retained presentation', phrase: 0,
      presentedAtMs: now - 40_000, history: false, content: 'unavailable', opportunity: {
        origin: {id: 'synthetic-prior-arrival', source: 'synthetic-fixture', type: 'arrival'},
        sourceKind: 'simulated-apartment', context: 'scenario', category: 'simulated-social', cue: 'arrival',
        revision: 0, generation: 0, session: null, identity: null, turn: {status: 'unknown'},
        attention: null, noticeId: null, evidence: 'fixture', occurredAtMs: null,
        observedAtMs: now - 60_000, validUntilMs: now - 30_000, busy: false, media: false, visitor: null, location: null,
      }};
    db.prepare('UPDATE companion_state SET record=? WHERE id=1').run(JSON.stringify(saved));
    db.exec("UPDATE bunny_outbox SET published=0 WHERE kind='outcome'");
  }
  await turns();
  assert.equal(module.pending(), 0);
  const rows = db.prepare("SELECT id,message FROM bunny_outbox WHERE kind='outcome' ORDER BY seq").all();
  process.stdout.write(JSON.stringify({phase, pid: process.pid, boot, record: record(), outcomes: rows, republished: outcomes}));
} finally {
  await host.stop(); await sync.close(); await operator.close(); await core.close();
  assert.deepEqual(host.failures, []); assert.equal(host.databaseOpen(), false);
}
