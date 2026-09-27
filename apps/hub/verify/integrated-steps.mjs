// Capture steps of the Hub's `integrated` scenario (Hub #495). They drive the
// real Hub dashboard and, in the same page and video, the paired wall and Pixoo
// runs' own pages. Lifecycle input goes through the Hub's real ingest route with
// the run's credential; commands go from the dashboard through the Hub's
// per-device controller clients to the consumers' controller APIs. Each
// consumer's verification state route (consumers.mjs) says what reached its
// writer and which Hub revision it last applied.
//
// Steps that need a consumer loss (`pixoo-loss`, `control-replay-after-recovery`)
// run only through `compose inject`: the step asks the orchestrator to freeze and
// thaw the Pixoo run's recorded unit through two files in this run's runtime
// directory, and fails if nobody answers.
import {randomBytes} from 'node:crypto';
import {readFile, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {consumerState} from './consumers.mjs';
import {PAIRING} from './integrated.mjs';

const SIGNED_IN = 'Control enabled · Local';
const pause = (/** @type {number} */ ms) => new Promise(resolve => setTimeout(resolve, ms));
const INJECT = {request: 'compose-inject-request', state: 'compose-inject-state'};

/** @param {any} t */
const apiToken = async t => (await readFile(join(t.dataDir, 'api-token'), 'utf8')).trim();

/** A Hub API call with the run's credential, as a client of the real routes. @param {any} t @param {string} path @param {unknown} [body] */
async function hub(t, path, body) {
  const response = await fetch(new URL(path, t.url), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {authorization: `Bearer ${await apiToken(t)}`, 'content-type': 'application/json', 'x-pixoo-request': '1'},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    signal: AbortSignal.timeout(8000),
  });
  let value;
  try {
    value = await response.json();
  } catch {
    value = undefined;
  }
  return {status: response.status, body: value};
}

/**
 * Wait until `check` holds on a fresh read. Throws with the last observation.
 * @template T @param {() => Promise<T>} read @param {(value: T) => boolean} check @param {string} what
 */
async function until(read, check, what, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  /** @type {T | undefined} */
  let value;
  /** @type {Error | undefined} */
  let error;
  for (;;) {
    try {
      value = await read();
      error = undefined;
      if (check(value)) return value;
    } catch (caught) {
      error = /** @type {Error} */ (caught);
    }
    if (Date.now() > deadline) throw new Error(`${what}; last saw ${error ? error.message : JSON.stringify(value)}`);
    await pause(250);
  }
}

/** A consumer's writer count for one kind, once it has held still for a second. @param {string} consumer @param {string} preview @param {string} kind */
async function settledCount(consumer, preview, kind) {
  let seen = (await consumerState(consumer, preview)).writer[kind] ?? 0, still = 0;
  for (let waited = 0; waited < 10000 && still < 4; waited += 250) {
    await pause(250);
    const now = (await consumerState(consumer, preview)).writer[kind] ?? 0;
    still = now === seen ? still + 1 : 0;
    seen = now;
  }
  return seen;
}

/** A unique synthetic session from the source the paired wall qualifies. */
function session() {
  const nonce = randomBytes(3).toString('hex');
  return {nonce, identity: {...PAIRING.source, sessionId: `verify-${nonce}`}, title: `Paired check ${nonce}`, project: 'VERIFY-PAIRED', sequence: 0};
}

/** Post one lifecycle event through the Hub's own ingest route. @param {any} t @param {ReturnType<typeof session>} s @param {string} kind @param {Record<string, unknown>} [extra] */
async function ingest(t, s, kind, extra = {}) {
  const event = {apiVersion: '1.1', identity: s.identity, turn: {status: 'known', id: `turn-${s.nonce}`}, parent: {status: 'top-level'}, ordering: {status: 'known', epoch: `compose-${s.nonce}`, sequence: s.sequence++}, observedAtMs: Date.now(), title: {value: s.title, source: 'provider'}, project: s.project, projectId: 'verify-paired', event: {kind, ...extra}};
  const result = await hub(t, '/api/monitor/v1/events', event);
  if (result.status !== 200 || result.body?.ok !== true) throw new Error(`the Hub refused the ${kind} event (${result.status})`);
}

