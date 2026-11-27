import {useEffect, useRef, useState} from 'react';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import {sendAction, type BrowserAction} from './actions.ts';

export type SaveReply<T> = {kind: 'accepted'; value: T} | {kind: 'refused'; code: ErrorCode} | {kind: 'uncertain'};
export type SaveState<A, T> = {kind: 'idle'} | ({input: A} & (SaveReply<T> | {kind: 'sending' | 'confirmed'}));
export type SaveEvent<A, T> = {kind: 'start'; input: A} | {kind: 'reply'; input: A; reply: SaveReply<T>} | {kind: 'confirm' | 'reset'};

export function advanceSave<A, T>(state: SaveState<A, T>, event: SaveEvent<A, T>): SaveState<A, T> {
  switch (event.kind) {
    case 'start': return state.kind === 'sending' ? state : {kind: 'sending', input: event.input};
    case 'reply': return state.kind === 'sending' && state.input === event.input ? {...event.reply, input: event.input} : state;
    case 'confirm': return state.kind === 'accepted' || state.kind === 'uncertain' ? {kind: 'confirmed', input: state.input} : state;
    case 'reset': return state.kind === 'sending' ? state : {kind: 'idle'};
  }
}

type SavePolicy<A> = {accepted?: (input: A) => boolean; uncertain: (input: A) => boolean};

export function saveBlocked<A, T>(state: SaveState<A, T>, policy: SavePolicy<A>): boolean {
  return state.kind === 'sending' ||
    (state.kind === 'accepted' && policy.accepted?.(state.input) === true) ||
    (state.kind === 'uncertain' && policy.uncertain(state.input));
}

/** A command reply is admission. Only the caller's owner evidence can confirm an effect. */
export async function sendSaveAction(action: BrowserAction): Promise<SaveReply<void>> {
  const reply = await sendAction(action);
  if (!('error' in reply)) return {kind: 'accepted', value: undefined};
  return reply.error.code === 'uncertain-result' ? {kind: 'uncertain'} : {kind: 'refused', code: reply.error.code};
}

/** Form-local lifecycle. Refresh and matching evidence can change state; only run sends. */
export function useSaveLifecycle<A, T = void>(policy: SavePolicy<A> & {
  confirm?: (state: Extract<SaveState<A, T>, {kind: 'accepted' | 'uncertain'}>) => boolean;
}) {
  const [stored, setStored] = useState<SaveState<A, T>>({kind: 'idle'});
  const current = useRef(stored), mounted = useRef(true);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const observed = (state: SaveState<A, T>): boolean =>
    (state.kind === 'accepted' || state.kind === 'uncertain') && policy.confirm?.(state) === true;
  const confirmed = observed(stored);
  const state = confirmed ? advanceSave(stored, {kind: 'confirm'}) : stored;
  useEffect(() => {
    if (confirmed && current.current === stored) {
      current.current = advanceSave(stored, {kind: 'confirm'});
      setStored(current.current);
    }
  }, [confirmed, stored]);

  const update = (event: SaveEvent<A, T>): void => {
    current.current = advanceSave(current.current, event);
    setStored(current.current);
  };
  return {
    state,
    blocked: saveBlocked(state, policy),
    reset: (): void => {update({kind: 'reset'});},
    run: async (input: A, send: () => Promise<SaveReply<T>>): Promise<SaveReply<T> | undefined> => {
      if (!mounted.current || (!observed(current.current) && saveBlocked(current.current, policy))) return undefined;
      update({kind: 'start', input});
      let reply: SaveReply<T>;
      try { reply = await send(); }
      catch { reply = {kind: 'uncertain'}; }
      if (!mounted.current) return undefined;
      update({kind: 'reply', input, reply});
      return reply;
    },
  };
}
