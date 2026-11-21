// Whether the glass on screen follows the marked boxes (#1965): the boxes a frame last drew, against the boxes now,
// both as far as they can be seen. Shared by the glass journeys; unit-tested with a negative control in glass-boxes.test.ts.

/** How far past the window a panel still draws: its shadow and lip (glass-scene.ts). */
export const REACH = 64;
export type LiveBox = {id: string; x: number; y: number; width: number; height: number};

/** A box cut to the window and the reach, as `visibleScene` cuts it. */
export function cut(box: LiveBox, viewport: {width: number; height: number}): LiveBox {
  const x = Math.max(box.x, -REACH), y = Math.max(box.y, -REACH);
  return {id: box.id, x, y, width: Math.max(0, Math.min(box.x + box.width, viewport.width + REACH) - x), height: Math.max(0, Math.min(box.y + box.height, viewport.height + REACH) - y)};
}

/**
 * What differs between the drawn boxes (`data-glass-drawn`: `id:x,y,width,height` joined by `|`) and the live boxes in
 * or near the window, each cut as the layer cuts it. Empty when the glass on screen follows every box: a visible change
 * that was never drawn leaves a stale drawn box, which is reported here.
 */
export function drawnMismatches(drawn: string, live: readonly LiveBox[], viewport: {width: number; height: number}, tolerance = 0.6): string[] {
  const parse = (entry: string): [string, number[]] => {const at = entry.lastIndexOf(':');return [entry.slice(0, at), entry.slice(at + 1).split(',').map(Number)];};
  const shown = new Map(drawn.split('|').filter(entry => entry !== '').map(parse)), problems: string[] = [];
  if (shown.size !== live.length) problems.push(`${String(shown.size)} drawn panels for ${String(live.length)} boxes in view`);
  for (const box of live.map(item => cut(item, viewport))) {
    const glass = shown.get(box.id), want = [box.x, box.y, box.width, box.height];
    if (glass === undefined) {problems.push(`${box.id} has no glass`);continue;}
    if (glass.some((value, index) => Math.abs(value - (want[index] ?? 0)) > tolerance)) problems.push(`${box.id} glass ${glass.join(',')} does not follow its box ${want.map(value => value.toFixed(1)).join(',')}`);
  }
  return problems;
}
