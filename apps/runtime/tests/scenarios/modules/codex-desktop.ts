// The Codex Desktop module's scenarios (Hub #926, #999): its read marker as read evidence for the core's sessions. The
// catalog collects this file.
import {CODEX_DESKTOP_SIMULATED_SECTION} from '@jimmie-potts/codex-desktop';
import {sessionEntityId, type Identity} from '@jimmie-potts/event-contracts/v2/families';
import {turnEnded} from '../../fixtures/agents.js';
import {act, expect, holds, logged, publish, running, session, show, type Harness, type Scenario, type Simulation} from '../framework.js';

const desktopIdentity = (sessionId: string): Identity => ({
  provider: 'codex', client: 'desktop', hostId: CODEX_DESKTOP_SIMULATED_SECTION.hostId, sourceId: CODEX_DESKTOP_SIMULATED_SECTION.sourceId, sessionId,
});
const desktopRead = (h: Harness, sessionId: string): string => session(h, sessionEntityId(desktopIdentity(sessionId)))?.read ?? 'missing';
/** A Codex Desktop session's turn ends, as its hook reports it; a subagent names its parent. */
const desktopTurnEnds = (h: Harness, sessionId: string, parent?: string): Promise<void> =>
  publish(h, turnEnded, {identity: desktopIdentity(sessionId), ...(parent === undefined ? {} : {parent: {status: 'known', identity: desktopIdentity(parent)}})});
const marker = (simulation: Simulation) => (h: Harness): void => { h.simulate(simulation); };

/**
 * Codex Desktop's read marker as read evidence (Hub #926), with a simulated marker: a top-level Desktop session reads
 * unread while Desktop lists it and read once it does not, a subagent never gets read evidence, an unusable marker gives
 * none, and a Codex home that stalls makes the marker unavailable, logged once, while the core takes observations, until
 * it answers again.
 */
const codexDesktopRead: Scenario = {
  id: 'codex-desktop-read',
  title: 'Codex Desktop\'s read marker becomes read evidence for its top-level sessions',
  seed: {modules: ['core', 'codex-desktop'], follows: [['session']], config: {'codex-desktop': CODEX_DESKTOP_SIMULATED_SECTION}},
  steps: [
    act('a Codex Desktop turn ends, and one of its subagent\'s', async h => {
      await desktopTurnEnds(h, 'thread-1');
      await desktopTurnEnds(h, 'thread-1-agent', 'thread-1');
    }),
    expect('the reader holds both sessions, their read state unknown', h =>
      (desktopRead(h, 'thread-1') === 'unknown' && desktopRead(h, 'thread-1-agent') === 'unknown') || `${desktopRead(h, 'thread-1')}, ${desktopRead(h, 'thread-1-agent')}`),
    act('Desktop lists both as unread', marker({device: 'codex-desktop', action: 'list', sessions: ['thread-1', 'thread-1-agent']})),
    expect('the top-level session reads unread, and the subagent gets no read evidence', h =>
      (desktopRead(h, 'thread-1') === 'unread' && desktopRead(h, 'thread-1-agent') === 'unknown') || `${desktopRead(h, 'thread-1')}, ${desktopRead(h, 'thread-1-agent')}`, 6000),
    act('Desktop clears the flag', marker({device: 'codex-desktop', action: 'list', sessions: []})),
    expect('the session reads read', h => desktopRead(h, 'thread-1') === 'read' || desktopRead(h, 'thread-1'), 6000),
    act('the marker turns into another format', marker({device: 'codex-desktop', action: 'unusable'})),
    act('another Desktop turn ends', h => desktopTurnEnds(h, 'thread-2')),
    expect('the reader holds the new session', h => desktopRead(h, 'thread-2') !== 'missing' || 'missing'),
    holds('an unusable marker gives no read evidence, however long the turn has been over', h => desktopRead(h, 'thread-2') === 'unknown' || desktopRead(h, 'thread-2'), 8000),
    act('Desktop writes the known format again, listing nothing', marker({device: 'codex-desktop', action: 'list', sessions: []})),
    expect('the finished session reads read', h => desktopRead(h, 'thread-2') === 'read' || desktopRead(h, 'thread-2'), 6000),
    act('the Codex home stalls', marker({device: 'codex-desktop', action: 'stall'})),
    act('another Desktop turn ends', h => desktopTurnEnds(h, 'thread-3')),
    expect('the marker is unavailable, logged once, while the core still takes observations', h => {
      const unavailable = logged(h, 'codex-desktop', 'device.unavailable').map(entry => entry.record.severity_text);
      return (show(unavailable) === show(['WARN']) && desktopRead(h, 'thread-3') === 'unknown') || `logged ${show(unavailable)}, thread-3 ${desktopRead(h, 'thread-3')}`;
    }, 9000),
    expect('the module still runs', h => running(h, ['core', 'codex-desktop'])),
    act('the Codex home answers again', marker({device: 'codex-desktop', action: 'answer'})),
    expect('the marker is available again, and the finished session reads read', h => {
      const available = logged(h, 'codex-desktop', 'device.available').length;
      return (available === 1 && desktopRead(h, 'thread-3') === 'read') || `available ${available}, thread-3 ${desktopRead(h, 'thread-3')}`;
    }, 6000),
  ],
};

export const scenarios: readonly Scenario[] = [codexDesktopRead];
