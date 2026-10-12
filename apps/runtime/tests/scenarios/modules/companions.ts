import type {CompanionState} from '@jimmie-potts/event-contracts/v2/companions';
import {approvalPrompt, approvalResolved, sessionStarted, turnEnded, turnStarted} from '../../fixtures/agents.js';
import {act, dispatchOnce, expect, holds, publish, recorded, running, waiting, type Harness, type Scenario} from '../framework.js';
const state = (h: Harness): CompanionState | undefined => h.reader.states<CompanionState>('companion-state', 'bunny/modules/companions')[0]?.data;
const command = (family: string, data: object) => ({key: `bunny.cmd.${family}.reachy`, draft: {
  type: `org.bunny.${family.slice(0, family.lastIndexOf('-'))}.${family.slice(family.lastIndexOf('-') + 1)}.requested`, subject: 'reachy',
  dataschema: `https://bunny.invalid/events/${family}/2.0`, data}});
export const scenarios: readonly Scenario[] = [{
  id: 'reachy-text', title: 'optional fixed-text Reachy preserves core attention, scenario attribution and restart without replay',
  seed: {modules: ['core', 'companions'], follows: [{owner: 'bunny/core', families: ['session', 'mode', 'operation']},
    {owner: 'bunny/modules/companions', families: ['companion-state']}]},
  steps: [
    expect('core and optional companion are running', h => running(h, ['core', 'companions'])),
    expect('Reachy starts disabled without a card', h => state(h)?.settings.enabled === false && state(h)?.presentation === null || 'default differs'),
    act('hook raises attention while Reachy is disabled', async h => {await publish(h, sessionStarted); await publish(h, turnStarted); await publish(h, approvalPrompt('reachy-off'));}),
    expect('core attention remains authoritative with Reachy off', h => waiting(h, ['reachy-off'])),
    act('operator enables optional text through tracked command', h => dispatchOnce(h, 'operator', 'reachy-enable', command('companion-settings-set',
      {expectedRevision: state(h)?.revision, enabled: true, muted: [], snooze: 'keep'}), 'reachy-enable')),
    expect('enablement completes as a saved setting', h => recorded(h, 'reachy-enable', 'succeeded', 'observed')),
    holds('enablement never replays missed attention', h => state(h)?.presentation === null || 'missed request replayed', 100),
    act('hook clears the old attention and raises a fresh question', async h => {await publish(h, approvalResolved('reachy-off')); await publish(h, approvalPrompt('reachy-live'));}),
    expect('one live card is attributed to the current attention', h => {
      const card = state(h)?.presentation;
      return card?.opportunity.context === 'live' && card.opportunity.evidence === 'lifecycle-metadata' &&
        card.opportunity.attention?.id.status === 'known' && card.opportunity.attention.id.id === 'reachy-live' || 'live attribution missing';
    }),
    act('hook clears attention and ends its turn', async h => {await publish(h, approvalResolved('reachy-live')); await publish(h, turnEnded);}),
    expect('quiet turn card claims no response content', h => state(h)?.presentation?.opportunity.cue === 'turn-ended' &&
      state(h)?.presentation?.content === 'unavailable' || 'turn card differs'),
    act('operator starts a labelled mixed question and arrival', h => dispatchOnce(h, 'operator', 'reachy-mixed', command('companion-fixture-run',
      {scenario: 'question-and-arrival', busy: false, media: false}), 'reachy-mixed')),
    expect('the fixture input completes independently of visibility', h => recorded(h, 'reachy-mixed', 'succeeded', 'observed')),
    expect('coding wins within the synthetic context with unknown identity/location', h => {
      const event = state(h)?.presentation?.opportunity;
      return event?.context === 'scenario' && event.category === 'coding-attention' && event.identity === null && event.location === null || 'synthetic priority or identity differs';
    }),
    act('runtime restarts with only settings and bounded presentation records', h => h.restart()),
    expect('saved settings survive and the card is history', h => state(h)?.settings.enabled === true && state(h)?.presentation?.history === true || 'restore differs'),
    holds('restart never emits a new reaction', h => state(h)?.presentation?.history === true || 'restart replayed a card', 100),
  ],
}];
