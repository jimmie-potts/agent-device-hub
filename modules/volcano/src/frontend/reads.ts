import {useEffect, useState} from 'react';
import type {FrontendApi, FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {SyncedCopy} from '@jimmie-potts/sdk/remote';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import type {VolcanoStatus} from '../status-document.js';
import {messageStatus, Refused, refusal} from './documents.js';

const FAMILY = 'volcano-status';
export const CONTENT = '/modules/volcano/content/';
/** A history read follows a new revision at most this often, since a running heater moves the revision every few seconds. */
export const READ_SPACING_MS = 30_000;

export type StatusView = {target: string | undefined; api: FrontendApi; doc: VolcanoStatus | undefined; live: boolean; error: ErrorCode | undefined};

/** The owner's retained state over the shell's participant. Nothing here reads on a timer or reaches a device. */
export function useVolcanoStatus(context: FrontendContext, attempt: number, target?: string): StatusView | undefined {
  const [view, setView] = useState<StatusView | undefined>();
  useEffect(() => {
    let stopped = false, copy: SyncedCopy<VolcanoStatus> | undefined, doc: VolcanoStatus | undefined, live = false, error: ErrorCode | undefined;
    let expectedId = target;
    const publish = (): void => { if (!stopped) setView({api: context.api, target, doc, live, error}); };
    const fail = (failure: unknown): void => { if (stopped) return; live = false; error = refusal(failure); publish(); };
    const accept = (next: VolcanoStatus): void => {
      if (stopped || (doc !== undefined && next.revision < doc.revision)) return;
      expectedId = next.id; doc = next; error = undefined; publish();
    };
    const close = (): void => { if (copy !== undefined) void copy.close().catch(() => {}); };
    publish();
    if (!context.connected || context.module !== 'volcano') return () => { stopped = true; close(); };
    void context.api.sync<VolcanoStatus>([FAMILY], change => {
      if (stopped) return;
      try {
        switch (change.type) {
          case 'updated':
            if (change.entity.family !== FAMILY) throw new Refused('invalid-message');
            accept(messageStatus(change.message, expectedId));
            if (!live) { live = true; publish(); }
            break;
          case 'synced': live = true; publish(); break;
          case 'failed': fail({body: change.error}); break;
          case 'removed':
            if (change.entity.family !== FAMILY) break;
            stopped = true;
            setView({api: context.api, target, doc: undefined, live: false, error: 'not-found'});
            close();
            break;
        }
      } catch (failure) { fail(failure); }
    }).then(async result => {
      if (result.status === 'rejected') { fail({body: result.error}); return; }
      if (stopped) { await result.copy.close(); return; }
      copy = result.copy;
      const states = copy.states(), first = target === undefined ? states[0] : states.find(state => state.subject === target);
      if (first !== undefined) accept(messageStatus(first, expectedId));
      live = first !== undefined;
      if (first === undefined) error = 'not-found';
      publish();
    }).catch(fail);
    return () => { stopped = true; close(); };
  }, [context.api, context.connected, context.module, attempt, target]);
  return view?.api === context.api && view.target === target ? view : undefined;
}

export type ReadView<T> = {api: FrontendApi; decode: (value: unknown) => T; path: string; refresh: string; value: T | undefined; error: ErrorCode | undefined};
/** One authenticated read per path and refresh key. The last answer stays on screen until its replacement arrives. */
export function useRead<T>(api: FrontendApi | undefined, path: string | undefined, refresh: string, decode: (value: unknown) => T): ReadView<T> | undefined {
  const [view, setView] = useState<ReadView<T> | undefined>();
  useEffect(() => {
    if (api === undefined || path === undefined) { setView(undefined); return; }
    let stopped = false;
    setView(previous => ({api, decode, path, refresh, value: previous?.api === api && previous.decode === decode && previous.path === path ? previous.value : undefined, error: undefined}));
    void api.read(path).then(input => {
      const value = decode(input);
      if (!stopped) setView({api, decode, path, refresh, value, error: undefined});
    }).catch((error: unknown) => {
      if (!stopped) setView({api, decode, path, refresh, value: undefined, error: refusal(error)});
    });
    return () => { stopped = true; };
  }, [api, path, refresh, decode]);
  return view !== undefined && view.api === api && view.decode === decode && view.path === path ? view : undefined;
}

/** The key history reads follow. A threshold, a reload or the first revision moves it at once, and any later revision at most once per spacing. */
export function useReadKey(revision: number | undefined, immediate: string): string {
  const [settled, setSettled] = useState({revision, immediate, at: 0});
  const now = settled.immediate !== immediate || settled.revision === undefined;
  // Adjusted during the render, so a read never goes out under the key this replaces.
  if (now && (settled.immediate !== immediate || settled.revision !== revision)) setSettled({revision, immediate, at: Date.now()});
  useEffect(() => {
    if (settled.revision === revision) return;
    const timer = window.setTimeout(() => { setSettled({revision, immediate, at: Date.now()}); }, Math.max(0, settled.at + READ_SPACING_MS - Date.now()));
    return () => { window.clearTimeout(timer); };
  }, [revision, immediate, settled]);
  return now ? `${immediate}:${String(revision)}` : `${settled.immediate}:${String(settled.revision)}`;
}
