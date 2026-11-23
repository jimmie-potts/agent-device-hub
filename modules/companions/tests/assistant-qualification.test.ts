// The concurrency qualification (Hub #2027): three conversations' graphs run at once on the module's one SQLite
// connection with scripted model replies in mixed order, then the process exits abruptly and starts again. Every record
// stays with its own conversation: checkpoints, per-turn limits, spend reservations, cancellation fences, titles and
// session reports. The fixture runs in child processes with a manual clock.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

type Observed = {session: string; turn: string | null; sequence: number | null; kind: string; title: string | null};
type Saved = {id: string; profile: 'bunny' | 'reachy' | 'microduck'; conversationId: string; status: string; code: string | null; modelCalls: number; questions: number;
  transcript: {role: string; text?: string | null; result?: string}[]; calls: {id: string; status: string}[]};
type Restarted = {startupCalls: number[]; recovered: Record<string, string>; startupObserved: Observed[]; observed: Observed[]; resume: string;
  tasks: Saved[]; checkpoints: {taskId: string; values: {taskId?: string} | null}[]; threads: string[]; spend: {id: string; purpose: string; owner: string}[];
  titles: {conversationId: string; title: string | null}[]; titleCalls: {id: string; conversationId: string}[]; reports: Record<string, number>;
  messages: Record<string, string[]>; calls: number[]};
const TITLES = {bunny: 'Garden lights check', reachy: 'Pantry shelf labels', microduck: 'Bath timer'} as const;

