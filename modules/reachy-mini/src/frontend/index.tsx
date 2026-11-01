import './reachy.css';
import React, {useEffect, useState} from 'react';
import type {FrontendContext, FrontendContribution, FrontendCommand} from '@jimmie-potts/sdk/frontend';
import type {SyncedCopy} from '@jimmie-potts/sdk/remote';
import type {ReachyState} from '../contracts.js';
function Page({context}: {context: FrontendContext}): React.JSX.Element {
  const [view, setView] = useState<{api: FrontendContext['api']; state?: ReachyState; live: boolean}>();
  const [recoveryFor, setRecoveryFor] = useState<string>();
  useEffect(() => {
    let closed = false, current: ReachyState | undefined, copy: SyncedCopy<ReachyState> | undefined, live = false;
    const show = (): void => {if (!closed) setView({api: context.api, ...(current === undefined ? {} : {state: current}), live});};
    show();
    if (context.connected) void context.api.sync<ReachyState>(['reachy-state'], change => {
      if (closed) return;
      if (change.type === 'updated') {if (current === undefined || change.message.data.revision > current.revision) current = change.message.data;}
      else if (change.type === 'synced') live = true;
      else if (change.type === 'failed' || change.type === 'removed') {live = false; current = undefined;}
      show();
    }, {onRestarted: () => {live = false; current = undefined; show();}}).then(result => {
      if (result.status !== 'synced') return;
      if (closed) {void result.copy.close(); return;}
      copy = result.copy; current = copy.states()[0]?.data; live = true; show();
    }).catch(() => {live = false; show();});
    return () => {closed = true; void copy?.close();};
  }, [context.api, context.connected]);
  const state = view?.api === context.api && context.connected && view.live ? view.state : undefined;
  const recovered = state?.held !== null && state?.held !== undefined && recoveryFor === JSON.stringify([state.id,state.held.requestId,state.generation]);
  const Command = context.ui.Command;
  const send = (command: FrontendCommand, family: string, data: object): void => {
    if (state === undefined || !context.control || !context.operationsLive) return;
    setRecoveryFor(undefined);
    void command.run({family, target: state.id, requestId: crypto.randomUUID(), data: {...data,
      expectedConfigurationRevision: state.configurationRevision, expectedGeneration: state.generation,
      ...(state.held !== null && recovered ? {recovered: true, heldRequestId: state.held.requestId} : {})}});
  };
  const disabled = state === undefined || !context.control || !context.operationsLive || state.connection !== 'available';
  return <section className="reachy-panel" aria-label="Reachy robot controls">
    <h2>Reachy robot</h2>
    <p>Simulation · bounded antenna gestures</p>
    <p role="status">{state === undefined ? 'State unavailable' : state.connection === 'available' ? 'Simulator available' : 'Simulator ' + state.connection}</p>
    <p>Task cancellation leaves the last target active. Physical stopping is unqualified.</p>
    {state !== undefined && <>
      <p>{state.takeover ? 'Manual takeover' : 'Automatic expression ' + (state.enabled ? 'enabled' : 'disabled')}</p>
      <p>Simulated antennas: {state.observation === null ? 'Unknown' : state.observation.antennas.map(value => value.toFixed(2)).join(' / ') + ' rad'}</p>
      <p>{state.active === null ? 'No active task' : 'Active ' + state.active.gesture + ' task'}</p>
      {state.held !== null && <p>Movement result uncertain. Automatic expression is held.</p>}
      {state.held !== null && <label><input type="checkbox" checked={recovered} onChange={event => {setRecoveryFor(event.target.checked ? JSON.stringify([state.id,state.held?.requestId,state.generation]) : undefined);}}/>I restored vendor/manual ownership for this held operation</label>}
      <Command context={context} target={state.id}>{command => <div className="reachy-actions">
        <button disabled={!context.control || !context.connected || !context.operationsLive || command.locked} onClick={() => {send(command, 'reachy-control', {action: 'takeover'});}}>Take over</button>
        {(['notice', 'attention', 'neutral'] as const).map(gesture => <button key={gesture} disabled={disabled || !state.takeover || state.active !== null || command.locked || state.held !== null && !recovered}
          onClick={() => {send(command, 'reachy-gesture', {gesture});}}>{gesture === 'neutral' ? 'Neutral pose' : gesture === 'notice' ? 'Notice gesture' : 'Attention gesture'}</button>)}
        <button disabled={disabled || state.takeover || command.locked || state.held !== null} onClick={() => {send(command, 'reachy-control', {action: 'enable-auto'});}}>Enable automatic expression</button>
        <button disabled={disabled || command.locked || state.held !== null} onClick={() => {send(command, 'reachy-control', {action: 'resume-auto'});}}>Resume automatic expression</button>
        <button disabled={!context.control || !context.connected || !context.operationsLive || command.locked} onClick={() => {send(command, 'reachy-control', {action: 'disable-auto'});}}>Disable automatic expression</button>
        <p className="reachy-feedback" role="status">{command.text}</p>
      </div>}</Command>
      <Command context={context} target={state.id} attemptKey={`module:reachy-mini:stop:${state.id}`}>{command => <div className="reachy-actions">
        <button disabled={!context.control || !context.connected || !context.operationsLive || command.locked || state.held !== null && (!recovered || state.held.moveId === null)}
          onClick={() => {send(command, 'reachy-stop', {});}}>Stop task</button>
        <p className="reachy-feedback" role="status">{command.text}</p>
      </div>}</Command>
    </>}
  </section>;
}
export const frontend: FrontendContribution = {module: 'reachy-mini', pages: [{id: 'controls', Component: Page}]};
