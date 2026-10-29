import {SpeechControls, type CompanionSpeechCopy} from './speech.js';
import {CompanionCard} from './card.js';
import {CodingSuggestions} from './suggestions.js';
import {KnowledgePage} from './knowledge.js';
import {DuckConversation, DuckWidget} from './duck.js';
export {DuckWidget} from './duck.js';
import {PreferencesPage} from './preferences.js';
import {AssistantPage} from './assistant.js';
import React, {useEffect, useRef, useState} from 'react';
import type {CompanionCategory, CompanionState} from '@jimmie-potts/event-contracts/v2/companions';
import type {FrontendContext, FrontendContribution} from '@jimmie-potts/sdk/frontend';
import type {SyncedCopy} from '@jimmie-potts/sdk/remote';

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
function ReachyView({context, advanced = false}: {context: FrontendContext; advanced?: boolean}): React.JSX.Element {
  const [state, setState] = useState<CompanionState>();
  const [unavailable, setUnavailable] = useState(false);
  const [synced, setSynced] = useState(false);
  // Speech's final check must see callback updates before React renders them.
  const speech = useRef<CompanionSpeechCopy>({state: undefined, live: false});
  const {api, connected} = context;
  useEffect(() => {
    const invalidate = (): void => {speech.current = {state: speech.current.state, live: false}; setSynced(false);};
    invalidate();
    if (!connected) return;
    let active = true;
    let replacing = false;
    let copy: SyncedCopy<CompanionState> | undefined;
    let close: (() => Promise<void>) | undefined;
    const show = (): void => {
      const current = copy?.states().find(message => message.data.id === 'reachy');
      if (current !== undefined) {speech.current = {state: current.data, live: true}; setState(current.data); setUnavailable(false); setSynced(true);}
      else {setUnavailable(true); invalidate();}
    };
    void api.sync<CompanionState>(['companion-state'], change => {
      if (!active) return;
      if (change.type === 'updated') {speech.current = {...speech.current, state: change.message.data}; setState(change.message.data); setUnavailable(false);}
      else if (change.type === 'failed') {replacing = true; setUnavailable(true); invalidate();}
      else if (change.type === 'synced') {replacing = false; if (copy !== undefined) show();}
      else if (change.type === 'removed' && change.entity.id === 'reachy') {setUnavailable(true); invalidate();}
    }, {onRestarted: () => {if (active) {replacing = true; invalidate();}}}).then(result => {
      if (result.status !== 'synced') {if (active) setUnavailable(true); return;}
      if (!active) {void result.copy.close(); return;}
      close = () => result.copy.close();
      copy = result.copy;
      if (!replacing) show();
    }, () => {if (active) setUnavailable(true);});
    return () => {active = false; speech.current = {state: speech.current.state, live: false}; void close?.();};
  }, [api, connected]);
  const live = connected && synced && !unavailable && state !== undefined;
  const {Command, Facts, Badge} = context.ui;
  const presentation = state?.presentation;
  const textContext = {...context, operations: context.operations.filter(operation => operation.family !== 'companion-speech-play')};
  const controls = state === undefined ? <p className="companion-small">Controls unavailable.</p> : <Command context={textContext} target="reachy">{command => {
    const locked = command.locked || !live || !context.control;
    const save = (enabled: boolean, muted: CompanionCategory[], snooze: 'keep' | 'one-hour' | 'clear' = 'keep'): void => {
      if (locked) return;
      void command.run({family: 'companion-settings-set', target: 'reachy', requestId: crypto.randomUUID(), data: {expectedRevision: state.revision, enabled, muted, snooze}});
    };
    const snoozed = state.settings.snoozedUntilMs > Date.now();
    return <><fieldset className="companion-controls" disabled={locked}><legend>Reachy controls</legend>
      <button className="companion-primary" type="button" aria-label={`${state.settings.enabled ? 'Disable' : 'Enable'} Reachy text cards`} aria-pressed={state.settings.enabled}
        onClick={() => {save(!state.settings.enabled, state.settings.muted);}}>{state.settings.enabled ? 'Disable' : 'Enable'} text cards</button>
      <div className="companion-categories">{(Object.keys(labels) as CompanionCategory[]).map((category, index) => <button type="button" key={category}
        title={labels[category]} aria-label={`${state.settings.muted.includes(category) ? 'Unmute' : 'Mute'} ${labels[category]}`} aria-pressed={state.settings.muted.includes(category)}
        onClick={() => {save(state.settings.enabled, state.settings.muted.includes(category) ? state.settings.muted.filter(value => value !== category) : [...state.settings.muted, category]);}}>
        {['Attention', 'Turns', 'Demos'][index]}</button>)}</div>
      <button type="button" className="companion-secondary" aria-label={snoozed ? 'Clear social snooze' : 'Not now — snooze social for one hour'}
        onClick={() => {save(state.settings.enabled, state.settings.muted, snoozed ? 'clear' : 'one-hour');}}>{snoozed ? 'Resume social' : 'Snooze social · 1h'}</button>
    </fieldset>
      {command.text !== '' && <p className="companion-small" role="status">{command.text}</p>}</>;
  }}</Command>;
  return <section aria-label="Reachy" className="companion-page">
    <CompanionCard companion="reachy" name="Reachy" caption="Text companion"
      {...(!connected || unavailable ? {notice: <p>Reachy state is unavailable. Saved reactions are history.</p>} : {})}
      faces={[
        {id: 'latest', label: 'Latest', content: <>
          <p className="companion-message">{presentation?.text ?? (live ? 'No reaction yet.' : 'Reachy unavailable.')}</p>
          {presentation != null && <>
            <p className="companion-small"><span>{presentation.history || !live ? 'Saved history' : state?.decision === 'awaiting-publication' ? 'Publication pending' : 'Published card'}</span>
              {' · '}<span>{presentation.opportunity.context === 'scenario' ? 'Simulated scenario' : 'Real coding metadata'}</span></p>
            <p className="companion-small"><span>{labels[presentation.opportunity.category]}</span>{' · '}<time dateTime={new Date(presentation.opportunity.observedAtMs).toISOString()}>{new Date(presentation.opportunity.observedAtMs).toLocaleTimeString()}</time></p>
          </>}
        </>},
        {id: 'controls', label: 'Controls', content: controls},
        {id: 'voice', label: 'Voice', content: <SpeechControls context={context} companion={speech} compact/>},
      ]} footer={<>
        {presentation?.opportunity.context === 'live' && presentation.opportunity.session !== null && <a href="#/">Open session</a>}
        {!advanced && <a href="#/module/companions/reachy">Tools</a>}
      </>}/>
    {!context.control && <p className="companion-small">Read-only access. Controls require operator authority.</p>}
    {advanced && <details className="companion-evidence"><summary>Evidence &amp; tools</summary>
    <p>A fixed-text desk companion. Text cards and spoken alerts have separate enable controls.</p>
    {!live && <p role="status">Reachy state is unavailable.</p>}
    {state !== undefined && <>
      <p role="status">{reasons[state.decision] ?? 'No reaction.'} <small>Reason: {state.decision}</small></p>
      <Facts items={[
        ['Enabled', state.settings.enabled ? 'Yes' : 'No'], ['Presentation', state.availability],
        ['Social local day', state.settings.timeZone], ['Social snooze', state.settings.snoozedUntilMs > Date.now() ? 'Snoozed for up to one hour' : 'Off'],
      ]}/>
      {presentation === null || presentation === undefined ? <p>No Reachy card yet.</p> : <article aria-label="Reachy evidence">
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
      <Command context={textContext} target="reachy">{command => {
        const locked = command.locked || !live || !context.control;
        const fixture = (scenario: 'arrival' | 'visit' | 'question-and-arrival'): void => {
          void command.run({family: 'companion-fixture-run', target: 'reachy', requestId: crypto.randomUUID(), data: {scenario, busy: false, media: false}});
        };
        return <>
          <fieldset disabled={locked}><legend>Labelled synthetic scenarios</legend>
            <p>Identity and location stay unknown. These fixtures create no live household facts, speech or device commands.</p>
            <button type="button" onClick={() => {fixture('arrival');}}>Simulate arrival</button>
            <button type="button" onClick={() => {fixture('visit');}}>Simulate visit</button>
            <button type="button" onClick={() => {fixture('question-and-arrival');}}>Simulate question and arrival</button>
          </fieldset>
          {command.text !== '' && <p role="status">{command.text}</p>}
        </>;
      }}</Command>
    </>}
    </details>}
    {advanced && state !== undefined && <CodingSuggestions context={context} state={state} live={live}/>}
  </section>;
}
export function ReachyWidget({context}: {context: FrontendContext}): React.JSX.Element {return <ReachyView context={context}/>;}
function ReachyPage({context}: {context: FrontendContext}): React.JSX.Element {return <ReachyView context={context} advanced/>;}
function MicroDuckPage({context}: {context: FrontendContext}): React.JSX.Element {return <div className="companion-page"><DuckWidget context={context}/></div>;}
export const frontend: FrontendContribution = {module: 'companions', pages: [{id: 'reachy', Component: ReachyPage}, {id: 'microduck', Component: MicroDuckPage}, {id: 'assistant', Component: AssistantPage}, {id: 'preferences', Component: PreferencesPage}, {id: 'knowledge', Component: KnowledgePage}, {id: 'duck-conversation', Component: DuckConversation}]};
