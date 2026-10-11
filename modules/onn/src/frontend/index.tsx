import React, {useEffect, useId, useState} from 'react';
import type {FrontendCommand, FrontendContext, FrontendContribution} from '@jimmie-potts/sdk/frontend';
import type {SyncedCopy} from '@jimmie-potts/sdk/remote';
import type {OnnState} from '../contracts.js';
const keys = [{value: 'up', label: 'Up', position: '1 / 2'}, {value: 'left', label: 'Left', position: '2 / 1'}, {value: 'select', label: 'Select', position: '2 / 2'}, {value: 'right', label: 'Right', position: '2 / 3'}, {value: 'down', label: 'Down', position: '3 / 2'}, {value: 'back', label: 'Back', position: '4 / 1'}, {value: 'home', label: 'Home', position: '4 / 2'}, {value: 'play-pause', label: 'Play / pause', position: '4 / 3'}];
function Controls({context, state, live, command, now}: {context: FrontendContext; state: OnnState; live: boolean; command: FrontendCommand; now: number}): React.JSX.Element {
  const [text, setText] = useState(''); const textId = useId();
  const enabled = context.control && context.connected && context.operationsLive && live && state.connection === 'available' && !command.locked;
  const send = (family: string, data: object): void => {
    if (!enabled) return;
    void command.run({family, target: state.id, requestId: crypto.randomUUID(), data: {expectedConfigurationRevision: state.configurationRevision, expectedGeneration: state.generation, ...data}});
  };
  const app = state.currentApp.status === 'known' && now - state.currentApp.observedAtMs <= 15_000 ? state.currentApp.value : 'unknown';
  const validText = /^[A-Za-z0-9 ._-]{1,256}$/.test(text);
  return <section aria-label="ONN controls">
    <h2>ONN remote</h2>
    <p>Connection: {context.connected && live ? state.connection : 'unknown'} · Current app: {live ? app : 'unknown'}</p>
    {!context.control && <p>Read-only access. Control access is required to use the remote.</p>}
    {!live && <p role="status">ONN status is stale. Reload status before using the remote.</p>}
    <div role="group" aria-label="Navigation and playback" style={{display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '.5rem', maxWidth: '24rem'}}>
      {keys.map(key => <button key={key.value} style={{gridArea: key.position}} disabled={!enabled} onClick={() => {send('onn-key-press', {key: key.value});}}>{key.label}</button>)}
    </div>
    <p>To seek, focus the timeline on the TV, then use Left or Right. YouTube needs a separate Select to apply the step; Stremio applies it while paused.</p>
    <div role="group" aria-label="App shortcuts">
      <button disabled={!enabled} onClick={() => {send('onn-app-open', {app: 'youtube'});}}>Open YouTube</button>{' '}
      <button disabled={!enabled} onClick={() => {send('onn-app-open', {app: 'stremio'});}}>Open Stremio</button>
    </div>
    <form autoComplete="off" onSubmit={event => {event.preventDefault(); if (!enabled || !validText) return; const input = text; setText(''); send('onn-text', {text: input});}}>
      <p id={`${textId}-help`}>Focus a text field on the TV first. Text entry uses letters, digits, spaces, dots, underscores and hyphens, up to 256 characters. It does not submit the TV search.</p>
      <label htmlFor={textId}>Focused text</label>{' '}
      <input id={textId} aria-describedby={`${textId}-help`} type="text" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} maxLength={256} value={text} disabled={!context.control} onChange={event => {setText(event.target.value);}}/>{' '}
      <button type="submit" disabled={!enabled || !validText}>Insert text</button>
      {text.length > 0 && !validText && <p role="status">This input contains unsupported characters.</p>}
    </form>
    <p role="status" aria-live="polite">{command.text}</p>
    <p>Command results report transmission. Check the TV for the visible effect. Power and volume are not available.</p>
  </section>;
}
function Page({context}: {context: FrontendContext}): React.JSX.Element {
  const [state, setState] = useState<OnnState>(), [live, setLive] = useState(false), [attempt, setAttempt] = useState(0), [now, setNow] = useState(Date.now);
  useEffect(() => {const timer = window.setInterval(() => {setNow(Date.now());}, 1000); return () => {window.clearInterval(timer);};}, []);
  useEffect(() => {
    let stopped = false, copy: SyncedCopy<OnnState> | undefined, latest: OnnState | undefined;
    setLive(false); setState(undefined);
    const accept = (value: OnnState): void => {
      if (stopped || latest !== undefined && value.revision < latest.revision) return;
      if (latest !== undefined && value.revision === latest.revision && JSON.stringify(value) !== JSON.stringify(latest)) {setLive(false); return;}
      if (latest !== undefined && value.id !== latest.id) {setLive(false); return;}
      latest = value; setState(value);
    };
    if (!context.connected) return () => {stopped = true;};
    void context.api.sync<OnnState>(['onn-state'], change => {
      if (stopped) return;
      if (change.type === 'updated') accept(change.message.data);
      else if (change.type === 'synced') setLive(true);
      else if (change.type === 'failed') setLive(false);
      else if (change.type === 'removed') {setState(undefined); setLive(false);}
    }).then(result => {
      if (result.status !== 'synced') {if (!stopped) setLive(false); return;}
      if (stopped) {void result.copy.close().catch(() => {}); return;}
      copy = result.copy;
      for (const value of copy.states()) accept(value.data);
      setLive(true);
    }).catch(() => {if (!stopped) setLive(false);});
    return () => {stopped = true; void copy?.close().catch(() => {});};
  }, [context.api, context.connected, attempt]);
  const Command = context.ui.Command;
  return <>{state === undefined ? <p role="status">ONN status is unknown.</p> : <Command context={context} target={state.id}>{command => <Controls context={context} state={state} live={live} command={command} now={now}/>}</Command>}
    <button onClick={() => {setAttempt(value => value + 1);}}>Reload status</button>
  </>;
}
export const frontend: FrontendContribution = {module: 'onn', pages: [{id: 'controls', Component: Page}]};
