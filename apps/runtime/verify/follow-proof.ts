// The proof of Hub #950, as one capture step: a run follows one request through its diagnostics in each case that ADR
// 0012's "Following one request" names, with the fixture modules, the simulated lamp and a remote part, whose every
// command goes through the core's dispatcher on the gateway's action route (#782):
//
//   - a success,
//   - a refusal, which the lamp makes of a lamp it does not have,
//   - an uncertain effect: the device holds the switch past the command's deadline,
//   - a replayed outcome: the core's acknowledgment is lost, so the next runtime sends the outcome again,
//
// and then the evidence that is missing or capped: a command whose runtime was killed before it could finish, a request
// that was never sent, and a query over its limits. Each answer is attached as it came from the run's query, and each
// is judged by what it must say and must not say.
import type {CaptureContext} from '@jimmie-potts/app-verify';
import {switchLamp} from '../tests/fixtures/lamp.js';
import type {Seed} from '../tests/scenarios/framework.js';
import {connectRun, type RunHarness} from './adapter.js';
import type {Followed} from './follow.js';
import {HARNESS_PATH} from './protocol.js';

/** The modules the proof needs: the stand-in core, the lamp and the chime, which the fixtures run seeds. */
export const FOLLOW_SEED: Seed = {modules: ['core', 'lamp', 'chime'], follows: [['session'], ['lamp']]};
const POLL_MS = 100;
const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

/** Asks the run's harness to follow a request or a trace, as `request=<id>` or `trace=<id>`, with any limits. */
export async function ask(harness: string, query: string, signal?: AbortSignal): Promise<Followed> {
  const response = await fetch(new URL(`${HARNESS_PATH}/follow?${query}`, harness), signal === undefined ? {} : {signal});
  if (!response.ok) throw new Error(`the follow query answered ${response.status}`);
  return await response.json() as Followed;
}

/** Asks until `ready` holds or `timeoutMs` passes; the last answer is returned either way, and its checks say what is missing. */
async function until(harness: string, query: string, ready: (followed: Followed) => boolean, timeoutMs = 15_000): Promise<Followed> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const followed = await ask(harness, query);
    if (ready(followed) || performance.now() > deadline) return followed;
    await sleep(POLL_MS);
  }
}

const eventsOf = (followed: Followed): string[] => followed.records.map(entry => entry.event);
const count = (followed: Followed, event: string): number => followed.records.filter(entry => entry.event === event).length;
const gapKinds = (followed: Followed): string[] => followed.gaps.map(gap => gap.kind);
const endings = (followed: Followed): string[] => followed.decision.endings.map(ending => [ending.event, ending.level, ending.code].filter(part => part !== undefined).join(' '));
/** Spans with a parent that the answer says is not kept. */
const orphans = (followed: Followed): string[] => followed.spans.filter(span => span.parent?.state === 'missing').map(span => span.name);

function must(condition: boolean, what: string): asserts condition {
  if (!condition) throw new Error(what);
}

/** Attaches an answer as it came, with the proof's own labels. */
async function keep(t: CaptureContext, file: string, label: string, followed: Followed): Promise<void> {
  await t.attach(`follow-${file}.json`, `${JSON.stringify({synthetic: true, physical: false, case: label, followed}, null, 2)}\n`);
}

