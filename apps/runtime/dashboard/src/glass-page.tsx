import React, {useEffect, useState} from 'react';
import {GlassLayer, type GlassState} from './glass-layer.tsx';

/**
 * The shared glass layer (#1929) on a page other than Home (Hub #1950): the Devices directory, the Companions overview
 * and the display pages. It draws the Quiet glass wash with no artwork and keeps panels apart; Home alone has the
 * backdrop, the fusing and the first appearance, so a page change costs one frame. The caller puts `glass` on its root as `data-glass` and renders `layer` inside it. The
 * layer stays mounted while the page moves between such pages, and a page that leaves them starts quiet next time.
 */

export function useGlassPage(enabled: boolean): {glass: GlassState | undefined; layer: React.ReactNode} {
  const [glass, setGlass] = useState<GlassState>('quiet');
  useEffect(() => { if (!enabled) setGlass('quiet'); }, [enabled]);
  return {glass: enabled ? glass : undefined, layer: enabled ? <GlassLayer onState={setGlass} backdrop={null} appear={false}/> : null};
}
