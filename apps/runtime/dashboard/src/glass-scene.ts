/**
 * The glass layer's scene (#1929): what the WebGL layer under a page draws, read from the page once per frame.
 *
 * A page opts in by marking elements inside the layer's root:
 * - `data-glass-panel="<id>"` on the element whose box is one glass panel. Its corner radius is the computed
 *   `--glass-radius` at that element, so a skin or a page can change it.
 * - `data-glass-veil` on text that sits directly on the backdrop, such as a page heading or a notice. The layer darkens
 *   or lightens the backdrop behind it just enough to keep the text readable, with a soft edge a little past its box.
 *   `data-glass-veil="edge"` keeps the veil inside the box, for a frosted region with a hard edge such as the rail.
 *   Veils are found in the whole document, so the shell's rail and footer can carry one too; a veil that is hidden
 *   or outside the window is left out. A veil on an element that stays in the window while the page scrolls (it or
 *   an ancestor is fixed or sticky, such as the rail and the phone bar) is `fixed`: the layer draws it with the
 *   backdrop, which stays still, and every other veil with the glass, which scrolls with the page (#2023).
 * - `data-glass-thumb="<segment>"` on the selected segment of a switch, such as Home's hub mode switch (#1930). The
 *   layer draws a small glass capsule there that stretches as it travels when another segment is marked; when the
 *   same segment only moves, the capsule moves with it at once. It is not a panel: it has its own
 *   uniforms, and only the first marked element in view is drawn.
 *
 * - `data-glass-lamp="<level>"` (#1931) on one element inside a panel whose center is the panel's lamp: the light
 *   glows through the panel from there, spills onto the backdrop and catches its neighbors' bevels. The level is 0 to
 *   1 (0 draws no light). `data-glass-lamp-color="r g b"` gives the light's color as sRGB channels from 0 to 1; without
 *   it the light is the skin's warm white (`--glass-lamp`). `data-glass-pressed` marks a panel held down by the
 *   pointer: it brightens, its bevel widens and it spills white light.
 *
 * - `data-glass-target` (#1933) on a panel that a dragged panel would group with if dropped now: it lights up, as a
 *   pressed panel does. `data-glass-dragged` marks the dragged panel, which moves by a transform (the layer reads its
 *   box), counts as animating so it turns liquid, and stays clear of the target's light where the two overlap.
 *
 * Later stories extend `GlassPanel` with optional fields that `readScene` parses from more attributes (#1932 its liquid
 * state). The renderer packs each panel into one row of a data texture (`PANEL_TEXELS` texels wide), so a new field is
 * a new texel and a new shader term; nothing else changes shape.
 */

/** A box in CSS pixels relative to the viewport. */
export type GlassRect = {x: number; y: number; width: number; height: number};
/** A color as sRGB channels from 0 to 1. */
export type GlassRgb = readonly [number, number, number];
/** A panel's light (#1931): its color (null for the skin's warm white), level, lamp position and whether it is pressed. */
export type GlassLight = {color: GlassRgb | null; level: number; lamp: {x: number; y: number}; pressed: boolean};
export type GlassPanel = {id: string; rect: GlassRect; radius: number; light?: GlassLight; target?: true; dragged?: true};
export type GlassVeil = {rect: GlassRect; edge: boolean; fixed: boolean};
/** A switch's selected segment, with its `data-glass-thumb` value, so the thumb knows when another segment is chosen. */
export type GlassThumbMark = {rect: GlassRect; key: string};
export type GlassScene = {panels: readonly GlassPanel[]; veils: readonly GlassVeil[]; thumb: GlassThumbMark | null};

/** Home has at most 128 placements; the layer draws only the ones in or near the viewport. */
export const MAX_PANELS = 128;
/** Enough for the heading, notices, status lines, the shell's rail, bar and footer and the empty cells of Edit Home. */
export const MAX_VEILS = 32;
/** How far past the viewport a panel still matters: its shadow and the lip of light reach about this far. */
const REACH = 64;
const DEFAULT_RADIUS = 34;

