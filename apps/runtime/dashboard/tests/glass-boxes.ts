// Whether the glass on screen follows the marked boxes (#1965): the boxes a frame last drew, against the boxes now,
// both as far as they can be seen. Shared by the glass journeys; unit-tested with a negative control in glass-boxes.test.ts.

/** How far past the window a panel still draws: its shadow and lip (glass-scene.ts). */
export const REACH = 64;
export type LiveBox = {id: string; x: number; y: number; width: number; height: number};

/** A box cut to the window and a reach past it, as `visibleScene` cuts it. */
export function cut(box: LiveBox, viewport: {width: number; height: number}, reach = REACH): LiveBox {
  const x = Math.max(box.x, -reach), y = Math.max(box.y, -reach);
  return {id: box.id, x, y, width: Math.max(0, Math.min(box.x + box.width, viewport.width + reach) - x), height: Math.max(0, Math.min(box.y + box.height, viewport.height + reach) - y)};
}

/**
 * What differs between the drawn boxes (`data-glass-drawn`: `id:x,y,width,height` joined by `|`, in the glass canvas's
 * coordinates and as far as it paints) and the live boxes, each cut to the window. `canvas` is where the glass
 * canvas's top left corner is in the window now (#2023): it scrolls with the page, so a drawn box is on screen at its
 * place in the canvas plus that. Empty when the glass on screen follows every box: a visible change that was never
 * drawn leaves a stale drawn box, which is reported here.
 */
export function drawnMismatches(drawn: string, live: readonly LiveBox[], viewport: {width: number; height: number}, canvas: {x: number; y: number} = {x: 0, y: 0}, tolerance = 0.6): string[] {
  const parse = (entry: string): [string, number[]] => {const at = entry.lastIndexOf(':');return [entry.slice(0, at), entry.slice(at + 1).split(',').map(Number)];};
  // Both sides are cut to the window itself, which is what is on screen: the drawn boxes reach only as far as the
  // canvas paints (#2023), and its margin holds boxes beyond the window.
  const seen = (box: LiveBox): boolean => box.width > 0 && box.height > 0;
  const shown = new Map(drawn.split('|').filter(entry => entry !== '').map(parse).flatMap(([id, [x = 0, y = 0, width = 0, height = 0]]): [string, number[]][] => {
    const box = cut({id, x: x + canvas.x, y: y + canvas.y, width, height}, viewport, 0);
    return seen(box) ? [[id, [box.x, box.y, box.width, box.height]]] : [];
  })), problems: string[] = [], inView = live.map(item => cut(item, viewport, 0)).filter(seen);
  if (shown.size !== inView.length) problems.push(`${String(shown.size)} drawn panels for ${String(inView.length)} boxes in view`);
  for (const box of inView) {
    const glass = shown.get(box.id), want = [box.x, box.y, box.width, box.height];
    if (glass === undefined) {problems.push(`${box.id} has no glass`);continue;}
    if (glass.some((value, index) => Math.abs(value - (want[index] ?? 0)) > tolerance)) problems.push(`${box.id} glass ${glass.map(value => String(Math.round(value * 10) / 10)).join(',')} does not follow its box ${want.map(value => value.toFixed(1)).join(',')}`);
  }
  return problems;
}
