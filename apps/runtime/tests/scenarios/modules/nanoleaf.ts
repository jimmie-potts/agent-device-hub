// The Nanoleaf module's scenarios (Hub #844, #999). A disposable run of its own, `nanoleaf-migrated`, starts the shipped
// runtime on a migrated Nanoleaf bridge state (Hub #933). The catalog collects this file.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {LINES_ADDRESS, NANOLEAF_FAMILIES, SIMULATED_SECTION as SIMULATED_WALL, writeSyntheticNanoleafState, type SimulatedState} from '@jimmie-potts/nanoleaf';
import type {CommandDraft} from '@jimmie-potts/sdk';
import {runNanoleafMigration} from '../../../src/index.js';
import {RUN_FILE, configDirOf, migrationOf, stateDirOf, type RunFile} from '../../../verify/paths.js';
import {OTHER, sessionStarted, turnEnded, turnStarted} from '../../fixtures/agents.js';
import {
  CORE_FAMILIES, act, answered, deviceState, dispatchOnce, expect, holds, inboxOf, logged, noToken, publish, recorded, running, show,
  type Harness, type ModuleRun, type Outcome, type Scenario,
} from '../framework.js';

/** What the simulated controllers show. */
const nanoleafState = (h: Harness): SimulatedState => deviceState<SimulatedState>(h, 'nanoleaf');

/** The Nanoleaf module's section: the simulated Lines, and the scenario hook's agent source qualified. */
export const NANOLEAF_SECTION = SIMULATED_WALL;
/** The Nanoleaf module's source: `device` is a shared family, so its reader names the owner it syncs from (Hub #967). */
const NANOLEAF_OWNER = 'bunny/modules/nanoleaf';
const NANOLEAF_FAMILIES_FOLLOWED = {owner: NANOLEAF_OWNER, families: ['device', NANOLEAF_FAMILIES.wall.family, NANOLEAF_FAMILIES.animations.family]} as const;
type WallTask = {id: string; status: string; element: string | null};
const wallRecord = (h: Harness): DeviceRecord | undefined =>
  h.reader.states<DeviceRecord>('device', NANOLEAF_OWNER).find(state => state.data.id === 'wall')?.data;
const wallTasks = (h: Harness): WallTask[] =>
  h.reader.states<{id: string; tasks: WallTask[]}>(NANOLEAF_FAMILIES.wall.family, NANOLEAF_OWNER).find(state => state.data.id === 'wall')?.data.tasks ?? [];
const theLines = (h: Harness): SimulatedState['devices'][string] | undefined => nanoleafState(h).devices[LINES_ADDRESS];
const onTheWall = (h: Harness, status: string): Outcome => {
  const tasks = wallTasks(h);
  return tasks.some(task => task.status === status && task.element !== null) || `the wall shows ${show(tasks.map(task => [task.status, task.element]))}`;
};
const wallMode = (requestId: string, mode: string): {key: string; draft: CommandDraft<object>} => ({
  key: 'bunny.cmd.device-mode-set.wall',
  draft: {type: 'org.bunny.device-mode.set.requested', subject: 'wall', dataschema: 'https://bunny.invalid/events/device-mode-set/2.0', data: {mode}},
});
const desiredMode = (h: Harness, mode: string): Outcome => {
  const desired = wallRecord(h)?.desired.mode;
  return (desired?.status === 'known' && desired.value === mode) || `the wall's desired mode is ${show(desired)}`;
};
const observedPower = (h: Harness, on: boolean): Outcome => {
  const observed = wallRecord(h)?.observed;
  return (observed?.status === 'known' && observed.power.status === 'known' && observed.power.value === on) || `the wall's observed state is ${show(observed)}`;
};
const wallAvailability = (h: Harness, availability: DeviceRecord['availability']): Outcome =>
  wallRecord(h)?.availability === availability || `the wall is ${String(wallRecord(h)?.availability)}`;
