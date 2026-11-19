import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {SdkError} from '@jimmie-potts/sdk';
import {createMusicShowAuthoringProvider, type MusicShowAuthoringInput} from '../src/music-show-authoring-provider.js';

const input: MusicShowAuthoringInput = {title: 'Fixture title', artist: 'Fixture artist', style: 'Fixture style',
  analysis: {method: 'energy-onset-v1', sampleCount: 10, spans: [{offsetMs: 1000, durationMs: 1000, intensity: 0.5}]}};
const usage = {input_tokens: 250, output_tokens: 100, output_tokens_details: {thinking_tokens: 70}};
const message = (text: string) => new Response(JSON.stringify({model: 'claude-fable-5-2', stop_reason: 'end_turn',
  content: [{type: 'thinking', thinking: 'hidden'}, {type: 'text', text}], usage}));
const code = (expected: string) => (error: unknown) => error instanceof SdkError && error.body.error.code === expected;

void test('sends exactly one bounded Claude request through the approved route', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const {signal} = new AbortController();
  let calls = 0;
  const generate = createMusicShowAuthoringProvider({key: 'fixture-key', db, transport: (url, request) => {
    calls++;
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(request.redirect, 'error');
    const body: unknown = JSON.parse(request.body);
    assert.ok(typeof body === 'object' && body !== null);
    assert.ok('model' in body && body.model === 'claude-fable-5-2');
    assert.ok(!('stream' in body) && !('tools' in body));
    assert.ok('messages' in body && Array.isArray(body.messages));
    const first: unknown = body.messages[0];
    assert.ok(typeof first === 'object' && first !== null && 'content' in first && typeof first.content === 'string');
    assert.deepEqual(JSON.parse(first.content), input);
    return Promise.resolve(message('{"cues":[]}'));
  }});
  assert.deepEqual(await generate(input, signal, 'generation-1'), {draft: {cues: []}, costUsd: 0.006});
  await assert.rejects(generate(input, signal, 'generation-1'), code('duplicate-conflict'));
  assert.equal(calls, 1);
});

void test('records provider charges for malformed output and holds unknown charges across restart', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const {signal} = new AbortController();
  const generate = createMusicShowAuthoringProvider({key: 'fixture-key', db, transport: () => Promise.resolve(message('not JSON'))});
  await assert.rejects(generate(input, signal, 'invalid-answer'), code('invalid-message'));
  assert.deepEqual({...db.prepare('SELECT status, cost_micros FROM music_show_authoring_spend').get()},
    {status: 'settled', cost_micros: 6000});
  const controller = new AbortController();
  const interrupted = createMusicShowAuthoringProvider({key: 'fixture-key', db, transport: () => {
    controller.abort();
    return Promise.reject(new Error('private upstream error'));
  }});
  await assert.rejects(interrupted(input, controller.signal, 'interrupted'), code('uncertain-result'));
  const restarted = createMusicShowAuthoringProvider({key: 'fixture-key', db, transport: () => assert.fail('no dispatch')});
  await assert.rejects(restarted(input, signal, 'interrupted'), code('duplicate-conflict'));
  assert.deepEqual({...db.prepare("SELECT status, cost_micros FROM music_show_authoring_spend WHERE request_id='interrupted'").get()},
    {status: 'uncertain', cost_micros: null});
});

void test('cancelled requests consume no allowance before dispatch and in-flight requests share both limits', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const controller = new AbortController();
  controller.abort();
  const {signal} = new AbortController();
  let now = new Date(2026, 10, 15, 12).getTime();
  let calls = 0;
  let complete: ((response: Response) => void) | undefined;
  const generate = createMusicShowAuthoringProvider({key: 'fixture-key', db, now: () => now, transport: async () => {
    calls++;
    return new Promise(resolve => { complete = resolve; });
  }});
  await assert.rejects(generate(input, controller.signal, 'before-dispatch'), code('cancelled'));
  assert.equal(calls, 0);
  const seed = db.prepare(`INSERT INTO music_show_authoring_spend
    (request_id,model,day,status,reserved_micros,cost_micros) VALUES (?,'claude-fable-5-2',?,'settled',1,?)`);
  seed.run('spent-yesterday', '2026-11-14', 10_000_000);
  seed.run('spent-today', '2026-11-15', 2_700_000);
  const inFlight = generate(input, signal, 'first');
  await assert.rejects(generate(input, signal, 'second'), (error: unknown) => code('capacity')(error) && /daily/.test(String(error)));
  assert.equal(calls, 1);
  assert.ok(complete);
  complete(message('{"cues":[]}'));
  await inFlight;
  db.prepare('UPDATE music_show_authoring_spend SET cost_micros=17700000 WHERE request_id=?').run('spent-yesterday');
  now = new Date(2026, 10, 16, 12).getTime();
  await assert.rejects(generate(input, signal, 'next-day'), (error: unknown) => code('capacity')(error) && /monthly/.test(String(error)));
  assert.equal(calls, 1);
});

void test('startup retains dispatched reservations that never recorded a provider result', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const options = {key: 'fixture-key', db, transport: () => assert.fail('no dispatch')};
  createMusicShowAuthoringProvider(options);
  db.exec(`INSERT INTO music_show_authoring_spend
    (request_id,model,day,status,reserved_micros) VALUES ('crash','claude-fable-5-2','2026-11-15','dispatched',200000)`);
  const afterRestart = createMusicShowAuthoringProvider(options);
  assert.deepEqual({...db.prepare('SELECT status, reserved_micros FROM music_show_authoring_spend').get()},
    {status: 'uncertain', reserved_micros: 200000});
  await assert.rejects(afterRestart(input, new AbortController().signal, 'crash'), code('duplicate-conflict'));
});
