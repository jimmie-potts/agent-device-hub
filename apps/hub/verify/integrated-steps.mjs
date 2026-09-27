// Capture steps of the Hub's `integrated` scenario (Hub #495). They drive the
// real Hub dashboard and, in the same page and video, the paired wall and Pixoo
// runs' own pages. Lifecycle input goes through the Hub's real ingest route with
// the run's credential; commands go from the dashboard through the Hub's
// per-device controller clients to the consumers' controller APIs. Each
// consumer's own verification reads (consumers.mjs) say what reached its writer
// and which of the Hub's sessions and revision it last applied.
//
// Steps that need the orchestrator to act on a consumer run only through
// `compose inject`: the step asks, through two files in this run's runtime
// directory, for a freeze and thaw of the Pixoo run's recorded unit or for a
// second owner, and fails if nobody answers. INJECTIONS lists them, CAPTURE_STEPS
// the steps `compose capture` may run, and CONTROLS each negative control's
// expected failing assertion.
import {randomInt, randomBytes} from 'node:crypto';
import {readFile, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {consumerState, follows, sessionKey} from './consumers.mjs';
import {INSTALLED_PORTS, PAIRING, pause} from './integrated.mjs';

const SIGNED_IN = 'Control enabled · Local';

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

const CONSUMERS = Object.keys(PAIRING.controllers);

/** Every writer counter of both consumers, once none has changed for a second. @param {any} t */
async function settledWriters(t) {
  const read = async () => Object.fromEntries(await Promise.all(CONSUMERS.map(async c => [c, (await consumerState(c, t.inputs[`${c}-preview`])).writer])));
  let seen = await read(), still = 0;
  for (let waited = 0; waited < 10000 && still < 4; waited += 250) {
    await pause(250);
    const now = await read();
    still = JSON.stringify(now) === JSON.stringify(seen) ? still + 1 : 0;
    seen = now;
  }
  return /** @type {Record<string, Record<string, number>>} */ (seen);
}

/** Counters that differ between two writer reads, as `consumer key: before -> after`. @param {Record<string, Record<string, number>>} before @param {Record<string, Record<string, number>>} after */
function changed(before, after) {
  const out = [];
  for (const consumer of CONSUMERS) {
    for (const key of new Set([...Object.keys(before[consumer] ?? {}), ...Object.keys(after[consumer] ?? {})])) {
      const a = before[consumer]?.[key] ?? 0, b = after[consumer]?.[key] ?? 0;
      if (a !== b) out.push({consumer, key, before: a, after: b});
    }
  }
  return out;
}

/** A unique synthetic session from the source the paired wall qualifies. */
function session() {
  const nonce = randomBytes(3).toString('hex');
  return {nonce, identity: {...PAIRING.source, sessionId: `verify-${nonce}`}, title: `Paired check ${nonce}`, project: 'VERIFY-PAIRED', sequence: 0};
}

/** @param {ReturnType<typeof session>} s @param {string} kind @param {Record<string, unknown>} [extra] */
const envelope = (s, kind, extra = {}) => ({apiVersion: '1.1', identity: s.identity, turn: {status: 'known', id: `turn-${s.nonce}`}, parent: {status: 'top-level'}, ordering: {status: 'known', epoch: `compose-${s.nonce}`, sequence: s.sequence++}, observedAtMs: Date.now(), title: {value: s.title, source: 'provider'}, project: s.project, projectId: 'verify-paired', event: {kind, ...extra}});

/** Post one lifecycle event through the Hub's own ingest route. @param {any} t @param {ReturnType<typeof session>} s @param {string} kind @param {Record<string, unknown>} [extra] */
async function ingest(t, s, kind, extra = {}) {
  const result = await hub(t, '/api/monitor/v1/events', envelope(s, kind, extra));
  if (result.status !== 200 || result.body?.ok !== true) throw new Error(`the Hub refused the ${kind} event (${result.status})`);
}

/** The Hub's current snapshot, as its feed serves it. @param {any} t */
async function hubSnapshot(t) {
  const snapshot = (await hub(t, '/api/monitor/v1/sessions')).body.snapshot;
  return {revision: /** @type {number} */ (snapshot.revision), sessions: snapshot.sessions.map((/** @type {any} */ s) => sessionKey(s.identity)).sort()};
}

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

/** @param {any} t */
async function openPixooMonitor(t) {
  await t.page.goto(t.inputs['pixoo-preview']);
  await t.page.getByRole('navigation', {name: 'Controller views'}).getByRole('button', {name: 'Monitor', exact: true}).click({timeout: 15000});
}

/** Each consumer follows the Hub's current snapshot. @param {any} t @param {string} name @param {string[]} [only] */
async function consumersFollow(t, name, only = CONSUMERS) {
  await t.expect(name, async () => {
    const owner = await hubSnapshot(t);
    for (const consumer of only) {
      await until(() => consumerState(consumer, t.inputs[`${consumer}-preview`]), state => follows(state, owner), `${consumer} does not follow the owner's revision ${owner.revision} and its ${owner.sessions.length} session(s)`);
    }
  });
}

/** Loopback links on the current page that target an installed service's port. @param {any} t */
async function installedLinks(t) {
  /** @type {string[]} */
  const hrefs = await t.page.locator('a[href]').evaluateAll((/** @type {HTMLAnchorElement[]} */ all) => all.map(a => a.href));
  return hrefs.filter(href => {
    try {
      const url = new URL(href);
      return ['127.0.0.1', 'localhost'].includes(url.hostname) && INSTALLED_PORTS.includes(Number(url.port));
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// The injection handshake with `compose inject`.

/**
 * Ask the orchestrator for `phase` on the named consumer and wait for its `answer`.
 * @param {any} t @param {string} service @param {string} phase @param {string} answer
 */
async function injection(t, service, phase, answer) {
  const file = join(t.runtimeDir, PAIRING.files.inject.request);
  await writeFile(`${file}.tmp`, JSON.stringify({seq: Date.now() * 1000 + randomInt(1000), service, phase}), {mode: 0o600});
  await rename(`${file}.tmp`, file);
  const state = await until(async () => JSON.parse(await readFile(join(t.runtimeDir, PAIRING.files.inject.state), 'utf8')), value => value.phase === answer || value.phase === 'refused', `nobody answered ${phase} for ${service}; run this step through npm run -s verify:compose -- inject`, 60000);
  if (state.phase !== answer) throw new Error(`the orchestrator refused ${phase} for ${service}`);
}

// ---------------------------------------------------------------------------
// One owner: the Hub alone owns agent state, and Pixoo only mirrors it.

/**
 * The one-owner assertions. With `secondOwner` the orchestrator first turns the Pixoo run back into its own
 * embedded owner, a known-broken input the Hub-follows assertion must catch.
 * @param {boolean} secondOwner
 */
function ownerStep(secondOwner) {
  return async (/** @type {any} */ t) => {
    const pixoo = t.inputs['pixoo-preview'];
    if (secondOwner) await t.expect('the orchestrator made the Pixoo run its own embedded owner', () => injection(t, 'pixoo', 'second-owner', 'second-owner'));
    await open(t);
    const hubSession = session(), direct = session();
    await ingest(t, hubSession, 'session.started');
    // The strongest Pixoo credential this composition holds is the one the Hub presents to Pixoo's controller API.
    const token = (await readFile(join(t.runtimeDir, PAIRING.files.hub.controller('pixoo')), 'utf8')).trim();
    const response = await fetch(new URL('api/monitor/v1/events', pixoo), {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-pixoo-request': '1'}, body: JSON.stringify(envelope(direct, 'session.started')), signal: AbortSignal.timeout(5000)});
    const answer = await response.json().catch(() => undefined);
    t.note(`a lifecycle event posted straight to the Pixoo run answered ${response.status}`);
    await t.expect('the paired Pixoo does not accept a lifecycle event posted to it directly', () => {
      if (response.ok && answer?.ok !== false) throw new Error(`the Pixoo run accepted it (${response.status})`);
    });
    await t.expect('the Pixoo reads its sessions only from the Hub: current at the owner\'s revision, with exactly the Hub\'s sessions', async () => {
      const owner = await hubSnapshot(t);
      if (!owner.sessions.includes(sessionKey(hubSession.identity))) throw new Error('the Hub does not list its own session');
      await until(() => consumerState('pixoo', pixoo), state => follows(state, owner), `the Pixoo does not follow the owner's revision ${owner.revision} and its ${owner.sessions.length} session(s)`);
    });
    await openPixooMonitor(t);
    await t.expect('the Pixoo Monitor lists the Hub\'s session and not the direct one', async () => {
      await t.page.getByRole('heading', {name: hubSession.title, exact: true}).waitFor({timeout: 15000});
      if (await t.page.getByRole('heading', {name: direct.title, exact: true}).count()) throw new Error('the Monitor lists the session posted straight to the Pixoo');
    });
  };
}

// ---------------------------------------------------------------------------
// Loss and recovery.

/**
 * The Pixoo run is lost and recovers while the Hub keeps owning agent state.
 * `replay` makes it the negative control: right after the thaw a client re-sends
 * the lost command as new work, which the writer assertion must catch.
 * @param {boolean} replay
 */
function lossStep(replay) {
  return async (/** @type {any} */ t) => {
    const preview = t.inputs['pixoo-preview'], pixel = PAIRING.controllers.pixoo;
    await open(t);
    const brightness = await openPixel(t);
    await formReady(t);
    await consumersFollow(t, 'before the loss both consumers follow the owner');
    const before = await consumerState('pixoo', preview);
    const baseline = await settledWriters(t);
    const read = await hub(t, `/api/controllers/v1/${pixel.alias}/snapshot`);
    if (read.status !== 200) throw new Error(`the pre-loss snapshot read answered ${read.status}`);
    // A percent no earlier step uses, so the value alone also names the loss-time command.
    const guards = read.body;
    let percent = 11 + randomInt(19);
    if (guards.state.desired.brightness.value === percent) percent = percent === 29 ? 11 : percent + 1;
    await t.screenshot('before-loss');

    await t.expect('the orchestrator froze the Pixoo run', () => injection(t, 'pixoo', 'freeze', 'frozen'));
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
    const lost = {apiVersion: '1.0', controllerId: pixel.controllerId, deviceId: pixel.deviceId, requestId: guards.nextRequestId, expectedConfigurationRevision: guards.configurationRevision, expectedGeneration: guards.generation, command: {kind: 'brightness.set', percent}};
    const sent = await hub(t, `/api/controllers/v1/${pixel.alias}/commands`, lost);
    await t.expect('the Hub reports the command sent during the loss as uncertain, not sent or failed', () => {
      if (sent.status !== 503 || sent.body?.error?.code !== 'uncertain-result') throw new Error(`the Hub answered ${sent.status} ${JSON.stringify(sent.body)}`);
    });
    // The owner moves on while the Pixoo cannot read it.
    await ingest(t, session(), 'session.started');
    const during = (await hubSnapshot(t)).revision;
    await t.expect('the owner advanced past the lost Pixoo\'s last applied revision', () => {
      if (!(before.feed.revision !== null && during > before.feed.revision)) throw new Error(`owner ${during}, Pixoo last applied ${before.feed.revision}`);
    });

    // Leave the dashboard before the thaw, so the step's own read is the first Hub read of the recovered Pixoo.
    await t.page.goto('about:blank');
    await t.expect('the orchestrator thawed the Pixoo run', () => injection(t, 'pixoo', 'thaw', 'thawed'));
    // A frozen consumer's kernel still holds the Hub's timed-out request, so the Pixoo may still take it once, and only
    // as the first thing it does after the thaw. Whether the loss-time request was used before the Pixoo answers its
    // first read tells a late delivery from a re-send: afterwards the request can only arrive again.
    const first = await until(() => hub(t, `/api/controllers/v1/${pixel.alias}/snapshot`), value => value.status === 200, 'the Pixoo did not answer after the thaw');
    const usedBeforeFirstRead = JSON.stringify(first.body.nextRequestId) !== JSON.stringify(lost.requestId);
    if (replay) {
      // Negative control: a client re-sends the lost command as new work the moment the Pixoo answers again.
      const again = await hub(t, `/api/controllers/v1/${pixel.alias}/commands`, {...lost, requestId: first.body.nextRequestId, expectedConfigurationRevision: first.body.configurationRevision, expectedGeneration: first.body.generation});
      t.note(`control: re-sent the loss-time brightness command through the Hub as new work right after the thaw (${again.status})`);
    }
    await t.page.goto(t.url);
    await openPixel(t);
    await t.expect('the dashboard shows the Pixoo current again', async () => {
      if (await stale.count()) throw new Error('the Pixoo is still marked Stale / unavailable');
    });
    await consumersFollow(t, 'after recovery both consumers follow the owner again');
    const recovered = await settledWriters(t);
    const deltas = changed(baseline, recovered);
    const delivered = (recovered.pixoo?.['brightness.set'] ?? 0) - (baseline.pixoo?.['brightness.set'] ?? 0);
    const after = await hub(t, `/api/controllers/v1/${pixel.alias}/snapshot`);
    const lastSend = after.body?.state?.lastSuccessfulSend;
    await t.attach('loss-command.json', JSON.stringify({
      hubOutcome: sent.body?.error?.code ?? null,
      lossRequestId: lost.requestId,
      percent,
      firstReadAfterThaw: {nextRequestId: first.body.nextRequestId, lossRequestUsedBefore: usedBeforeFirstRead},
      deliveredAtWriter: delivered,
      lastSuccessfulSend: lastSend ?? null,
      writerChanges: deltas,
      note: 'A frozen consumer\'s kernel still accepts the TCP connection, so the Hub\'s one request can take effect once, before the Pixoo answers its first read after the thaw (1), or not at all (0). Either is truthful for an uncertain result. Anything else reaching a writer, including that request arriving again later, fails the step.',
      pixooRevisionBeforeLoss: before.feed.revision,
      ownerRevisionDuringLoss: during,
    }, null, 2));
    await t.expect('nothing but the loss-time command reached a writer, and that at most once', () => {
      const brightnessKeys = new Set(['brightness.set', 'setBrightness.admitted', 'setBrightness.succeeded']);
      const other = deltas.filter(d => !(d.consumer === 'pixoo' && brightnessKeys.has(d.key)));
      if (other.length) throw new Error(`other writer counters changed: ${JSON.stringify(other)}`);
      if (delivered < 0 || delivered > 1) throw new Error(`${delivered} brightness commands reached the Pixoo writer`);
      if (delivered === 1) {
        if (!usedBeforeFirstRead) throw new Error('a brightness command took effect after the Pixoo answered its first read after the thaw: the lost command was sent again, not delivered late');
        if (!(lastSend?.status === 'known' && JSON.stringify(lastSend.requestId) === JSON.stringify(lost.requestId))) throw new Error(`the brightness command that reached the writer is not the loss-time request ${JSON.stringify(lost.requestId)}: last send ${JSON.stringify(lastSend)}`);
        if (after.body?.state?.desired?.brightness?.value !== percent) throw new Error(`the Pixoo shows ${after.body?.state?.desired?.brightness?.value}%, not the loss-time ${percent}%`);
      }
      if (delivered === 0 && after.body?.state?.desired?.brightness?.value === percent) throw new Error(`the Pixoo shows the loss-time percent ${percent} without a delivery`);
    });
    await pause(5500);
    await t.expect('recovery replayed nothing', async () => {
      const now = changed(recovered, await settledWriters(t));
      if (now.length) throw new Error(`writer counters changed after recovery: ${JSON.stringify(now)}`);
    });
  };
}

// ---------------------------------------------------------------------------
// Steps.

/** @type {Record<string, import('@jimmie-potts/app-verify').CaptureStep>} */
export const integratedSteps = {
  'integrated-lifecycle': {
    description: 'One synthetic session posted to the Hub shows on the Hub card, the wall\'s Line status and the Pixoo Monitor row, in one video across the three runs; no command is sent, and no link on the three pages leads to an installed service',
    scenario: 'integrated',
    timeoutMs: 90000,
    run: async t => {
      const wall = t.inputs['nanoleaf-preview'];
      const writers = await settledWriters(t);
      /** @type {Record<string, string[]>} */
      const installed = {};
      await open(t);
      const s = session();
      await ingest(t, s, 'session.started');
      await ingest(t, s, 'question.continuing', {attention: {status: 'known', id: 'question'}});
      await t.expect('the Hub session card shows the session and its question', async () => {
        await t.page.getByRole('heading', {name: s.title, exact: true}).waitFor({timeout: 15000});
        await t.page.getByText('Question · continuing', {exact: true}).first().waitFor({timeout: 15000});
      });
      installed.hub = await installedLinks(t);
      // Hold each page briefly so the one video shows every run's page, and keep one screenshot per app.
      await pause(1500);
      await t.screenshot('hub');
      await consumersFollow(t, 'both consumers follow the owner with the new session');
      await t.page.goto(wall);
      await t.expect('the wall lists the session as a question on a Line', async () => {
        // The wall's task list (codex-nanoleaf bridge/wall.html): the title, a status badge and the Line it was placed on.
        const row = t.page.locator('#taskList .task').filter({has: t.page.locator('.task-title', {hasText: s.title})});
        await row.locator('.badge[data-status="question"]').waitFor({timeout: 15000});
        await row.locator('.task-placement .line-badge').filter({hasText: /\d+$/}).waitFor({timeout: 15000});
      });
      installed.wall = await installedLinks(t);
      await t.expect('the wall\'s B.U.N.N.Y. link leads to the paired Hub run', async () => {
        const href = await t.page.getByRole('link', {name: 'B.U.N.N.Y.', exact: true}).getAttribute('href', {timeout: 5000});
        if (new URL(href ?? '', wall).href !== t.url) throw new Error(`it leads to ${href}`);
      });
      await pause(1500);
      await t.screenshot('wall');
      await openPixooMonitor(t);
      await t.expect('the Pixoo Monitor lists the session', () => t.page.getByRole('heading', {name: s.title, exact: true}).waitFor({timeout: 15000}));
      installed.pixoo = await installedLinks(t);
      await pause(1500);
      await t.screenshot('pixoo');
      await t.page.goto(t.url);
      await t.expect('back on the Hub the session is unchanged', () => t.page.getByRole('heading', {name: s.title, exact: true}).waitFor({timeout: 15000}));
      await t.expect('no link on the three paired pages leads to an installed service', () => {
        const found = Object.entries(installed).filter(([, links]) => links.length);
        if (found.length) throw new Error(found.map(([page, links]) => `${page}: ${links.join(', ')}`).join('; '));
      });
      await t.expect('showing the session sent no command to either writer', async () => {
        const now = changed(writers, await settledWriters(t));
        if (now.length) throw new Error(`writers changed: ${JSON.stringify(now)}`);
      });
    },
  },
  'integrated-command': {
    description: 'One Pixoo brightness change from the dashboard reaches Pixoo\'s writer exactly once, and one Nanoleaf integration setting is applied with its physical outcome unknown',
    scenario: 'integrated',
    timeoutMs: 90000,
    run: async t => {
      const wall = t.inputs['nanoleaf-preview'];
      await open(t);
      const brightness = await openPixel(t);
      await formReady(t);
      const before = await settledWriters(t);
      const value = (await brightness.inputValue()) === '30' ? '35' : '30';
      await brightness.fill(value);
      await t.expect('the dashboard reports the brightness command queued or sent', () => brightnessStatus(t).filter({hasText: /^(Queued\. The device hasn’t received it yet\.|Sent to the device\.)/}).waitFor({timeout: 15000}));
      await formReady(t);
      await t.expect('exactly one brightness.set reached the Pixoo writer', async () => {
        const count = (await settledWriters(t)).pixoo?.['brightness.set'] ?? 0;
        if (count - (before.pixoo?.['brightness.set'] ?? 0) !== 1) throw new Error(`${count - (before.pixoo?.['brightness.set'] ?? 0)} brightness commands reached the writer`);
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
        if (outcome?.outcome !== 'applied' || outcome.physicalOutcome !== 'unknown') throw new Error(`the last outcome is ${JSON.stringify(outcome)}`);
      });
      await pause(3000);
      await t.expect('nothing else reached either writer', async () => {
        const now = changed(before, await settledWriters(t));
        const expected = new Set(['pixoo brightness.set', 'pixoo setBrightness.admitted', 'pixoo setBrightness.succeeded', 'nanoleaf integration.applied']);
        const other = now.filter(d => !expected.has(`${d.consumer} ${d.key}`) || d.after - d.before !== 1);
        if (other.length) throw new Error(`unexpected writer changes: ${JSON.stringify(other)}`);
      });
    },
  },
  'one-owner': {
    description: 'The Hub alone owns agent state: a lifecycle event posted straight to the paired Pixoo is not accepted, and the Pixoo mirrors exactly the Hub\'s sessions at its revision and lists only the Hub\'s session',
    scenario: 'integrated',
    timeoutMs: 60000,
    run: ownerStep(false),
  },
  'pixoo-loss': {
    description: 'The Pixoo run is frozen and thawed by compose inject: the Hub shows it Stale / unavailable, a command sent during the loss stays uncertain and takes effect at most once, only before the Pixoo answers its first read after the thaw, nothing else reaches a writer, and recovery replays nothing',
    scenario: 'integrated',
    timeoutMs: 150000,
    run: lossStep(false),
  },
  'control-replay-after-recovery': {
    description: 'Negative control, through compose inject: the moment the thawed Pixoo answers, a client re-sends the lost command as new work, and the writer assertion must fail',
    scenario: 'integrated',
    timeoutMs: 150000,
    run: lossStep(true),
  },
  'control-second-owner': {
    description: 'Negative control, through compose inject: the orchestrator turns the Pixoo run back into its own embedded owner, and the one-owner assertion must fail',
    scenario: 'integrated',
    timeoutMs: 120000,
    run: ownerStep(true),
  },
};

/** The steps `compose capture` may run; any other Hub step would reseed the owner out of `integrated` or never be answered. */
export const CAPTURE_STEPS = Object.freeze(['integrated-lifecycle', 'integrated-command', 'one-owner']);
/** The steps `compose inject <kind> <service>` may run, by kind and consumer. The first is the default. */
export const INJECTIONS = Object.freeze({
  'consumer-loss': {pixoo: ['pixoo-loss', 'control-replay-after-recovery']},
  'second-owner': {pixoo: ['control-second-owner']},
});
/** Each negative control and the assertion it must fail at; failing anywhere else means the control did not hold. */
export const CONTROLS = Object.freeze({
  'control-replay-after-recovery': 'nothing but the loss-time command reached a writer, and that at most once',
  'control-second-owner': 'the Pixoo reads its sessions only from the Hub: current at the owner\'s revision, with exactly the Hub\'s sessions',
});