/** The answer to the reader's sync of `device` alone from the Nanoleaf module, as `synced <family>:<ids>` or the refusal's code. */
const alone = new WeakMap<Harness, string>();
/** A read-only part may sync any one family the module serves; the module answers that family only (Hub #970). */
async function syncDevicesAlone(h: Harness): Promise<void> {
  const result = await h.sdk('reader').sync(['device'], () => {}, {timeoutMs: 5000, owner: NANOLEAF_OWNER});
  if (result.status !== 'synced') {
    alone.set(h, `rejected ${result.error.error.code}`);
    return;
  }
  const states = result.copy.states();
  alone.set(h, `synced ${[...new Set(states.map(state => state.dataschema.split('/').at(-2)))].join(',')}:${states.map(state => (state.data as {id?: string}).id).join(',')}`);
  await result.copy.close();
}
/**
 * Whether the reader's wall view shows a hold after an uncertain write, with the device record's availability, and
 * whether the record's `held` names the held write's request (`device/2.1`, Hub #975): `held` is that request, or
 * undefined for a wall nothing holds, whose record then has no `held`.
 */
const wallHeld = (h: Harness, held: string | undefined, availability: DeviceRecord['availability']): Outcome => {
  const view = h.reader.states<{id: string; held: boolean}>(NANOLEAF_FAMILIES.wall.family, NANOLEAF_OWNER).find(state => state.data.id === 'wall')?.data;
  const record = wallRecord(h);
  return (view?.held === (held !== undefined) && record?.availability === availability && record.held?.requestId === held) ||
    `the wall is ${String(record?.availability)}, held ${String(view?.held)}, and its record holds ${show(record?.held)}`;
};
const linesTaken = (h: Harness, count: number): Outcome => {
  const taken = wallTasks(h).filter(task => task.element !== null).length;
  return taken === count || `${taken} tasks on Lines`;
};
const wallBrightness = (requestId: string, percent: number): {key: string; draft: CommandDraft<object>} => ({
  key: 'bunny.cmd.brightness-set.wall',
  draft: {type: 'org.bunny.brightness.set.requested', subject: 'wall', dataschema: 'https://bunny.invalid/events/brightness-set/2.0', data: {percent}},
});

/**
 * The Nanoleaf module (Hub #844), as a person uses the wall: it follows the agent session the hook reports onto a Line,
 * shows its finished turn, takes Work, Quiet and Free from the operator with tracked outcomes, refuses a moment and an
 * animation outside Free, reports the power the wall itself reports, and shows the wall unavailable while it does not
 * answer, logging the outage once each way. A mode is the module's own state, so a mode command completes as observed
 * even while the wall does not answer, holds nothing, and the wall shows the mode and a new session once it answers; a
 * write whose answer is lost holds the wall, shown as held and degraded, with the device record's `held` naming that
 * write (Hub #975), until the operator's next mode command. The token appears nowhere.
 */
