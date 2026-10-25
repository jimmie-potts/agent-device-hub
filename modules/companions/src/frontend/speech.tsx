import React, {useEffect, useRef, useState} from 'react';
import type {CompanionState, SpeechState} from '@jimmie-potts/event-contracts/v2/companions';
import type {FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {SyncedCopy} from '@jimmie-potts/sdk/remote';
import {speechRefusal} from '../presentation-policy.js';
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

export function SpeechControls({context, state, live}: {context: FrontendContext; state: CompanionState | undefined; live: boolean}): React.JSX.Element {
  const [local, setLocal] = useState(initial);
  const [remote, setRemote] = useState<SpeechState>();
  const [synced, setSynced] = useState(false);
  const [qualification, setQualification] = useState<SpeechQualification>();
  const [replacement, setReplacement] = useState(0);
  const session = useRef<SpeechSession | undefined>(undefined);
  const current = useRef({context, state, live, synced, qualification, remote});
  current.current = {context, state, live, synced, qualification, remote};
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
    setSynced(false);
    if (!connected || api.speech === undefined) return;
    let active = true, replacing = false;
    let copy: SyncedCopy<SpeechState> | undefined;
    const show = (): void => {
      const value = copy?.states().find(message => message.data.id === 'reachy')?.data;
      setRemote(value); setSynced(value !== undefined);
    };
    void api.sync<SpeechState>(['companion-speech-state'], change => {
      if (!active) return;
      if (change.type === 'updated') setRemote(change.message.data);
      else if (change.type === 'failed' || change.type === 'removed') {replacing = true; setSynced(false);}
      else if (change.type === 'synced') {replacing = false; if (copy !== undefined) show();}
    }, {onRestarted: () => {if (active) {replacing = true; setSynced(false); setReplacement(value => value + 1);}}}).then(result => {
      if (result.status !== 'synced') return;
      if (!active) {void result.copy.close(); return;}
      copy = result.copy; if (!replacing) show();
    }).catch(() => {if (active) setSynced(false);});
    return () => {active = false; void copy?.close();};
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
      return now.live && now.synced && now.context.connected && now.context.control && now.context.core?.sessionsLive === true
        && now.context.core.modeLive && now.qualification !== undefined;
    }, eligible: card => {
      const now = current.current, core = now.context.core;
      return now.state !== undefined && core !== undefined && now.remote?.availability === 'available' && speechRefusal(card, {
        nowMs: Date.now(), settings: now.state.settings, mode: core.mode, synced: now.live && now.synced && core.sessionsLive && core.modeLive,
        sessions: core.sessions, scenarioAttention: false, available: now.state.availability === 'available',
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
  return <section aria-label="Spoken alerts">
    <h3>Spoken alerts</h3>
    <p>Enable means "I am available for spoken alerts" in this tab. Mute before calls, meetings or media. Calls and other applications are not detected automatically.</p>
    <p>Speech starts off. Reloading, leaving this page or losing the connection requires a fresh enable action. Missed alerts are not replayed.</p>
    <p role="status">{!ready ? 'Speech unavailable. A qualified Chrome browser, local English voice and current connection are required.'
      : other ? 'Another tab has spoken alerts enabled.'
      : selected && remote?.availability === 'available' ? 'Spoken alerts enabled in this tab.'
      : local.availability === 'enabling' ? 'Checking the qualified local voice.'
      : local.availability === 'unavailable' || remote?.availability === 'unavailable' ? 'Speech unavailable. Mute and enable again only after the endpoint is ready.' : 'Spoken alerts are off in this tab.'}</p>
    {context.core?.mode === 'quiet' && <p>Quiet mode suppresses new spoken alerts.</p>}
    <div className="actions">
      <button type="button" disabled={!ready || selected || other || local.busy} onClick={() => {void session.current?.enable();}}>Enable spoken alerts in this tab</button>
      <button type="button" disabled={!selected && local.availability !== 'enabling'} onClick={() => {void session.current?.mute();}}>Mute spoken alerts</button>
      <button type="button" disabled={!selected} onClick={() => {void session.current?.stop();}}>Stop speaking</button>
    </div>
    <p>Stop speaking only stops audio. It does not cancel a coding task or answer a question.</p>
    <p role="status">Playback: {playback === null || playback === undefined ? 'No playback reported.' : playbackLabels[playback.status]}</p>
    {operation !== undefined && <p>Tracked operation: {context.operationsLive ? operation.result ?? operation.status : 'unavailable'}.</p>}
    <p>Playback reports do not establish whether anyone heard the alert.</p>
  </section>;
}
