import React, {useEffect, useRef, useState, type RefObject} from 'react';
import type {CompanionState, SpeechState} from '@jimmie-potts/event-contracts/v2/companions';
import type {FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {SyncedCopy} from '@jimmie-potts/sdk/remote';
import {replyRefusal, speechRefusal} from '../presentation-policy.js';
import {speechQualification, type SpeechQualification} from '../speech-qualification.js';
import {browserSpeechPort, SpeechDriver} from './speech-driver.js';
import {qualifiedChrome} from './speech-browser.js';
import {SpeechSession, type SpeechSessionState} from './speech-session.js';
const initial = (): SpeechSessionState => ({availability: 'off', playback: null, busy: false});
const playbackLabels = {
  dispatching: 'Waiting for the browser to start.', started: 'The browser reported playback started.', completed: 'The browser reported playback completed.',
  stopped: 'Playback stopped. The sentence may be incomplete.', uncertain: 'Playback is uncertain. It will not be replayed automatically.',
  failed: 'Speech failed before playback started.', 'not-started': 'Speech did not start.',
};

export type CompanionSpeechCopy = {state: CompanionState; live: true} | {state: CompanionState | undefined; live: false};
/** The one endpoint speaks Reachy's alerts and B.U.N.N.Y.'s replies alike; the page names what the owner came for. */
export type SpeechPurpose = 'alerts' | 'replies';
const wording: Record<SpeechPurpose, {section: string; enable: string; mute: string; on: string; off: string; other: string; quiet: string; scope: string}> = {
  alerts: {section: 'Spoken alerts', enable: 'Enable spoken alerts in this tab', mute: 'Mute spoken alerts', on: 'Spoken alerts enabled in this tab.',
    off: 'Spoken alerts are off in this tab.', other: 'Another tab has spoken alerts enabled.', quiet: 'Quiet mode suppresses new spoken alerts.',
    scope: 'This tab only. Mute before calls or media; they aren’t detected.'},
  replies: {section: 'Spoken replies', enable: 'Enable spoken replies in this tab', mute: 'Mute spoken replies', on: 'Spoken replies enabled in this tab.',
    off: 'Spoken replies are off in this tab.', other: 'Another tab has speech enabled.', quiet: 'Quiet mode suppresses spoken replies.',
    scope: 'This tab becomes the one speaker: B.U.N.N.Y.’s replies, and any enabled Reachy alerts, are spoken here. Mute before calls or media; they aren’t detected.'},
};

/** A live copy of Reachy's state for the speech endpoint's final policy check, kept in a ref so callbacks see it before React renders it. */
export function useCompanionSpeechCopy(context: FrontendContext): {copy: Readonly<RefObject<CompanionSpeechCopy>>; revision: number} {
  const copy = useRef<CompanionSpeechCopy>({state: undefined, live: false});
  const [revision, setRevision] = useState(0);
  const {api, connected} = context;
  useEffect(() => {
    const invalidate = (): void => {copy.current = {state: copy.current.state, live: false}; setRevision(value => value + 1);};
    invalidate();
    if (!connected) return;
    let active = true, replacing = false;
    let synced: SyncedCopy<CompanionState> | undefined;
    const show = (): void => {
      const current = synced?.states().find(message => message.data.id === 'reachy');
      if (current !== undefined) {copy.current = {state: current.data, live: true}; setRevision(value => value + 1);} else invalidate();
    };
    void api.sync<CompanionState>(['companion-state'], change => {
      if (!active) return;
      if (change.type === 'updated') {copy.current = {...copy.current, state: change.message.data}; setRevision(value => value + 1);}
      else if (change.type === 'failed' || (change.type === 'removed' && change.entity.id === 'reachy')) {replacing = true; invalidate();}
      else if (change.type === 'synced') {replacing = false; if (synced !== undefined) show();}
    }, {onRestarted: () => {if (active) {replacing = true; invalidate();}}}).then(result => {
      if (result.status !== 'synced') {if (active) invalidate(); return;}
      if (!active) {void result.copy.close(); return;}
      synced = result.copy; if (!replacing) show();
    }, () => {if (active) invalidate();});
    return () => {active = false; copy.current = {state: copy.current.state, live: false}; void synced?.close();};
  }, [api, connected]);
  return {copy, revision};
}

export function SpeechControls({context, companion, compact = false, purpose = 'alerts'}: {
  context: FrontendContext; companion: Readonly<RefObject<CompanionSpeechCopy>>; compact?: boolean; purpose?: SpeechPurpose;
}): React.JSX.Element {
  const {state, live} = companion.current;
  const words = wording[purpose];
  const [local, setLocal] = useState(initial);
  const [remote, setRemote] = useState<SpeechState>();
  const [synced, setSynced] = useState(false);
  const speechReady = useRef(false);
  const speechState = useRef<SpeechState | undefined>(undefined);
  const [qualification, setQualification] = useState<SpeechQualification>();
  const [replacement, setReplacement] = useState(0);
  const session = useRef<SpeechSession | undefined>(undefined);
  const current = useRef({context, companion, synced, qualification});
  current.current = {context, companion, synced, qualification};
  const {api, connected} = context;
  useEffect(() => {
    setQualification(undefined);
    if (!connected || api.speech === undefined) return;
    let active = true;
    void api.read('/modules/companions/content/speech-qualification').then(async value => {
      const receipt = speechQualification(value);
      if (receipt !== undefined && await qualifiedChrome(receipt) && active) setQualification(receipt);
    }).catch(() => {});
    return () => {active = false;};
  }, [api, connected, replacement]);
  useEffect(() => {
    const invalidate = (): void => {speechReady.current = false; setSynced(false); session.current?.update();};
    invalidate();
    if (!connected || api.speech === undefined) return;
    let active = true, replacing = false;
    let copy: SyncedCopy<SpeechState> | undefined;
    const show = (): void => {
      const value = copy?.states().find(message => message.data.id === 'reachy')?.data;
      speechReady.current = value !== undefined; speechState.current = value; setRemote(value); setSynced(speechReady.current);
    };
    void api.sync<SpeechState>(['companion-speech-state'], change => {
      if (!active) return;
      if (change.type === 'updated') {speechState.current = change.message.data; setRemote(change.message.data); session.current?.update();}
      else if (change.type === 'failed' || change.type === 'removed') {replacing = true; invalidate();}
      else if (change.type === 'synced') {replacing = false; if (copy !== undefined) show();}
    }, {onRestarted: () => {if (active) {replacing = true; invalidate(); setReplacement(value => value + 1);}}}).then(result => {
      if (result.status !== 'synced') return;
      if (!active) {void result.copy.close(); return;}
      copy = result.copy; if (!replacing) show();
    }).catch(() => {if (active) invalidate();});
    return () => {active = false; invalidate(); void copy?.close();};
  }, [api, connected]);
  useEffect(() => {
    setLocal(initial());
    if (api.speech === undefined) return;
    let active = true;
    const value = new SpeechSession({api: api.speech, createDriver: () => {
      const port = browserSpeechPort(), receipt = current.current.qualification;
      return port === undefined || receipt === undefined ? undefined : new SpeechDriver({port, voice: receipt.voice});
    }, usable: () => {
      const now = current.current;
      return speechReady.current && now.companion.current.live && now.synced && now.context.connected && now.context.control && now.context.core?.sessionsLive === true
        && now.context.core.modeLive && now.qualification !== undefined;
    }, eligible: source => {
      const now = current.current, core = now.context.core, copy = now.companion.current;
      if (!copy.live || core === undefined || speechState.current?.availability !== 'available') return false;
      const synced = now.synced && core.sessionsLive && core.modeLive;
      if (source.kind === 'reply') return replyRefusal({mode: core.mode, synced}) === undefined;
      return speechRefusal(source.card, {
        nowMs: Date.now(), settings: copy.state.settings, mode: core.mode, synced,
        sessions: core.sessions, scenarioAttention: false, available: copy.state.availability === 'available',
      }) === undefined;
    }, changed: next => {if (active) setLocal(next);}});
    session.current = value;
    return () => {active = false; session.current = undefined; void value.close();};
  }, [api]);
  useEffect(() => {session.current?.update();}, [context, state, live, synced, qualification, remote]);
  const ready = live && synced && connected && context.control && context.core?.sessionsLive === true && context.core.modeLive && qualification !== undefined && api.speech !== undefined;
  const selected = local.availability === 'available';
  const other = remote?.availability === 'available' && !selected && local.availability !== 'enabling';
  const playback = selected || local.playback !== null ? local.playback : remote?.playback;
  const operation = playback === undefined || playback === null ? undefined : context.operations.find(value => value.requestId === playback.operationId && value.family === 'companion-speech-play');
  const availabilityText = !ready ? 'Speech unavailable. A qualified Chrome browser, local English voice and current connection are required.'
    : other ? words.other
    : selected && remote?.availability === 'available' ? words.on
    : local.availability === 'enabling' ? 'Checking the qualified local voice.'
    : local.availability === 'unavailable' || remote?.availability === 'unavailable' ? 'Speech unavailable. Mute and enable again only after the endpoint is ready.' : words.off;
  if (compact) return <section aria-label={words.section} className="companion-speech-compact">
    <p className="companion-small">{words.scope}</p>
    <p role="status">{ready ? availabilityText : 'Speech unavailable.'}</p>
    {context.core?.mode === 'quiet' && <p>{words.quiet}</p>}
    <div className="actions">
      {selected || local.availability === 'enabling'
        ? <button type="button" onClick={() => {void session.current?.mute();}}>{words.mute}</button>
        : <button type="button" aria-label={words.enable} disabled={!ready || other || local.busy}
          onClick={() => {void session.current?.enable();}}>Enable in this tab</button>}
      <button type="button" disabled={!selected} onClick={() => {void session.current?.stop();}}>Stop speaking</button>
    </div>
    {playback != null && <p role="status">Playback: {playbackLabels[playback.status]}</p>}
    {operation !== undefined && <p>Tracked operation: {context.operationsLive ? operation.result ?? operation.status : 'unavailable'}.</p>}
    <details><summary>Voice requirements</summary>
      {!ready && <p>{availabilityText}</p>}
      <p>Enable declares availability for this connected tab. Text enablement does not enable speech. Reload, navigation or disconnect requires fresh enablement; missed {purpose} never replay on their own.</p>
      <p>Stop speaking stops audio only; it does not cancel a task or answer a question. Playback reports do not establish hearing.</p>
    </details>
  </section>;
  return <section aria-label={words.section}>
    <h3>{words.section}</h3>
    <p>Enable means "I am available for {purpose === 'alerts' ? 'spoken alerts' : 'spoken replies'}" in this tab. Mute before calls, meetings or media. Calls and other applications are not detected automatically.</p>
    <p>Speech starts off. Reloading, leaving this page or losing the connection requires a fresh enable action. Missed {purpose} are not replayed on their own.</p>
    <p role="status">{availabilityText}</p>
    {context.core?.mode === 'quiet' && <p>{words.quiet}</p>}
    <div className="actions">
      <button type="button" disabled={!ready || selected || other || local.busy} onClick={() => {void session.current?.enable();}}>{words.enable}</button>
      <button type="button" disabled={!selected && local.availability !== 'enabling'} onClick={() => {void session.current?.mute();}}>{words.mute}</button>
      <button type="button" disabled={!selected} onClick={() => {void session.current?.stop();}}>Stop speaking</button>
    </div>
    <p>Stop speaking only stops audio. It does not cancel a coding task or answer a question.</p>
    <p role="status">Playback: {playback === null || playback === undefined ? 'No playback reported.' : playbackLabels[playback.status]}</p>
    {operation !== undefined && <p>Tracked operation: {context.operationsLive ? operation.result ?? operation.status : 'unavailable'}.</p>}
    <p>Playback reports do not establish whether anyone heard the alert.</p>
  </section>;
}