/** The Hub's current revision, as its feed serves it. @param {any} t */
const revision = async t => (await hub(t, '/api/monitor/v1/sessions')).body.snapshot.revision;

/** Open the Hub preview as the owner does, signed in by trusted-loopback. @param {any} t */
async function open(t) {
  await t.page.goto(t.url);
  await t.expect('the Hub page signs in on load without a token', () => t.page.getByText(SIGNED_IN, {exact: true}).waitFor());
}

/** @param {any} t */
async function openPixel(t) {
  await t.page.getByRole('link', {name: 'pixel pixoo', exact: true}).click();
  const brightness = t.page.getByLabel('Brightness (%)').filter({visible: true});
  await brightness.waitFor({timeout: 15000});
  return brightness;
}

/** @param {any} t */
const brightnessStatus = t => t.page.locator('form.edit').filter({visible: true}).filter({has: t.page.getByRole('heading', {name: 'Brightness', exact: true})}).locator(':scope>[role=status]');

/** @param {any} t */
async function formReady(t) {
  await t.page.waitForFunction(() => {
    const input = Array.from(document.querySelectorAll('input[type=range]')).find(el => /** @type {HTMLElement} */ (el).offsetParent);
    return input && !(/** @type {HTMLInputElement} */ (input).disabled);
  });
}

/** Each consumer's view of the feed is current at the Hub's revision and names the one owner. @param {any} t @param {string} name */
async function consumersCurrent(t, name) {
  await t.expect(name, async () => {
    const target = await revision(t);
    for (const consumer of Object.keys(PAIRING.controllers)) {
      await until(() => consumerState(consumer, t.inputs[`${consumer}-preview`]), state => state.feed.connection === 'current' && state.feed.revision === target && state.feed.ownerId === PAIRING.ownerId, `${consumer} did not reach the owner's revision ${target}`);
    }
  });
}

// ---------------------------------------------------------------------------
// The loss handshake with `compose inject`.

let requests = 0;
/** Ask the orchestrator to freeze or thaw the named consumer's recorded unit and wait for its answer. @param {any} t @param {string} service @param {'freeze' | 'thaw'} phase */
async function injection(t, service, phase) {
  const answer = phase === 'freeze' ? 'frozen' : 'thawed';
  const file = join(t.runtimeDir, INJECT.request);
  await writeFile(`${file}.tmp`, JSON.stringify({seq: ++requests + Date.now(), service, phase}), {mode: 0o600});
  await rename(`${file}.tmp`, file);
  return until(async () => JSON.parse(await readFile(join(t.runtimeDir, INJECT.state), 'utf8')), state => state.phase === answer || state.phase === 'refused', `nobody ${answer} ${service}; run this step through npm run -s verify:compose -- inject`, 20000)
    .then(state => {
      if (state.phase !== answer) throw new Error(`the orchestrator refused to ${phase} ${service}`);
    });
}

/**
 * The Pixoo run is lost and recovers while the Hub keeps owning agent state.
 * `replay` makes it the negative control: a client re-sends the lost command
 * as new work after recovery, which the no-replay assertion must catch.
 * @param {boolean} replay
 */
