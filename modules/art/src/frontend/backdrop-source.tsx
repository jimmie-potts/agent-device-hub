import React, {useEffect, useState} from 'react';
import type {FrontendContext} from '@jimmie-potts/sdk/frontend';
import {backdropLoader, NO_BACKDROP, type BackdropLoader} from './backdrop.js';
import {useArt, useBrowserArt, useWidgetArtwork} from './hooks.js';
import {useArtBackdrop, usePublishArtBackdrop} from './presentation.js';

/**
 * Follows the art record and selection as the Art widget does and decodes the selected composition's largest still
 * for the shell's Home backdrop. It renders nothing visible; its hidden element states what the shell received.
 */
export function ArtBackdropSource({context}: {context: FrontendContext}): React.JSX.Element {
  const catalog = useArt(context.api, context.connected), selected = useWidgetArtwork(context.api, catalog.state, catalog.live);
  const art = useBrowserArt(selected.status === 'ready' ? selected.artwork : undefined, false);
  const publish = usePublishArtBackdrop(), backdrop = useArtBackdrop();
  const [loader, setLoader] = useState<BackdropLoader>();
  useEffect(() => {
    const next = backdropLoader(context.api, publish);setLoader(next);
    return () => {publish(NO_BACKDROP);next.dispose();};
  }, [context.api, publish]);
  useEffect(() => {
    if (!catalog.live) loader?.want({status: 'stale'});
    else if (selected.status !== 'ready') loader?.want({status: selected.status});
    else loader?.want(art === undefined ? {status: 'none'} : {status: 'select', art});
  }, [loader, catalog.live, selected.status, art]);
  // Consumers upload a new image in a layout effect, so a replaced bitmap may close once this commit's effects run.
  useEffect(() => {loader?.committed(backdrop.image);}, [loader, backdrop.image]);
  return <span hidden data-art-backdrop={backdrop.status} data-artwork={backdrop.image?.artworkId ?? ''}
    data-composition={backdrop.image?.compositionId ?? ''} data-rendition={backdrop.image?.renditionId ?? ''}/>;
}