const nanoleafWall: Scenario = {
  id: 'nanoleaf-wall',
  title: 'the Nanoleaf wall follows the agent session, takes Work, Quiet and Free, and reports its power',
  seed: {modules: ['core', 'nanoleaf'], follows: [CORE_FAMILIES, NANOLEAF_FAMILIES_FOLLOWED], config: {nanoleaf: NANOLEAF_SECTION}},
  steps: [
    expect('the core and the Nanoleaf module are running', h => running(h, ['core', 'nanoleaf'])),
    expect('health names the Nanoleaf module as serving device, beside its own families', async h => {
      const serves = (await h.health()).find(module => module.name === 'nanoleaf')?.serves;
      return show(serves) === show(['device', NANOLEAF_FAMILIES.wall.family, NANOLEAF_FAMILIES.animations.family]) || `nanoleaf serves ${show(serves)}`;
    }),
    expect('the reader\'s copy shows the wall available, with the power the wall reported', h =>
      wallAvailability(h, 'available') === true ? observedPower(h, true) : wallAvailability(h, 'available'), 10_000),
    act('the reader, which keeps the full copy, also syncs device alone from the Nanoleaf module', h => syncDevicesAlone(h)),
    expect('that sync holds the wall\'s device record only, and the module runs on', h => {
      const answer = alone.get(h);
      if (answer !== 'synced device:wall') return `the sync of device alone is ${String(answer)}`;
      return running(h, ['core', 'nanoleaf']);
    }),
    act('the hook observes a session start and a turn', async h => {
      await publish(h, sessionStarted);
      await publish(h, turnStarted);
    }),
    expect('the wall shows the working session on a Line', h => onTheWall(h, 'working'), 5000),
    expect('the Lines show the task\'s indicator', h => theLines(h)?.effect === 'custom' || `the Lines show ${String(theLines(h)?.select)}`, 5000),
    act('the hook observes the turn end', h => publish(h, turnEnded)),
    expect('the wall shows the finished turn, unread', h => onTheWall(h, 'unread'), 5000),
    act('the operator sets the wall to Quiet as req-quiet', h => dispatchOnce(h, 'operator', 'quiet', wallMode('req-quiet', 'quiet'), 'req-quiet')),
    expect('history holds req-quiet succeeded as observed: the mode is the module\'s own, and the wall follows it', async h =>
      (await recorded(h, 'req-quiet', 'succeeded', 'observed')), 5000),
    expect('the reader\'s copy shows Quiet, and the Lines dim to the Quiet level', h =>
      desiredMode(h, 'quiet') === true ? theLines(h)?.brightness === 10 || `the Lines are at ${String(theLines(h)?.brightness)}` : desiredMode(h, 'quiet')),
    act('the operator sets the wall to Free as req-free', h => dispatchOnce(h, 'operator', 'free', wallMode('req-free', 'free'), 'req-free')),
    expect('the Lines play their saved scene again', h => theLines(h)?.select === 'Beach Waves' || `the Lines show ${String(theLines(h)?.select)}`, 5000),
    act('the operator asks the wall for a moment as req-moment', h => h.dispatch('operator', 'moment', {
      key: 'bunny.cmd.moment-play.wall', draft: {type: 'org.bunny.moment.play.requested', subject: 'wall', dataschema: 'https://bunny.invalid/events/moment-play/2.0',
        data: {momentId: 'moment-1', mood: 'calm', durationMs: 1000, priorityClass: 'event', coversStatus: false, startAtMs: h.now(), toleranceMs: 100}},
    }, 'req-moment')),
    expect('the moment is refused: the wall plays no moments', h => answered(h, 'moment', 'unsupported-capability')),
    act('the operator sets the wall to Work as req-work', h => dispatchOnce(h, 'operator', 'work', wallMode('req-work', 'work'), 'req-work')),
    expect('the Lines show the task again', h => desiredMode(h, 'work') === true ? theLines(h)?.effect === 'custom' && theLines(h)?.select === '*Dynamic*' ||
      `the Lines show ${String(theLines(h)?.select)}` : desiredMode(h, 'work'), 5000),
    act('the operator asks for an animation in Work as req-play', h => h.dispatch('operator', 'play', {
      key: `bunny.cmd.${NANOLEAF_FAMILIES.animationPlay.family}.wall`, draft: {type: NANOLEAF_FAMILIES.animationPlay.type, subject: 'wall',
        dataschema: `https://bunny.invalid/events/${NANOLEAF_FAMILIES.animationPlay.family}/2.0`, data: {animation: {preset: 'ocean'}}},
    }, 'req-play')),
    expect('the animation is refused: Work presents agent status', h => answered(h, 'play', 'unsupported-capability')),
    act('the wall is switched off from the Nanoleaf app', h => { h.simulate({device: 'nanoleaf', action: 'power-off'}); }),
    expect('the reader\'s copy shows the power the wall reports: off', h => observedPower(h, false), 15_000),
    act('the wall is switched on again and then stops answering', h => {
      h.simulate({device: 'nanoleaf', action: 'power-on'});
      h.simulate({device: 'nanoleaf', action: 'offline'});
    }),
    expect('the reader\'s copy shows the wall unavailable, and the module runs on', h =>
      wallAvailability(h, 'unavailable') === true ? running(h, ['core', 'nanoleaf']) : wallAvailability(h, 'unavailable'), 10_000),
    act('the operator sets the wall to Quiet as req-offline while it does not answer', h =>
      dispatchOnce(h, 'operator', 'offline', wallMode('req-offline', 'quiet'), 'req-offline')),
    expect('history holds req-offline succeeded as observed: the mode commits whether or not the wall answers', async h =>
      (await recorded(h, 'req-offline', 'succeeded', 'observed')), 5000),
    act('the wall answers again', h => { h.simulate({device: 'nanoleaf', action: 'online'}); }),
    expect('the reader\'s copy shows the wall available', h => wallAvailability(h, 'available'), 40_000),
    expect('nothing is held, and the wall shows Quiet once it answers', h => {
      const shown = wallHeld(h, undefined, 'available') === true ? desiredMode(h, 'quiet') : wallHeld(h, undefined, 'available');
      return shown === true ? theLines(h)?.brightness === 10 || `the Lines are at ${String(theLines(h)?.brightness)}` : shown;
    }, 10_000),
    act('the hook observes a second session start and a turn', async h => {
      await publish(h, sessionStarted, {identity: OTHER});
      await publish(h, turnStarted, {identity: OTHER});
    }),
    expect('the wall shows the second session on a Line, with no mode command to release it', h => linesTaken(h, 2), 10_000),
    expect('the outage was logged once as it began and once as it ended', h => {
      const events = h.logs().filter(({record}) => record.attributes['bunny.module'] === 'nanoleaf' &&
        ['device.unavailable', 'device.available'].includes(record.event_name) && record.severity_text !== 'DEBUG').map(({record}) => record.event_name);
      return show(events) === show(['device.unavailable', 'device.available']) || `logged ${show(events)}`;
    }),
    act('the wall will lose its answer to the next brightness write', h => { h.simulate({device: 'nanoleaf', action: 'lose-next-answer'}); }),
    act('the operator sets the Lines to 20% as req-lost', h => dispatchOnce(h, 'operator', 'lost', wallBrightness('req-lost', 20), 'req-lost')),
    expect('history holds req-lost uncertain: the write may have reached the wall', async h => (await recorded(h, 'req-lost', 'uncertain', 'none')), 10_000),
    expect('the reader\'s copy shows the wall held and degraded, not unavailable, and its device record names req-lost as held', h =>
      wallHeld(h, 'req-lost', 'degraded'), 15_000),
    expect('the hold names the tracked action: the core\'s operation for the held request ID is the uncertain one, with its inbox item (#923)', async h => {
      const held = wallRecord(h)?.held?.requestId;
      if (held === undefined) return 'the wall\'s record holds nothing';
      const items = inboxOf(h, held);
      return (await recorded(h, held, 'uncertain', 'none')) === true && items.length === 1 && items[0]?.kind === 'operation' && items[0].result === 'uncertain' ||
        `the held ${held}: history ${show((await recorded(h, held, 'uncertain', 'none')))}, inbox ${show(items)}`;
    }),
    expect('the hold was logged once', h => {
      const holds = logged(h, 'nanoleaf', 'operation.failed').filter(({record}) => record.attributes['bunny.code'] === 'uncertain-result').length;
      return holds === 1 || `${holds} hold records`;
    }),
    act('the operator sets the wall to Work as req-release', h => dispatchOnce(h, 'operator', 'release', wallMode('req-release', 'work'), 'req-release')),
    expect('the mode command released the hold: the wall is available, not held, and its device record has no held', h =>
      wallHeld(h, undefined, 'available'), 10_000),
    holds('no log record, message, health entry or reader copy carries the token', async h => noToken(h), 300),
  ],
};

