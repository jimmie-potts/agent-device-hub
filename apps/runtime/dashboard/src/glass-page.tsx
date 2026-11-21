import React, {useEffect, useState} from 'react';
import {GlassLayer, type GlassState} from './glass-layer.tsx';

/**
 * The shared glass layer (#1929) on a page other than Home (Hub #1950): the Devices directory, the Companions overview
 * and the display pages. It draws the Quiet glass wash with no artwork and keeps panels apart; Home alone has the
 * backdrop and the fusing. The caller puts `glass` on its root as `data-glass` and renders `layer` inside it. The
 * layer stays mounted while the page moves between such pages, and a page that leaves them starts quiet next time.
 */
/**
 * Without a GPU a frame holds the page's main thread for as long as it draws, so these pages, with only the smooth
 * wash behind them, draw at most a quarter of Home's pixels there and skip the 700 ms first appearance: a page change
 * costs one cheap frame, not a run of full ones. With a GPU they draw every pixel (#1950).
 */
const PAGE_SOFTWARE_PIXELS = 250_000;

export function useGlassPage(enabled: boolean): {glass: GlassState | undefined; layer: React.ReactNode} {
  const [glass, setGlass] = useState<GlassState>('quiet');
  useEffect(() => { if (!enabled) setGlass('quiet'); }, [enabled]);
  return {glass: enabled ? glass : undefined, layer: enabled ? <GlassLayer onState={setGlass} backdrop={null} softwarePixels={PAGE_SOFTWARE_PIXELS} appear={false}/> : null};
}
