// The dashboard's catalog scenarios (Hub #922), shared unchanged by the in-memory harness and disposable runs.
// Their fixture identities and consumer policy belong here; the shared catalog only collects these definitions.
import {sessionEntityId, type OperationRecord, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {LIFX_SIMULATED_SECTION} from '@jimmie-potts/lifx';
import {deviceAction, operationView} from '../../dashboard/src/devices.js';
import {SIGN_SECTION} from '../fixtures/sign.js';
import {chipOf} from '../../dashboard/src/sessions.js';
import {OTHER, SESSION_ID, approvalPrompt, approvalResolved, runtimeEnded, sessionStarted, turnEnded, turnStarted} from '../fixtures/agents.js';
import {
  CORE_FAMILIES, StepFailure, act, answers, bodyOf, expect, holds, publish, sendOnce, session, show, type Harness, type Outcome, type Scenario,
} from './framework.js';

const acknowledgedBy = (h: Harness, consumers: readonly string[]): Outcome => {
  const held = session(h)?.notices[0]?.acknowledgedBy;
  return show(held) === show(consumers) || `the notice is acknowledged by ${show(held)}`;
};

/**
 * The dashboard's sessions (Hub #922): a browser signed in by a trusted loopback page reads the core's sessions on
 * `/api/v2`, as the dashboard's page loads from the gateway, and the dashboard's chip comes from its row helper
 * over the record alone. Sessions appear as the hook observes them, and an approval prompt is raised and cleared.
 */
const browserSessions = async (h: Harness): Promise<SessionRecord[] | string> => {
  const answer = await h.gateway({as: 'browser', method: 'GET', path: '/api/v2/families/session'});
  const read = bodyOf<{records?: SessionRecord[]}>(answer);
  return answer.status === 200 && read?.records !== undefined ? read.records : `the session read answered ${answer.status}`;
};
/** What the dashboard shows of a session: its state by the row helper, `idle` when nothing is outstanding. */
const dashboardShows = (expected: string, id = SESSION_ID) => async (h: Harness): Promise<Outcome> => {
  const records = await browserSessions(h);
  if (typeof records === 'string') return records;
  const record = records.find(item => item.id === id);
  const shown = record === undefined ? 'absent' : chipOf(record);
  return shown === expected || `the dashboard shows ${shown}`;
};
const dashboardSessions: Scenario = {
  id: 'dashboard-sessions',
  title: 'the dashboard shows the sessions as the hook observes them, an approval prompt raised and cleared',
  seed: {modules: ['core'], follows: [['session']]},
  steps: [
    expect('the gateway serves the dashboard\'s page to a browser', answers({as: 'browser', method: 'GET', path: '/'}, answer =>
      (answer.status === 200 && answer.headers['content-type'] === 'text/html; charset=utf-8' && answer.text.includes('/dashboard.js')) ||
      `${answer.status} ${answer.headers['content-type'] ?? ''}`)),
    expect('the dashboard shows no session yet', async h => {
      const records = await browserSessions(h);
      return (Array.isArray(records) && records.length === 0) || show(records);
    }),
    act('the hook observes a session start and a turn', async h => {
      await publish(h, sessionStarted, {title: {value: 'Port the wall', source: 'provider'}});
      await publish(h, turnStarted);
    }),
    expect('the dashboard shows the session working, by its title', async h => {
      const records = await browserSessions(h);
      if (typeof records === 'string') return records;
      return records.find(record => record.id === SESSION_ID)?.title?.value === 'Port the wall' || 'no titled session';
    }),
    expect('it is working', dashboardShows('working')),
    act('the hook observes an approval prompt', h => publish(h, approvalPrompt('approval-1'))),
    expect('the dashboard shows it waiting for the approval', dashboardShows('approval')),
    act('the hook observes the approval resolved', h => publish(h, approvalResolved('approval-1'))),
    expect('the dashboard shows it working again', dashboardShows('working')),
    expect('the reader\'s synced copy agrees', h => (session(h) !== undefined && chipOf(session(h) as SessionRecord) === 'working') || 'the copy disagrees'),
  ],
};

/**
 * A finished turn on the dashboard (Hub #922, ADR 0012 "Inbox and history"): unread from the session record, held there
 * with no timer clearing it, cleared by a new turn, any consumer's acknowledgment or positive read evidence, and gone
 * with the session's end. The page sends no command. It never becomes an inbox item.
 */
const DASHBOARD_READ_IDENTITY = {...OTHER, provider: 'codex', client: 'desktop', sourceId: 'codex-desktop'} as const;
const DASHBOARD_READ_ID = sessionEntityId(DASHBOARD_READ_IDENTITY);
const dashboardFinishedTurn: Scenario = {
  id: 'dashboard-finished-turn',
  title: 'the dashboard shows a finished turn unread until the session record clears it',
  seed: {modules: ['core'], follows: [CORE_FAMILIES]},
  steps: [
    act('the hook observes a session\'s turn start and end', async h => {
      await publish(h, sessionStarted);
      await publish(h, turnStarted);
      await publish(h, turnEnded);
    }),
    expect('the dashboard shows the finished turn unread', dashboardShows('finished')),
    holds('nothing clears it on a timer, and it is no inbox item', async h => {
      const shown = await dashboardShows('finished')(h);
      return shown !== true ? shown : h.reader.states('inbox-item').length === 0 || 'an inbox item';
    }, 2000),
    act('the hook observes the next turn start', h => publish(h, turnStarted, {turn: 'turn-2'})),
    expect('the new turn clears the finished one for the consumers that clear on one, and the session works', async h => {
      const shown = await dashboardShows('working')(h);
      return shown !== true ? shown : acknowledgedBy(h, ['nanoleaf', 'pixoo']);
    }),
    act('the hook observes that turn end', h => publish(h, turnEnded, {turn: 'turn-2'})),
    expect('the dashboard shows it unread again', dashboardShows('finished')),
    act('the panel acknowledges the newest notice for itself', h => sendOnce(h, 'panel', 'acknowledge', {
      key: `bunny.cmd.notice-acknowledge.${SESSION_ID}`,
      draft: {
        type: 'org.bunny.notice.acknowledge.requested', subject: SESSION_ID, dataschema: 'https://bunny.invalid/events/notice-acknowledge/2.0',
        data: {consumerId: 'panel', noticeId: session(h)?.notices.find(notice => notice.acknowledgedBy.length === 0)?.id ?? ''},
      },
    }, 'req-dashboard-acknowledge')),
    expect('an acknowledgment in the record clears it', dashboardShows('idle')),
    act('the hook observes a Codex Desktop session and its finished turn', async h => {
      await publish(h, sessionStarted, {identity: DASHBOARD_READ_IDENTITY});
      await publish(h, turnStarted, {identity: DASHBOARD_READ_IDENTITY});
      await publish(h, turnEnded, {identity: DASHBOARD_READ_IDENTITY});
    }),
    expect('the Desktop finished turn is unread', dashboardShows('finished', DASHBOARD_READ_ID)),
    act('positive read evidence reaches the Desktop session record', h => publish(h, {kind: 'read-observed', state: 'read'}, {identity: DASHBOARD_READ_IDENTITY})),
    expect('read evidence clears the unread chip without an acknowledgment', dashboardShows('idle', DASHBOARD_READ_ID)),
    act('the hook observes the session\'s runtime end', h => publish(h, runtimeEnded, {turn: 'turn-2'})),
    expect('the session leaves the dashboard', dashboardShows('absent')),
  ],
};

/** Guarded user labels through the browser action route, with synced metadata as the completion evidence. */
const browserLabel = (label: string | null, requestId: string, stale = false) => async (h: Harness): Promise<Outcome> => {
  const records = await browserSessions(h);
  if (typeof records === 'string') throw new StepFailure(records);
  const record = records.find(item => item.id === SESSION_ID);
  if (record === undefined) throw new StepFailure('the browser holds no session');
  const answer = await h.gateway({as: 'browser', method: 'POST', path: '/api/v2/commands/session-label-set',
    body: {target: record.id, requestId, data: {label, expectedRevision: record.revision - (stale ? 1 : 0)}}});
  const result = bodyOf<{status?: string; error?: {code: string}}>(answer);
  const correct = stale ? answer.status === 409 && result?.error?.code === 'revision-conflict' : answer.status === 200 && result?.status === 'accepted';
  if (!correct) throw new StepFailure(`the browser label action answered ${answer.status} ${result?.error?.code ?? result?.status ?? 'invalid-reply'}`);
  return true;
};
const dashboardLabels: Scenario = {
  id: 'session-label', title: 'the browser labels and clears a session through tracked guarded actions',
  seed: {modules: ['core'], follows: [['session', 'operation']]},
  steps: [
    act('the hook starts a titled session', h => publish(h, sessionStarted, {title: {value: 'Provider title', source: 'provider'}})),
    expect('the browser reads the title', async h => {
      const records = await browserSessions(h);
      return Array.isArray(records) && records.some(record => record.title?.value === 'Provider title') || show(records);
    }),
    act('the browser submits a guarded user label once', browserLabel('Review label', 'req-dashboard-label')),
    expect('the synced record confirms the user label', h => session(h)?.label?.origin === 'user' && session(h)?.label?.value === 'Review label' || show(session(h))),
    act('a stale attempt is refused', browserLabel('Stale label', 'req-dashboard-label-stale', true)),
    expect('the stale attempt leaves the label unchanged', h => session(h)?.label?.value === 'Review label' || show(session(h))),
    act('the browser clears the explicit label', browserLabel(null, 'req-dashboard-label-clear')),
    expect('the record retains its provider title with no explicit label', h => session(h)?.label === undefined && session(h)?.title?.value === 'Provider title' || show(session(h))),
    expect('the live operation copy confirms both metadata results', h => {
      const records = h.reader.states<OperationRecord>('operation').map(message => message.data);
      return ['req-dashboard-label', 'req-dashboard-label-clear'].every(id => records.some(record => record.requestId === id &&
        record.family === 'session-label-set' && record.target === SESSION_ID && record.status === 'completed' && record.result === 'succeeded' && record.evidence === 'observed')) || show(records);
    }),
    expect('the core publishes two observed metadata outcomes, with no stale completion', h => {
      const outcomes = h.published().map(item => item.message).filter(message => message.kind === 'outcome' && message.type === 'org.bunny.session-label.set.completed');
      return outcomes.length === 2 && outcomes.every(message => (message.data as {evidence?: unknown}).evidence === 'observed') || show(outcomes);
    }),
  ],
};

const dashboardControls: Scenario = {
  id: 'dashboard-controls', title: 'guarded dashboard controls report tracked outcomes and declared module navigation',
  seed: {modules: ['core', 'lifx', 'sign'], config: {lifx: LIFX_SIMULATED_SECTION, sign: SIGN_SECTION},
    follows: [CORE_FAMILIES, ['operation'], {owner: 'bunny/modules/lifx', families: ['device']}, {owner: 'bunny/modules/sign', families: ['device']}]},
  steps: [
    expect('both device owners appear in the current module catalog', answers({as: 'browser', method: 'GET', path: '/api/v2/modules'}, answer => {
      const modules = bodyOf<{modules: {name: string; serves?: string[]}[]}>(answer)?.modules ?? [];
      return ['lifx', 'sign'].every(name => modules.some(module => module.name === name && module.serves?.includes('device') === true)) || 'missing device owner';
    })),
    expect('the LIFX record advertises a ready power control', h => h.reader.states<DeviceRecord>('device', 'bunny/modules/lifx').some(message =>
      message.data.id === 'pendant-1' && message.data.availability === 'available' && message.data.capabilities.power.supported) || 'not ready'),
    act('one browser power control carries the current configuration and generation', async h => {
      const record = h.reader.states<DeviceRecord>('device', 'bunny/modules/lifx').find(message => message.data.id === 'pendant-1')?.data;
      if (record === undefined) throw new StepFailure('no bulb');
      const action = deviceAction(record, {family: 'power-set', data: {on: false}}, 'req-dashboard-power');
      if (typeof action === 'string') throw new StepFailure(action);
      const answer = await h.gateway({as: 'browser', method: 'POST', path: `/api/v2/commands/${action.family}`,
        body: {target: action.target, data: action.data, requestId: action.requestId}});
      if (bodyOf<{status?: string}>(answer)?.status !== 'accepted') throw new StepFailure('power was not accepted');
    }),
    expect('the core completion reports transmitted evidence without claiming physical observation', h => {
      const operation = h.reader.states<OperationRecord>('operation').find(message => message.data.requestId === 'req-dashboard-power')?.data;
      return operation !== undefined && operation.status === 'completed' && !operationView(operation).locked &&
        operationView(operation).text.includes('physical effect was not observed') || 'no transmitted completion';
    }),
    expect('the declared sign page stays script-free and can be framed only by this origin', answers({as: 'browser', method: 'GET', path: '/modules/sign/preview'}, answer =>
      answer.status === 200 && answer.headers['x-frame-options'] === 'SAMEORIGIN' && answer.headers['content-security-policy']?.includes("frame-ancestors 'self'") === true || 'page policy differs')),
    expect('the browser can read the small running build identity', answers({as: 'browser', method: 'GET', path: '/api/v2/build'}, answer =>
      answer.status === 200 && bodyOf<{schema?: string}>(answer)?.schema === 'runtime-build/2.0' || 'no build identity')),
  ],
};

export const dashboardScenarios: readonly Scenario[] = [dashboardSessions, dashboardFinishedTurn, dashboardLabels, dashboardControls];