const visible = (rect: GlassRect, width: number, height: number, reach = REACH): boolean => rect.width > 0 && rect.height > 0
  && rect.x < width + reach && rect.y < height + reach && rect.x + rect.width > -reach && rect.y + rect.height > -reach;
const rectOf = (element: Element): GlassRect => {const box = element.getBoundingClientRect();return {x: box.left, y: box.top, width: box.width, height: box.height};};
/** Whether an element stays in the window while the page scrolls: it or an ancestor is fixed or sticky. */
function pinned(element: Element): boolean {
  for (let node: Element | null = element; node !== null; node = node.parentElement) {const position = getComputedStyle(node).position;if (position === 'fixed' || position === 'sticky') return true;}
  return false;
}
const unit = (value: number): number => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
function lightOf(panel: Element): GlassLight | undefined {
  const lamp = panel.querySelector<HTMLElement>('[data-glass-lamp]');
  if (lamp === null) return undefined;
  const box = rectOf(lamp), channels = (lamp.dataset['glassLampColor'] ?? '').trim().split(/\s+/).map(Number);
  const color = channels.length === 3 && channels.every(Number.isFinite) ? [unit(channels[0] ?? 0), unit(channels[1] ?? 0), unit(channels[2] ?? 0)] as const : null;
  return {color, level: unit(Number(lamp.dataset['glassLamp'])), lamp: {x: box.x + box.width / 2, y: box.y + box.height / 2}, pressed: lamp.dataset['glassPressed'] !== undefined};
}

/**
 * Reads every marked panel and veil in or near the viewport, and `beyond` CSS pixels further above and below it, where
 * the glass canvas reaches past the window (#2023). The layer calls it at most once per frame.
 */
export function readScene(root: ParentNode, veilScope: ParentNode, viewport: {width: number; height: number}, beyond = 0): GlassScene {
  const near = (rect: GlassRect, reach = REACH): boolean => visible({...rect, y: rect.y + beyond}, viewport.width, viewport.height + 2 * beyond, reach);
  const panels: GlassPanel[] = [];
  for (const element of root.querySelectorAll<HTMLElement>('[data-glass-panel]')) {
    if (panels.length >= MAX_PANELS) break;
    const rect = rectOf(element);if (!near(rect)) continue;
    const radius = Number.parseFloat(getComputedStyle(element).getPropertyValue('--glass-radius')), light = lightOf(element);
    panels.push({id: element.dataset['glassPanel'] ?? '', rect, radius: Math.min(Number.isFinite(radius) ? radius : DEFAULT_RADIUS, rect.width / 2, rect.height / 2),
      ...(light === undefined ? {} : {light}), ...(element.dataset['glassTarget'] === undefined ? {} : {target: true as const}),
      ...(element.dataset['glassDragged'] === undefined ? {} : {dragged: true as const})});
  }
  const veils: GlassVeil[] = [];
  for (const element of veilScope.querySelectorAll<HTMLElement>('[data-glass-veil]')) {
    if (veils.length >= MAX_VEILS) break;
    const rect = rectOf(element);
    if (!near(rect, 0) || !element.checkVisibility({visibilityProperty: true})) continue;
    veils.push({rect, edge: element.dataset['glassVeil'] === 'edge', fixed: pinned(element)});
  }
  let thumb: GlassThumbMark | null = null;
  for (const element of root.querySelectorAll<HTMLElement>('[data-glass-thumb]')) {
    const rect = rectOf(element);if (near(rect)) {thumb = {rect, key: element.dataset['glassThumb'] ?? ''};break;}
  }
  return {panels, veils, thumb};
}

const sameRect = (a: GlassRect, b: GlassRect): boolean => Math.abs(a.x - b.x) < 0.25 && Math.abs(a.y - b.y) < 0.25
  && Math.abs(a.width - b.width) < 0.25 && Math.abs(a.height - b.height) < 0.25;