void test('three conversations run at once, survive an abrupt exit and a restart, and keep every record to themselves', () => {
  const dir = mkdtempSync(join(tmpdir(), 'assistant-qualification-'));
  const child = (mode: string) => spawnSync(process.execPath, [new URL('./assistant-qualification-child.js', import.meta.url).pathname, dir, mode], {encoding: 'utf8', timeout: 60_000});
  try {
    const crashed = child('crash');
    assert.equal(crashed.status, 23, crashed.stderr);
    const before = JSON.parse(crashed.stdout) as {concurrent: number; observed: Observed[]};
    assert.equal(before.concurrent, 3, 'three tasks ran at once');
    const run = child('restart');
    assert.equal(run.status, 0, run.stderr);
    const after = JSON.parse(run.stdout) as Restarted;

    // A restart recovers each conversation alone and starts no work.
    assert.deepEqual(after.startupCalls, [0, 0, 0], 'startup sends no model call');
    // Two conversations lost a call in flight; each is recovered uncertain on its own, and the waiting one stays waiting.
    assert.deepEqual(after.recovered, {bunny: 'uncertain', reachy: 'waiting', microduck: 'uncertain'});
    assert.equal(after.resume, 'uncertain-result', 'the call whose answer was lost is never retried');
    assert.deepEqual(after.calls, [0, 1, 0], 'only the answered Reachy question sent another call');

    const byProfile = (profile: Saved['profile']) => after.tasks.filter(task => task.profile === profile);
    const conversations = new Set(after.tasks.map(task => task.conversationId));
    assert.equal(conversations.size, 3);
    assert.deepEqual(after.tasks.map(task => [task.profile, task.status]).sort(), [['bunny', 'uncertain'], ['microduck', 'cancelled'], ['microduck', 'uncertain'], ['reachy', 'succeeded']]);

    // Checkpoints: each task's graph thread holds its own state, and no thread is anyone else's.
    assert.deepEqual([...after.threads].sort(), after.tasks.map(task => task.id).sort());
    for (const {taskId, values} of after.checkpoints) assert.equal(values?.taskId, taskId);
    // The working transcripts carry only their own conversation's text.
    for (const task of after.tasks) {
      const text = JSON.stringify(task.transcript);
      for (const other of ['bunny', 'reachy', 'microduck'].filter(profile => profile !== task.profile)) assert.equal(text.includes(other), false, `${task.profile} transcript: ${text}`);
    }
    // Per-turn limits count each task's own calls and questions.
    const [bunny] = byProfile('bunny'), [reachy] = byProfile('reachy'), [cancelled, second] = byProfile('microduck');
    assert.ok(bunny && reachy && cancelled && second);
    assert.deepEqual([bunny.modelCalls, bunny.questions], [2, 1]);
    assert.deepEqual([reachy.modelCalls, reachy.questions], [2, 1]);
    assert.deepEqual([cancelled.modelCalls, cancelled.questions, second.modelCalls, second.questions], [1, 0, 1, 0]);
    // Cancellation fences: the cancelled turn kept its late answer out, and the call lost in the exit keeps its admitted
    // receipt, so its fate stays unknown.
    assert.equal(after.messages.microduck?.some(text => text.includes('late')), false);
    assert.deepEqual(bunny.calls.map(call => call.status).sort(), ['admitted', 'succeeded']);
    assert.deepEqual(second.calls.map(call => call.status), ['admitted']);
    assert.equal(bunny.code, 'uncertain-result'); assert.equal(second.code, 'uncertain-result');

    // Spend: each paid model call reserved once under its own task, and each title call under its own conversation.
    const taskRows = after.spend.filter(row => row.purpose === 'task');
    for (const task of after.tasks) {
      const own = taskRows.filter(row => row.owner === task.id);
      assert.equal(own.length, task.modelCalls, `${task.profile} reserved once per model call`);
      assert.ok(own.every(row => row.id.startsWith(`${task.id}-step-`)));
    }
    assert.equal(taskRows.length, after.tasks.reduce((sum, task) => sum + task.modelCalls, 0));
    const titleRows = after.spend.filter(row => row.purpose === 'conversation');
    assert.deepEqual(titleRows.map(row => row.owner).sort(), [...conversations].sort());
    assert.deepEqual(titleRows.map(row => row.id).sort(), after.titleCalls.map(call => call.id).sort());

    // Titles: one call per conversation, written from its own messages.
    for (const task of [bunny, reachy, second]) {
      assert.deepEqual(after.titles.find(row => row.conversationId === task.conversationId)?.title, TITLES[task.profile], task.profile);
      assert.equal(after.titleCalls.filter(call => call.conversationId === task.conversationId).length, 1);
    }

    // Session reports: every observation, from both processes, is on its own conversation's session and turn, and each
    // conversation's ordering runs 1, 2, 3 ... with no gap or repeat, ending at the sequence it saved.
    const seen = new Map<string, Observed>(), all = [...before.observed, ...after.observed];
    for (const item of all) if (item.kind !== 'metadata-observed') seen.set(`${item.session}:${String(item.sequence)}`, item);
    for (const conversationId of conversations) {
      const own = [...seen.values()].filter(item => item.session === conversationId).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
      const turns = new Set(after.tasks.filter(task => task.conversationId === conversationId).map(task => task.id));
      assert.ok(own.every(item => item.turn !== null && turns.has(item.turn)), `${conversationId} observations stay on its own turns`);
      assert.deepEqual(own.map(item => item.sequence), own.map((_item, index) => index + 1));
      assert.equal(own.length, after.reports[conversationId]);
    }
    // A title observation carries no turn or sequence, and only its own conversation's title.
    for (const task of [bunny, reachy, second]) {
      const titled = all.filter(item => item.kind === 'metadata-observed' && item.session === task.conversationId);
      assert.ok(titled.length > 0 && titled.every(item => item.title === TITLES[task.profile] && item.turn === null && item.sequence === null), JSON.stringify(titled));
    }
    // Every observation, title or not, is on one of the three conversations' sessions; reported titles name their own.
    assert.ok(all.every(item => conversations.has(item.session)));
    for (const item of all) {
      const owner = after.tasks.find(task => task.conversationId === item.session);
      assert.ok(owner !== undefined && (item.title === null || item.title === TITLES[owner.profile] || item.title === {bunny: 'B.U.N.N.Y.', reachy: 'Reachy', microduck: 'MicroDuck'}[owner.profile]), JSON.stringify(item));
    }
    // The restart reported the lost call once and nothing new for the waiting or finished conversations; the outbox may
    // still republish what was committed before the exit.
    const fresh = after.startupObserved.filter(item => !before.observed.some(old => old.session === item.session && old.sequence === item.sequence));
    const republished = new Set(fresh.filter(item => item.kind !== 'turn-uncertain').map(item => `${item.session}:${String(item.sequence)}`));
    assert.deepEqual(fresh.filter(item => item.kind === 'turn-uncertain').map(item => item.session).sort(), [bunny.conversationId, second.conversationId].sort(),
      'each conversation that lost its call reports it once, on its own turn');
    assert.deepEqual(fresh.filter(item => item.kind === 'turn-uncertain').map(item => item.turn).sort(), [bunny.id, second.id].sort());
    for (const key of republished) assert.ok(![bunny.conversationId, second.conversationId].some(id => key.startsWith(`${id}:`) && Number(key.split(':')[1]) >= (after.reports[id] ?? 0)), key);
  } finally {rmSync(dir, {recursive: true, force: true});}
});