/** Where the `nanoleaf-migrated` run keeps its synthetic Nanoleaf bridge state, `<data>/nanoleaf-bridge` (Hub #933). */
export const nanoleafBridgeOf = (dataDir: string): string => join(dataDir, 'nanoleaf-bridge');
/** The secrets directory the migration writes each Nanoleaf token into: the run's own, `<data>/config/secrets`. */
export const migratedSecretsOf = (dataDir: string): string => join(configDirOf(dataDir), 'secrets');

/** The migration tool's arguments for the run: the bridge's state into the run's state directory, secrets and section. */
export const nanoleafMigrationArgs = (operation: 'migrate' | 'verify', dataDir: string, section = join(migrationOf(dataDir), 'nanoleaf-section.json')): string[] =>
  [operation, '--source', nanoleafBridgeOf(dataDir), '--state-dir', stateDirOf(dataDir), '--secrets-dir', migratedSecretsOf(dataDir), '--section', section];

/**
 * Writes a synthetic Nanoleaf bridge state of the installed shape, with the simulated controllers' addresses and token
 * and the run's synthetic Claude Code hook as its qualified source, and runs the migration tool's `migrate` into the run's
 * state directory, as the installer will before the runtime's first start at the cutover (#840). Puts the section it
 * wrote into the run's configuration file in place of the simulated one, then runs `verify` against that file, as the
 * cutover's go. Keeps each line in `<data>/migration/nanoleaf-{migrate,verify}.json` with the section it wrote, and
 * fails the seed unless both exit 0.
 */