/** Runs the cases against the run and judges each answer. The run must be freshly seeded with the fixture modules. */
export async function followProof(t: CaptureContext, harness: string): Promise<void> {
  const run: RunHarness = await connectRun({url: t.url, harness, dataDir: t.dataDir, seed: FOLLOW_SEED});
  try {
    // Each command is a tracked action, with the device kind's 5 s reply deadline.
    const send = (label: string, requestId: string, lamp: string): Promise<string> => run.dispatch('operator', label, switchLamp(lamp, 'on'), requestId);

    // A success
    let answer = await send('ok', 'follow-ok', 'lamp-1');
    const success = await until(harness, 'request=follow-ok', followed => count(followed, 'outcome.published') > 0 && followed.names['bunny.outcome.publish'] !== undefined);
    await keep(t, 'success', 'a success', success);
    await t.expect('a success: the lamp accepted it, and the run follows it from its admission to its outcome in one trace, with no span\'s parent missing', () => {
      must(answer === 'accepted', `the answer was ${answer}`);
      must(endings(success).join() === 'replied INFO' && success.decision.ended, `its endings were ${endings(success).join()}`);
      must(['runtime.command.admitted', 'command.executing', 'outcome.published'].every(event => eventsOf(success).includes(event)), `its records were ${eventsOf(success).join()}`);
      must(Object.keys(success.names).sort().join() === 'bunny.command.execute,bunny.command.queue,bunny.command.request,bunny.device.call,bunny.outcome.publish', `its spans were ${Object.keys(success.names).join()}`);
      must(success.traces.length === 1, `it had ${success.traces.length} traces`);
      must(orphans(success).length === 0, `${orphans(success).join()} lost their parent`);
      // The one gap a healthy live run has: its losses are counted only when its runtime stops.
      must(gapKinds(success).join() === 'losses-uncounted' && Object.values(success.omitted).every(left => left === 0), `it reported ${gapKinds(success).join()}`);
    });

    // A refusal: the lamp is not one the module has, so the owner refuses it, which is a domain refusal at INFO.
    answer = await send('refused', 'follow-refused', 'lamp-9');
    const refusal = await until(harness, 'request=follow-refused', followed => followed.decision.endings.length > 0);
    await keep(t, 'refusal', 'a refusal', refusal);
    await t.expect('a refusal: the owner refused it with not-found at INFO, and the run shows no device call and no published outcome for it', () => {
      must(answer === 'not-found', `the answer was ${answer}`);
      must(endings(refusal).join() === 'replied INFO not-found', `its endings were ${endings(refusal).join()}`);
      must(refusal.names['bunny.device.call'] === undefined && refusal.names['bunny.outcome.publish'] === undefined, `its spans were ${Object.keys(refusal.names).join()}`);
      must(count(refusal, 'outcome.published') === 0, 'an outcome was published for a refusal');
    });

    // An uncertain effect: the device holds the switch past the command's deadline, so the requester cannot know its fate.
    run.simulate({device: 'lamp', action: 'hold'});
    answer = await send('held', 'follow-held', 'lamp-1');
    const uncertain = await until(harness, 'request=follow-held', followed => followed.decision.endings.length > 0);
    run.simulate({device: 'lamp', action: 'release'});
    const released = await until(harness, 'request=follow-held', followed => count(followed, 'outcome.published') > 0);
    await keep(t, 'uncertain', 'an uncertain effect', released);
    await t.expect('an uncertain effect: the requester was told uncertain-result at WARN, and the device\'s late outcome is in the records, so the run tells the story the answer could not', () => {
      must(answer === 'uncertain-result', `the answer was ${answer}`);
      must(endings(uncertain).join() === 'uncertain WARN uncertain-result', `its endings were ${endings(uncertain).join()}`);
      must(endings(released).join() === 'uncertain WARN uncertain-result' && count(released, 'outcome.published') === 1, 'the late outcome is not one record after the one ending');
      must(released.spans.some(span => span.name === 'bunny.command.request' && span.status === 'error'), 'the request span did not end with error');
    });

    // A replayed outcome: the core's acknowledgment is lost, and the next runtime sends the outcome again.
    run.loseAcknowledgment();
    answer = await send('replayed', 'follow-replayed', 'lamp-1');
    await until(harness, 'request=follow-replayed', followed => count(followed, 'message.received') > 0);
    await run.restart();
    const replayed = await until(harness, 'request=follow-replayed', followed => followed.names['bunny.outcome.publish'] === 2 && count(followed, 'message.received') > 1);
    await keep(t, 'replayed', 'a replayed outcome', replayed);
    await t.expect('a replayed outcome: one publication record, two publish spans, the second a new root in its own trace that links to the stored context, and the core took it as a duplicate', () => {
      must(answer === 'accepted', `the answer was ${answer}`);
      must(count(replayed, 'outcome.published') === 1, `${count(replayed, 'outcome.published')} publication records`);
      const [first, replay] = replayed.spans.filter(span => span.name === 'bunny.outcome.publish');
      must(first !== undefined && replay !== undefined, 'the outcome did not go out twice');
      must(replay.parent === undefined && replay.links.length === 1, 'the replay is not a root with one link');
      must(replay.links[0]?.spanId === first.parent?.spanId, 'the replay does not link to the context the first publication continued');
      must(replay.traceId !== first.traceId && replayed.traces.length === 2, 'the replay shares the first publication\'s trace');
      must(replayed.records.filter(entry => entry.event === 'message.received').map(entry => entry.attributes['bunny.outcome']).join() === 'accepted,duplicate',
        'the core did not take the replay as a duplicate');
      must(!gapKinds(replayed).includes('generation-ended-without-stop'), 'a clean restart showed as a crash');
    });

    // Evidence that is missing: the runtime is killed between the lamp's commit and its publish.
    run.armCrash();
    answer = await send('crash', 'follow-crash', 'lamp-1');
    await until(harness, 'request=follow-crash', followed => count(followed, 'outcome.published') > 0 && gapKinds(followed).includes('generation-ended-without-stop'), 20_000);
    const crashed = await until(harness, 'request=follow-crash', followed => followed.names['bunny.outcome.publish'] !== undefined);
    await keep(t, 'crash', 'a runtime killed before its command finished', crashed);
    await t.expect('missing evidence: the killed runtime recorded no ending, so the answer says none is recorded, names the runtime that ended without its stop record, and reports no span that never ended', () => {
      // The action's HTTP call lost its connection when the runtime was killed: its fate is the tracker's to know.
      must(answer === 'lost', `the answer was ${answer}`);
      must(crashed.decision.admitted === 1 && crashed.decision.unended === 1 && !crashed.decision.ended && crashed.decision.endings.length === 0, `its decision was ${JSON.stringify(crashed.decision)}`);
      must(crashed.gaps.some(gap => gap.kind === 'generation-ended-without-stop' && gap.generation === 2), `its gaps were ${gapKinds(crashed).join()}`);
      must(crashed.names['bunny.command.request'] === undefined && crashed.names['bunny.command.execute'] === undefined, 'a span that never ended is reported');
      must(orphans(crashed).length === 2 && gapKinds(crashed).includes('parent-missing'), `${orphans(crashed).join()} lack parents`);
      must(crashed.spans.some(span => span.name === 'bunny.outcome.publish' && span.parent === undefined && span.links.length === 1), 'its outcome did not go out as a linked root after the restart');
    });

    // A request that was never sent: absent, and the answer does not call that proof.
    const never = await ask(harness, 'request=follow-never-sent');
    await keep(t, 'missing', 'a request nothing carries', never);
    await t.expect('absent evidence: a request nothing carries is reported none-found, with the killed runtime named, and the note says it is not evidence that nothing happened', () => {
      must(never.result === 'none-found' && never.records.length === 0 && never.spans.length === 0 && never.traces.length === 0, 'it found something');
      must(never.gaps.some(gap => gap.kind === 'generation-ended-without-stop') && gapKinds(never).includes('losses-uncounted'), 'it named no reason the evidence could be incomplete');
      must(never.note.includes('not evidence that nothing happened') && never.note.includes('below the minimum level'), 'its note does not say so');
    });

    // A query over its limits, against the same request asked for in full a moment before.
    const full = await ask(harness, 'request=follow-ok');
    const capped = await ask(harness, 'request=follow-ok&records=2&spans=1');
    await keep(t, 'capped', 'a query over its limits', capped);
    await t.expect('capped evidence: a query limited to 2 records and 1 span returns them, counts what it matched and left out, and names the cap', () => {
      must(capped.records.length === 2 && capped.spans.length === 1, `it returned ${capped.records.length} records and ${capped.spans.length} spans`);
      must(capped.matched.records === full.matched.records && capped.matched.spans === full.matched.spans, 'it matched less than the full query');
      must(capped.omitted.records === capped.matched.records - 2 && capped.omitted.spans === capped.matched.spans - 1 && capped.omitted.records > 0 && capped.omitted.spans > 0, 'it did not count what it left out');
      must(gapKinds(capped).includes('capped'), 'it did not name the cap');
    });

    // The trace names the same spans as the request, and nothing of another request.
    const byTrace = await ask(harness, `trace=${full.traces[0] ?? ''}`);
    await keep(t, 'trace', 'the success, by its trace', byTrace);
    await t.expect('the trace: its query holds the success\'s spans and no span or record of another request', () => {
      must(byTrace.spans.map(span => span.spanId).sort().join() === full.spans.filter(span => span.traceId === full.traces[0]).map(span => span.spanId).sort().join(),
        'its spans differ from the request\'s');
      must(byTrace.records.every(entry => entry.attributes['bunny.request.id'] === undefined || entry.attributes['bunny.request.id'] === 'follow-ok'), 'another request\'s record is on the trace');
    });
  } finally {
    await run.close();
  }
}
