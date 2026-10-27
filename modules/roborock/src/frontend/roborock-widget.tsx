import React, {useEffect, useMemo, useState} from 'react';
import type {FrontendContext} from '@jimmie-potts/sdk/frontend';
import {latestRunDocument} from './documents.js';
import {useRead, useStatus} from './reads.js';
import {roborockCardData} from './card-data.js';
import {RoborockCard} from './roborock-card.js';

export function useRoborockCard(context: FrontendContext, expectedTarget?: string): {
  view: ReturnType<typeof useStatus>; now: number; attempt: number; reload: () => void;
  data: ReturnType<typeof roborockCardData>;
} {
  const [attempt, setAttempt] = useState(0), [now, setNow] = useState(Date.now);
  const view = useStatus(context, attempt, expectedTarget);
  const doc = view?.doc;
  const revision = doc?.revision;
  const id = doc?.id;
  // No timer reads. A new authoritative revision retires the prior run response.
  const decode = useMemo(() => (value: unknown) => {
    return latestRunDocument(value, id ?? expectedTarget ?? 'roborock', revision ?? 0);
  }, [id, revision, expectedTarget]);
  const path = '/modules/roborock/content/latest-run';
  const readable = context.connected && context.module === 'roborock' && doc !== undefined;
  const runs = useRead(readable ? context.api : undefined, path, attempt, decode);
  useEffect(() => {const timer = window.setInterval(() => {setNow(Date.now());}, 1000); return () => {window.clearInterval(timer);};}, []);
  return {view, now, attempt, reload: () => {setAttempt(value => value + 1);},
    data: roborockCardData({doc, live: context.connected && view?.live === true, error: view?.error, now,
      runs: runs?.value, runsError: runs?.error})};
}

export type RoborockWidgetProps = {context: FrontendContext; expectedTarget?: string | undefined; label?: string | undefined};
/** Scoped reads on the shell participant. No device command or direct transport surface. */
export function RoborockWidget({context, expectedTarget, label}: RoborockWidgetProps): React.JSX.Element {
  const state = useRoborockCard(context, expectedTarget);
  return <RoborockCard id={expectedTarget ?? state.view?.doc?.id ?? 'roborock'} label={label} data={state.data} onReload={state.reload}/>;
}