function lossStep(replay) {
  return async (/** @type {any} */ t) => {
    const preview = t.inputs['pixoo-preview'], pixel = PAIRING.controllers.pixoo;
    await open(t);
    const brightness = await openPixel(t);
    await formReady(t);
    await consumersCurrent(t, 'before the loss both consumers read the owner\'s current revision');
    const before = await consumerState('pixoo', preview);
    const baseline = await settledCount('pixoo', preview, 'brightness.set');
    const read = await hub(t, `/api/controllers/v1/${pixel.alias}/snapshot`);
    if (read.status !== 200) throw new Error(`the pre-loss snapshot read answered ${read.status}`);
    const guards = read.body, value = guards.state.desired.brightness.value === 37 ? 38 : 37;
    await t.screenshot('before-loss');

    await t.expect('the orchestrator froze the Pixoo run', () => injection(t, 'pixoo', 'freeze'));
    const stale = t.page.locator('section:visible').getByText('Stale / unavailable', {exact: true});
    await t.expect('the dashboard marks the lost Pixoo Stale / unavailable', () => stale.waitFor({timeout: 20000}));
    await t.expect('the Hub reports the lost Pixoo unavailable', async () => {
      const health = await hub(t, '/api/hub/v1/health');
      const device = health.body?.devices?.find((/** @type {{id: string}} */ d) => d.id === pixel.alias);
      if (device?.health !== 'unavailable') throw new Error(`health says ${device?.health}`);
    });
    await t.expect('the dashboard offers no brightness change while the Pixoo is unreadable', async () => {
      if (await brightness.count() && !(await brightness.isDisabled())) throw new Error('the brightness slider is enabled on a stale device');
    });
    await t.screenshot('lost');
    // A client that read the Pixoo before the loss sends one command now, through the Hub's queue.
    const sent = await hub(t, `/api/controllers/v1/${pixel.alias}/commands`, {apiVersion: '1.0', controllerId: pixel.controllerId, deviceId: pixel.deviceId, requestId: guards.nextRequestId, expectedConfigurationRevision: guards.configurationRevision, expectedGeneration: guards.generation, command: {kind: 'brightness.set', percent: value}});
    await t.expect('the Hub reports the command sent during the loss as uncertain, not sent or failed', () => {
      if (sent.status !== 503 || sent.body?.error?.code !== 'uncertain-result') throw new Error(`the Hub answered ${sent.status} ${JSON.stringify(sent.body)}`);
    });
    // The owner moves on while the Pixoo cannot read it.
    const s = session();
    await ingest(t, s, 'session.started');
    const during = await revision(t);
    await t.expect('the owner advanced past the lost Pixoo\'s last applied revision', () => {
      if (!(before.feed.revision !== null && during > before.feed.revision)) throw new Error(`owner ${during}, Pixoo last applied ${before.feed.revision}`);
    });

    await t.expect('the orchestrator thawed the Pixoo run', () => injection(t, 'pixoo', 'thaw'));
    await t.expect('the dashboard shows the Pixoo current again without a reload', () => stale.waitFor({state: 'detached', timeout: 20000}));
    await t.expect('the Pixoo view caught up with the owner after recovery', () => until(() => consumerState('pixoo', preview), state => state.feed.connection === 'current' && (state.feed.revision ?? -1) >= during, 'the Pixoo did not catch up'));
    const recovered = await settledCount('pixoo', preview, 'brightness.set');
    const delivered = recovered - baseline;
    await t.attach('loss-command.json', JSON.stringify({
      hubOutcome: 'uncertain-result',
      deliveredAtWriter: delivered,
      note: 'A frozen consumer\'s kernel still accepts the TCP connection, so the Hub\'s one request can be processed once after the thaw (1) or not at all (0). Either is truthful for an uncertain result; the Hub never sends it again.',
      pixooRevisionBeforeLoss: before.feed.revision,
      ownerRevisionDuringLoss: during,
    }, null, 2));
    await t.expect('the command sent during the loss reached the Pixoo writer at most once', () => {
      if (delivered < 0 || delivered > 1) throw new Error(`${delivered} brightness commands reached the writer`);
    });
    if (replay) {
      // Negative control: a client replays the lost command as new work after recovery.
      const again = await hub(t, `/api/controllers/v1/${pixel.alias}/snapshot`);
      await hub(t, `/api/controllers/v1/${pixel.alias}/commands`, {apiVersion: '1.0', controllerId: pixel.controllerId, deviceId: pixel.deviceId, requestId: again.body.nextRequestId, expectedConfigurationRevision: again.body.configurationRevision, expectedGeneration: again.body.generation, command: {kind: 'brightness.set', percent: value}});
      t.note('control: re-sent the loss-time brightness command through the Hub as new work');
    }
    await pause(5500);
    await t.expect('recovery replayed nothing', async () => {
      const now = await settledCount('pixoo', preview, 'brightness.set');
      if (now !== recovered) throw new Error(`${now - recovered} more brightness command(s) reached the writer after recovery`);
    });
  };
}

