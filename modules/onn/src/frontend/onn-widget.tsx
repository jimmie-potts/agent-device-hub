import React, {useEffect, useState} from 'react';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {SyncedCopy} from '@jimmie-potts/sdk/remote';
import type {OnnState} from '../contracts.js';
import {OnnCard} from './onn-card.js';
import {onnAction, onnAppLabel, onnAvailability, onnFamilies, onnFeedback, onnRecordOrder, type OnnIntent} from './onn-card-data.js';

type View = {api: FrontendContext['api']; target: string | undefined; connected: boolean; state: OnnState | undefined; live: boolean};
function useOnnStatus(context: FrontendContext, target: string | undefined, attempt: number): View | undefined {
  const [view, setView] = useState<View>();
  useEffect(() => {
    let stopped = false, current: OnnState | undefined, live = false, conflict = false;
    let copy: SyncedCopy<OnnState> | undefined;
    const publish = (): void => {if (!stopped) setView({api: context.api, target, connected: context.connected, state: current, live: live && !conflict});};
    const accept = (next: OnnState): void => {
      const order = onnRecordOrder(current, next, target);
      if (order === 'conflict') {conflict = true; live = false;}
      else if (order === 'accept') current = next;
      publish();
    };
    publish();
    if (!context.connected || context.module !== 'onn') return () => {stopped = true;};
    void context.api.sync<OnnState>(['onn-state'], change => {
      if (stopped) return;
      if (change.type === 'updated') accept(change.message.data);
      else if (change.type === 'synced') {live = true; publish();}
      else if (change.type === 'failed') {live = false; publish();}
      else if (change.type === 'removed') {current = undefined; live = false; publish();}
    }).then(result => {
      if (stopped) {if (result.status === 'synced') void result.copy.close().catch(() => {}); return;}
      if (result.status !== 'synced') {live = false; publish(); return;}
      copy = result.copy;
      for (const value of copy.states()) accept(value.data);
      live = true; publish();
    }).catch(() => {live = false; publish();});
    return () => {stopped = true; void copy?.close().catch(() => {});};
  }, [context.api, context.module, context.connected, target, attempt]);
  return view;
}

export type OnnWidgetProps = {context: FrontendContext; expectedTarget?: string | undefined; label?: string | undefined};
/** One module scope on the shell's existing participant, shared with the full controls page. */
export function OnnWidget({context, expectedTarget, label}: OnnWidgetProps): React.JSX.Element {
  const [attempt, setAttempt] = useState(0), [now, setNow] = useState(Date.now);
  useEffect(() => {const timer = window.setInterval(() => {setNow(Date.now());}, 1000); return () => {window.clearInterval(timer);};}, []);
  const view = useOnnStatus(context, expectedTarget, attempt);
  const current = view?.api === context.api && view.target === expectedTarget && view.connected === context.connected ? view : undefined;
  const state = current?.state;
  const live = context.module === 'onn' && current?.live === true;
  const availability = onnAvailability(state, context.connected, live, expectedTarget);
  const id = expectedTarget ?? state?.id ?? 'onn';
  const reload = (): void => {setAttempt(value => value + 1);};
  const render = (command?: FrontendCommand): React.JSX.Element => {
    const dispatch = (intent: OnnIntent): void => {
      if (command === undefined) return;
      const action = onnAction(state, context, live, command.locked, intent, crypto.randomUUID(), expectedTarget);
      if (action !== undefined) void command.run(action);
    };
    return <OnnCard id={id} label={label} availability={availability} app={onnAppLabel(state, live && context.connected, now)}
      readOnly={!context.control} disabled={!context.control || !context.connected || !context.operationsLive || !live || availability !== 'available' || command?.locked === true}
      controls={state?.controls} feedback={command === undefined ? {label: '', detail: '', attention: false} : onnFeedback(command, context.operations, id)}
      onKey={value => {dispatch({kind: 'key', value});}} onApp={value => {dispatch({kind: 'app', value});}}
      onText={value => {dispatch({kind: 'text', value});}} onReload={reload}/>;
  };
  if (state === undefined || expectedTarget !== undefined && state.id !== expectedTarget) return render();
  const Command = context.ui.Command;
  const scope = {...context, operations: context.operations.filter(operation => onnFamilies.some(family => family === operation.family))};
  return <Command context={scope} target={state.id}>{command => render(command)}</Command>;
}