const sameLight = (a: GlassLight | undefined, b: GlassLight | undefined): boolean => a === undefined || b === undefined ? a === b
  : a.level === b.level && a.pressed === b.pressed && Math.abs(a.lamp.x - b.lamp.x) < 0.25 && Math.abs(a.lamp.y - b.lamp.y) < 0.25
    && (a.color === null || b.color === null ? a.color === b.color : a.color.every((value, index) => value === b.color?.[index]));
/** Whether two reads would draw the same picture, so a read that finds nothing new draws no frame. */
/**
 * The scene as far as it can be seen: each panel's and veil's box cut to the window and the reach of its shadow and
 * lip. A panel taller than the window, such as a whole module page, that grows or shrinks below the window draws the
 * same picture, so comparing these finds no change and the layer draws no frame (#1950).
 */
export function visibleScene(scene: GlassScene, viewport: {width: number; height: number}, reach = REACH): GlassScene {
  const cut = (rect: GlassRect): GlassRect => {
    const x = Math.max(rect.x, -reach), y = Math.max(rect.y, -reach);
    return {x, y, width: Math.max(0, Math.min(rect.x + rect.width, viewport.width + reach) - x), height: Math.max(0, Math.min(rect.y + rect.height, viewport.height + reach) - y)};
  };
  // A veil is drawn only where it is in the window, as `readScene` reads it without the glass canvas's margin (#2023).
  return {...scene, panels: scene.panels.map(panel => ({...panel, rect: cut(panel.rect)})), veils: scene.veils.filter(veil => visible(veil.rect, viewport.width, viewport.height, 0)).map(veil => ({...veil, rect: cut(veil.rect)}))};
}

/** The scene moved by (dx, dy): from window coordinates to a canvas whose top left corner is at (-dx, -dy) in the window. */
export function moveScene(scene: GlassScene, dx: number, dy: number): GlassScene {
  const move = (rect: GlassRect): GlassRect => ({...rect, x: rect.x + dx, y: rect.y + dy});
  return {panels: scene.panels.map(panel => ({...panel, rect: move(panel.rect), ...(panel.light === undefined ? {} : {light: {...panel.light, lamp: {x: panel.light.lamp.x + dx, y: panel.light.lamp.y + dy}}})})),
    veils: scene.veils.map(veil => ({...veil, rect: move(veil.rect)})), thumb: scene.thumb === null ? null : {...scene.thumb, rect: move(scene.thumb.rect)}};
}

export function sameScene(a: GlassScene, b: GlassScene): boolean {
  return a.panels.length === b.panels.length && a.veils.length === b.veils.length
    && a.panels.every((panel, index) => {const other = b.panels[index];return other !== undefined && other.id === panel.id && other.radius === panel.radius && other.target === panel.target && other.dragged === panel.dragged && sameRect(panel.rect, other.rect) && sameLight(panel.light, other.light);})
    && a.veils.every((veil, index) => {const other = b.veils[index];return other !== undefined && other.edge === veil.edge && other.fixed === veil.fixed && sameRect(veil.rect, other.rect);})
    && (a.thumb === null ? b.thumb === null : b.thumb !== null && a.thumb.key === b.thumb.key && sameRect(a.thumb.rect, b.thumb.rect));
}

/** How long a drop target takes to light up fully, and to go out (#1933; the reference's 160 ms). */
const TARGET_S = 0.16;
/**
 * Eases the drop target's light on a time base: toward 1 on the marked panel, toward 0 once none is marked. A new target
 * starts from 0. Returns undefined once the light is out. With reduced motion it switches at once.
 */
export function easeTarget(current: {id: string; glow: number} | undefined, marked: string | undefined, seconds: number, still: boolean): {id: string; glow: number} | undefined {
  if (marked !== undefined) {
    const from = current?.id === marked ? current.glow : 0;
    return {id: marked, glow: still ? 1 : Math.min(1, from + seconds / TARGET_S)};
  }
  if (current === undefined) return undefined;
  const glow = still ? 0 : Math.max(0, current.glow - seconds / TARGET_S);
  return glow <= 0 ? undefined : {id: current.id, glow};
}