async function migrateNanoleaf(dataDir: string): Promise<void> {
  await mkdir(nanoleafBridgeOf(dataDir), {mode: 0o700});
  await writeSyntheticNanoleafState(nanoleafBridgeOf(dataDir), {qualifiedSources: SIMULATED_WALL.qualifiedSources});
  await mkdir(migrationOf(dataDir), {mode: 0o700});
  const run = async (operation: 'migrate' | 'verify', section?: string): Promise<void> => {
    let line = '';
    const exit = await runNanoleafMigration(nanoleafMigrationArgs(operation, dataDir, section), {write: text => { line += text; }});
    await writeFile(join(migrationOf(dataDir), `nanoleaf-${operation}.json`), line, {mode: 0o600});
    if (exit !== 0) throw new Error(`the Nanoleaf migration's ${operation} exited ${exit}`);
  };
  await run('migrate');
  const {config} = JSON.parse(await readFile(join(dataDir, RUN_FILE), 'utf8')) as RunFile;
  const file = JSON.parse(await readFile(config, 'utf8')) as {modules: Record<string, unknown>};
  file.modules.nanoleaf = JSON.parse(await readFile(join(migrationOf(dataDir), 'nanoleaf-section.json'), 'utf8')) as unknown;
  await writeFile(config, `${JSON.stringify(file, null, 2)}\n`, {mode: 0o600});
  await run('verify', config);
}

/** The editor reads the existing owner and sends one explicit tracked edit; it owns no controller or state. */
const editorReads = new WeakMap<Harness, {writes: number; revision: number}>();
const editorRecord = (h: Harness): {configurationRevision: number; settings: {rotation: number}} | undefined =>
  h.reader.states<{id: string; configurationRevision: number; settings: {rotation: number}}>(NANOLEAF_FAMILIES.wall.family, NANOLEAF_OWNER)
    .find(state => state.data.id === 'wall')?.data;
