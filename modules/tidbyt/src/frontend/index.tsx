import React, {useEffect, useRef, useState} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {FrontendContext, FrontendContribution} from '@jimmie-potts/sdk/frontend';
import {TidbytCard} from './card.js';
import {followTidbyt, type TidbytView} from './records.js';
export {TidbytCard, type TidbytCardProps} from './card.js';

/** Reuse the shell's authenticated owner scope on each supported surface. */
export function TidbytDisplay({context}: {context: FrontendContext}): React.JSX.Element {
  const [view, setView] = useState<TidbytView>({device: undefined, live: false, pending: true, error: undefined});
  const saved = useRef(view.device);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!context.connected) { setView(previous => ({...previous, live: false, pending: false})); return; }
    return followTidbyt(changed => context.api.sync<DeviceRecord>(['device'], changed), saved.current, next => { saved.current = next.device; setView(next); });
  }, [context.api, context.connected, attempt]);
  return <TidbytCard view={view} connected={context.connected} retry={() => { setAttempt(value => value + 1); }}/>;
}

export const frontend: FrontendContribution = {module: 'tidbyt', pages: [{id: 'display', Component: TidbytDisplay}]};
