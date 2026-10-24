import {CodingSuggestions} from './suggestions.js';
import {KnowledgePage} from './knowledge.js';
import {DuckConversation} from './duck.js';
export {DuckWidget} from './duck.js';
import {PreferencesPage} from './preferences.js';
import {AssistantPage} from './assistant.js';
import React, {useEffect, useState} from 'react';
import type {CompanionCategory, CompanionState} from '@jimmie-potts/event-contracts/v2/companions';
import type {FrontendContext, FrontendContribution} from '@jimmie-potts/sdk/frontend';

const labels: Readonly<Record<CompanionCategory, string>> = {'coding-attention': 'Coding attention', 'coding-notice': 'Turn endings', 'simulated-social': 'Simulated social'};
const reasons: Readonly<Record<string, string>> = {
  'invalid-input': 'The opportunity input was refused.', 'awaiting-publication': 'Card stored; publication is pending. Whether it was seen is unknown.', disabled: 'Reachy is disabled.', presented: 'A card was published. Whether it was seen is unknown.', 'settings-saved': 'Controls saved.',
  'scenario-admitted': 'Synthetic scenario accepted.', 'category-muted': 'This category is muted.', expired: 'The evidence expired.',
  'core-unavailable': 'Current core state is unavailable.', 'stale-source': 'The source evidence is stale.', 'obsolete-turn': 'The turn changed.',
  'source-changed': 'The session changed while turn or attention identity was unknown.', 'attention-cleared': 'The attention item was cleared.', 'attention-priority': 'Coding attention takes priority.',
  'restrictive-mode': 'Social reactions require Free mode.', 'unknown-context': 'Busy or media evidence is unknown.', busy: 'The scenario is busy.',
  media: 'The scenario has active media.', snoozed: 'Social reactions are snoozed.', 'social-budget': 'The daily social allowance is used.',
  'social-spacing': 'Social reactions must be three hours apart.', repetition: 'This opportunity has already been used.',
  'presentation-unavailable': 'Presentation is unavailable; visibility is unknown.', 'input-unavailable': 'Opportunity delivery is unavailable.',
  'obsolete-scenario': 'A newer scenario replaced this one.', coalesced: 'A newer candidate replaced an older one.',
};
function ReachyPage({context}: {context: FrontendContext}): React.JSX.Element {
  const [state, setState] = useState<CompanionState>();
  const [unavailable, setUnavailable] = useState(false);
  const [synced, setSynced] = useState(false);
  const {api, connected} = context;
  useEffect(() => {
    setSynced(false);
    if (!connected) return;
    let active = true;
    let close: (() => Promise<void>) | undefined;
    void api.sync<CompanionState>(['companion-state'], change => {
      if (!active) return;
      if (change.type === 'updated') {setState(change.message.data); setUnavailable(false);}
      else if (change.type === 'failed') {setUnavailable(true); setSynced(false);}
    }).then(result => {
      if (result.status !== 'synced') {if (active) setUnavailable(true); return;}
      if (!active) {void result.copy.close(); return;}
      close = () => result.copy.close();
      const current = result.copy.states().find(message => message.data.id === 'reachy');
      if (current !== undefined) {setState(current.data); setUnavailable(false); setSynced(true);}
      else setUnavailable(true);
    }, () => {if (active) setUnavailable(true);});
    return () => {active = false; void close?.();};
  }, [api, connected]);
  const live = connected && synced && !unavailable && state !== undefined;
  const {Command, Facts, Badge} = context.ui;
  const presentation = state?.presentation;
  return <section aria-label="Reachy" className="panel">
    <h2>Reachy</h2>
    <p>A fixed-text desk companion. Enablement adds text cards; speech stays off.</p>
    {!live && <p role="status">Reachy state is unavailable.</p>}
    {state !== undefined && <>
      <p role="status">{reasons[state.decision] ?? 'No reaction.'} <small>Reason: {state.decision}</small></p>
      <Facts items={[
        ['Enabled', state.settings.enabled ? 'Yes' : 'No'], ['Presentation', state.availability],
        ['Social local day', state.settings.timeZone], ['Social snooze', state.settings.snoozedUntilMs > Date.now() ? 'Snoozed for up to one hour' : 'Off'],
      ]}/>
      {presentation === null || presentation === undefined ? <p>No Reachy card yet.</p> : <article aria-label="Reachy card">
        <Badge>{presentation.history || !live ? 'Saved history' : state.decision === 'awaiting-publication' ? 'Publication pending' : 'Published card'}</Badge>
        <Badge>{presentation.opportunity.context === 'scenario' ? 'Simulated scenario' : 'Real coding metadata'}</Badge>
        <p>{presentation.text}</p>
        <Facts items={[
          ['Session', presentation.opportunity.identity?.sessionId ?? (presentation.opportunity.session === null ? 'Unknown' : `${presentation.opportunity.session} (synthetic)`)],
          ['Source', presentation.opportunity.origin.source], ['Event', presentation.opportunity.origin.type],
          ['Evidence', presentation.opportunity.evidence],
          ['Occurrence time', presentation.opportunity.occurredAtMs === null ? 'Unknown' : new Date(presentation.opportunity.occurredAtMs).toISOString()],
          ['Observation time', new Date(presentation.opportunity.observedAtMs).toISOString()], ['Category', labels[presentation.opportunity.category]],
          ['Identity', presentation.opportunity.identity === null ? 'Unknown' : presentation.opportunity.identity.provider],
          ['Location', 'Unknown'], ['Response content', 'Unavailable'], ['Visibility', 'Unknown'],
        ]}/>
        {presentation.opportunity.context === 'live' && presentation.opportunity.session !== null && <a href="#/">Open session attention on Home</a>}
      </article>}
      <Command context={context} target="reachy">{command => {
        const locked = command.locked || !live || !context.control;
        const save = (enabled: boolean, muted: CompanionCategory[], snooze: 'keep' | 'one-hour' | 'clear' = 'keep'): void => {
          void command.run({family: 'companion-settings-set', target: 'reachy', requestId: crypto.randomUUID(),
            data: {expectedRevision: state.revision, enabled, muted, snooze}});
        };
        const fixture = (scenario: 'arrival' | 'visit' | 'question-and-arrival'): void => {
          void command.run({family: 'companion-fixture-run', target: 'reachy', requestId: crypto.randomUUID(), data: {scenario, busy: false, media: false}});
        };
        return <>
          <fieldset disabled={locked}><legend>Reachy controls</legend>
            <button type="button" aria-pressed={state.settings.enabled} onClick={() => {save(!state.settings.enabled, state.settings.muted);}}>
              {state.settings.enabled ? 'Disable' : 'Enable'} Reachy text cards</button>
            {(Object.keys(labels) as CompanionCategory[]).map(category => <button type="button" key={category}
              aria-pressed={state.settings.muted.includes(category)} onClick={() => {
                save(state.settings.enabled, state.settings.muted.includes(category) ? state.settings.muted.filter(value => value !== category) : [...state.settings.muted, category]);
              }}>{state.settings.muted.includes(category) ? 'Unmute' : 'Mute'} {labels[category]}</button>)}
            <button type="button" onClick={() => {save(state.settings.enabled, state.settings.muted, 'one-hour');}}>Not now — snooze social for one hour</button>
            <button type="button" onClick={() => {save(state.settings.enabled, state.settings.muted, 'clear');}}>Clear social snooze</button>
          </fieldset>
          <fieldset disabled={locked}><legend>Labelled synthetic scenarios</legend>
            <p>Identity and location stay unknown. These fixtures create no live household facts, speech or device commands.</p>
            <button type="button" onClick={() => {fixture('arrival');}}>Simulate arrival</button>
            <button type="button" onClick={() => {fixture('visit');}}>Simulate visit</button>
            <button type="button" onClick={() => {fixture('question-and-arrival');}}>Simulate question and arrival</button>
          </fieldset>
          {!context.control && <p>Read-only access. Controls require operator authority.</p>}
          {command.text !== '' && <p role="status">{command.text}</p>}
        </>;
      }}</Command>
      <CodingSuggestions context={context} state={state} live={live}/>
    </>}
  </section>;
}
export const frontend: FrontendContribution = {module: 'companions', pages: [{id: 'reachy', Component: ReachyPage}, {id: 'assistant', Component: AssistantPage}, {id: 'preferences', Component: PreferencesPage}, {id: 'knowledge', Component: KnowledgePage}, {id: 'duck-conversation', Component: DuckConversation}]};