/** @type {Record<string, import('@jimmie-potts/app-verify').CaptureStep>} */
export const integratedSteps = {
  'integrated-lifecycle': {
    description: 'One synthetic session posted to the Hub shows on the Hub card, the wall\'s Line status and the Pixoo Monitor row, in one video across the three runs; no command is sent',
    scenario: 'integrated',
    timeoutMs: 90000,
    run: async t => {
      const wall = t.inputs['nanoleaf-preview'], pixoo = t.inputs['pixoo-preview'];
      const writers = {pixoo: (await consumerState('pixoo', pixoo)).writer, nanoleaf: (await consumerState('nanoleaf', wall)).writer};
      await open(t);
      const s = session();
      await ingest(t, s, 'session.started');
      await ingest(t, s, 'question.continuing', {attention: {status: 'known', id: 'question'}});
      await t.expect('the Hub session card shows the session and its question', async () => {
        await t.page.getByRole('heading', {name: s.title, exact: true}).waitFor({timeout: 15000});
        await t.page.getByText('Question · continuing', {exact: true}).first().waitFor({timeout: 15000});
      });
      // Hold each page briefly so the one video shows every run's page, and keep one screenshot per app.
      await pause(1500);
      await t.screenshot('hub');
      await consumersCurrent(t, 'both consumers read the owner\'s revision with the new session');
      await t.page.goto(wall);
      await t.expect('the wall lists the session as a question on a Line', async () => {
        // The wall's task list (codex-nanoleaf bridge/wall.html): the title, a status badge and the Line it was placed on.
        const row = t.page.locator('#taskList .task').filter({has: t.page.locator('.task-title', {hasText: s.title})});
        await row.locator('.badge[data-status="question"]').waitFor({timeout: 15000});
        await row.locator('.task-placement .line-badge').filter({hasText: /\d+$/}).waitFor({timeout: 15000});
      });
      await pause(1500);
      await t.screenshot('wall');
      await t.page.goto(pixoo);
      await t.page.getByRole('navigation', {name: 'Controller views'}).getByRole('button', {name: 'Monitor', exact: true}).click({timeout: 15000});
      await t.expect('the Pixoo Monitor lists the session', () => t.page.getByRole('heading', {name: s.title, exact: true}).waitFor({timeout: 15000}));
      await pause(1500);
      await t.screenshot('pixoo');
      await t.page.goto(t.url);
      await t.expect('back on the Hub the session is unchanged', () => t.page.getByRole('heading', {name: s.title, exact: true}).waitFor({timeout: 15000}));
      await t.expect('showing the session sent no command to either writer', async () => {
        const now = {pixoo: (await consumerState('pixoo', pixoo)).writer, nanoleaf: (await consumerState('nanoleaf', wall)).writer};
        if (JSON.stringify(now) !== JSON.stringify(writers)) throw new Error(`writers changed: ${JSON.stringify(writers)} to ${JSON.stringify(now)}`);
      });
    },
  },
  'integrated-command': {
    description: 'One Pixoo brightness change from the dashboard reaches Pixoo\'s writer exactly once, and one Nanoleaf integration setting is applied with its physical outcome unknown',
    scenario: 'integrated',
    timeoutMs: 90000,
    run: async t => {
      const wall = t.inputs['nanoleaf-preview'], pixoo = t.inputs['pixoo-preview'];
      await open(t);
      const brightness = await openPixel(t);
      await formReady(t);
      const pixooBefore = await settledCount('pixoo', pixoo, 'brightness.set');
      const value = (await brightness.inputValue()) === '30' ? '35' : '30';
      await brightness.fill(value);
      await t.expect('the dashboard reports the brightness command queued or sent', () => brightnessStatus(t).filter({hasText: /^(Queued\. The device hasn’t received it yet\.|Sent to the device\.)/}).waitFor({timeout: 15000}));
      await formReady(t);
      await t.expect(`exactly one brightness.set reached the Pixoo writer`, async () => {
        const count = await settledCount('pixoo', pixoo, 'brightness.set');
        if (count - pixooBefore !== 1) throw new Error(`${count - pixooBefore} brightness commands reached the writer`);
      });
      const wallBefore = (await consumerState('nanoleaf', wall)).writer['integration.applied'];
      await t.page.getByRole('link', {name: 'wall nanoleaf', exact: true}).click();
      const style = t.page.getByLabel('Layout style').filter({visible: true});
      await style.waitFor({timeout: 15000});
      const next = (await style.inputValue()) === 'project' ? 'classic' : 'project';
      await style.selectOption(next);
      await t.expect('the dashboard reports the setting queued or saved, asking the owner to check the device', () => t.page.locator('section:visible').getByText(/^(Queued\. The device hasn’t received it yet\.|Saved\. B\.U\.N\.N\.Y\. can’t see the device, so check it to confirm\.)$/).first().waitFor({timeout: 15000}));
      await t.expect('the wall\'s writer applied exactly one integration setting', () => until(() => consumerState('nanoleaf', wall), state => state.writer['integration.applied'] === wallBefore + 1, 'the wall did not apply the setting'));
      await t.expect('the applied setting keeps its physical outcome unknown', async () => {
        const snapshot = await until(() => hub(t, `/api/controllers/v1/${PAIRING.controllers.nanoleaf.alias}/integration/snapshot`), read => read.status === 200 && read.body.settings.style === next, 'the wall snapshot did not show the setting');
        const outcome = snapshot.body.outcomes?.at?.(-1);
        if (outcome && outcome.physicalOutcome !== 'unknown') throw new Error(`the last outcome claims ${outcome.physicalOutcome}`);
      });
      await pause(3000);
      await t.expect('nothing was sent twice', async () => {
        if ((await consumerState('nanoleaf', wall)).writer['integration.applied'] !== wallBefore + 1) throw new Error('the wall applied another setting');
        if ((await settledCount('pixoo', pixoo, 'brightness.set')) - pixooBefore !== 1) throw new Error('the Pixoo writer received another brightness command');
      });
    },
  },
  'pixoo-loss': {
    description: 'The Pixoo run is frozen and thawed by compose inject: the Hub shows it Stale / unavailable, a command sent during the loss stays uncertain and reaches the writer at most once, and recovery replays nothing',
    scenario: 'integrated',
    timeoutMs: 120000,
    run: lossStep(false),
  },
  'control-replay-after-recovery': {
    description: 'Negative control, through compose inject: after the Pixoo recovers, a client re-sends the lost command as new work, and the no-replay assertion must fail',
    scenario: 'integrated',
    timeoutMs: 120000,
    run: lossStep(true),
  },
  'control-second-owner': {
    description: 'Negative control: a lifecycle event posted straight to the paired Pixoo, bypassing the Hub, is expected to show on its Monitor as a second owner\'s session would; a Hub consumer shows only the Hub\'s sessions',
    scenario: 'integrated',
    timeoutMs: 45000,
    run: async t => {
      const pixoo = t.inputs['pixoo-preview'];
      const s = session();
      const event = {apiVersion: '1.1', identity: s.identity, turn: {status: 'known', id: `turn-${s.nonce}`}, parent: {status: 'top-level'}, ordering: {status: 'known', epoch: `direct-${s.nonce}`, sequence: 0}, observedAtMs: Date.now(), title: {value: s.title, source: 'provider'}, event: {kind: 'session.started'}};
      // The strongest Pixoo credential this composition holds is the one the Hub presents to Pixoo's controller API.
      const token = (await readFile(join(t.runtimeDir, PAIRING.files.hub.controller('pixoo')), 'utf8')).trim();
      const response = await fetch(new URL('api/monitor/v1/events', pixoo), {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-pixoo-request': '1'}, body: JSON.stringify(event), signal: AbortSignal.timeout(5000)});
      t.note(`a lifecycle event posted straight to the Pixoo run answered ${response.status}`);
      await t.page.goto(pixoo);
      await t.page.getByRole('navigation', {name: 'Controller views'}).getByRole('button', {name: 'Monitor', exact: true}).click({timeout: 15000});
      await t.expect('the Pixoo Monitor lists a session the Hub never saw, as a second owner\'s would', () => t.page.getByRole('heading', {name: s.title, exact: true}).waitFor({timeout: 5000}));
    },
  },
};