const editorMutation = {target: 'wall', requestId: 'req-editor-rotate', data: {edit: {kind: 'settings', settings: {rotation: 90}}}};
const nanoleafEditor: Scenario = {
  id: 'nanoleaf-editor', title: 'the wall editor reads cached geometry, tracks one edit and retains observed power',
  seed: {modules: ['core', 'nanoleaf'], follows: [CORE_FAMILIES, NANOLEAF_FAMILIES_FOLLOWED], config: {nanoleaf: NANOLEAF_SECTION}},
  steps: [
    expect('the wall is available with observed power on', h => wallAvailability(h, 'available') === true ? observedPower(h, true) : wallAvailability(h, 'available'), 10_000),
    expect('the authenticated module catalog declares the React Wall page', async h => {
      const answer = await h.gateway({as: 'reader', method: 'GET', path: '/api/v2/modules'});
      return answer.status === 200 && answer.text.includes('"presentation":"react"') && answer.text.includes('"id":"wall"')
        || `the module catalog answered ${answer.status}`;
    }),
    act('the reader records controller writes and owner revision before opening the editor', h => {
      editorReads.set(h, {writes: theLines(h)?.writes ?? -1, revision: editorRecord(h)?.configurationRevision ?? -1});
    }),
    expect('the cached configured-device geometry read succeeds without exposing secrets', async h => {
      const answer = await h.gateway({as: 'reader', method: 'GET', path: '/modules/nanoleaf/content/editor-layout?device=wall'});
      const value = JSON.parse(answer.text) as {schema?: string; device?: string; geometry?: {lines?: unknown[]}};
      return answer.status === 200 && value.schema === 'nanoleaf-editor-layout/2.0' && value.device === 'wall'
        && (value.geometry?.lines?.length ?? 0) > 0 && !/tok_SYNTHETIC|192\.0\.2|"token"/.test(answer.text)
        || `the cached geometry read answered ${answer.status}`;
    }),
    expect('page reads changed no controller write or owner configuration', h => {
      const before = editorReads.get(h);
      return before !== undefined && before.writes === theLines(h)?.writes && before.revision === editorRecord(h)?.configurationRevision
        || 'a passive editor read changed controller or configuration state';
    }),
    expect('a read-only credential cannot edit the wall', async h => {
      const answer = await h.gateway({as: 'reader', method: 'POST', path: '/api/v2/commands/nanoleaf-wall-edit', body: editorMutation});
      return answer.status === 403 || `read-only edit answered ${answer.status}`;
    }),
    expect('a foreign Origin cannot use the browser session to edit', async h => {
      const answer = await h.gateway({as: 'browser', method: 'POST', path: '/api/v2/commands/nanoleaf-wall-edit', origin: 'other',
        headers: {'bunny-request': '1'}, body: editorMutation});
      return answer.status === 403 || `foreign-Origin edit answered ${answer.status}`;
    }),
    expect('one explicit authenticated editor command is accepted', async h => {
      const answer = await h.gateway({as: 'operator', method: 'POST', path: '/api/v2/commands/nanoleaf-wall-edit', body: editorMutation});
      return answer.status === 200 && (JSON.parse(answer.text) as {status?: string}).status === 'accepted' || `the editor command answered ${answer.status}`;
    }),
    expect('the owner record contains the selected rotation', h => editorRecord(h)?.settings.rotation === 90 || 'the owner has not selected 90 degrees'),
    expect('the command completes with observed owner-state evidence', h => recorded(h, 'req-editor-rotate', 'succeeded', 'observed'), 5000),
    act('the simulator power switch turns the wall off', h => { h.simulate({device: 'nanoleaf', action: 'power-off'}); }),
    expect('the owner reports the observed off state', h => observedPower(h, false), 15_000),
    act('the simulator power switch turns the wall on', h => { h.simulate({device: 'nanoleaf', action: 'power-on'}); }),
    expect('the owner reports the observed on state', h => observedPower(h, true), 15_000),
    expect('synthetic credentials appear in no record or message', noToken),
  ],
};

export const scenarios: readonly Scenario[] = [nanoleafWall, nanoleafEditor];

export const runs: Readonly<Record<string, ModuleRun>> = {
  'nanoleaf-migrated': {
    description: 'The shipped runtime with the Nanoleaf module on a bridge state migrated from a synthetic one of the installed shape, the Lines and NL22 Light Panels, '
      + 'as the installer migrates it before the runtime starts (Hub #933)',
    prepare: migrateNanoleaf,
  },
};
