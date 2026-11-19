/**
 * The glass layer's scene (#1929): what the WebGL layer under a page draws, read from the page once per frame.
 *
 * A page opts in by marking elements inside the layer's root:
 * - `data-glass-panel="<id>"` on the element whose box is one glass panel. Its corner radius is the computed
 *   `--glass-radius` at that element, so a skin or a page can change it.
 * - `data-glass-veil` on text that sits directly on the backdrop, such as a page heading. The layer darkens or lightens
 *   the backdrop behind it just enough to keep the text readable. Veils are found in the whole document, so the
 *   page's footer can carry one too.
 *
 * Later stories extend `GlassPanel` with optional fields that `readScene` parses from more attributes (#1930 the mode
 * thumb, #1931 a panel's light, #1932 its liquid state, #1933 a dragged panel and a drop target). The renderer packs
 * each panel into one row of a data texture (`PANEL_TEXELS` texels wide), so a new field is a new texel and a new
 * shader term; nothing else changes shape.
 */

/** A box in CSS pixels relative to the viewport. */
export type GlassRect = {x: number; y: number; width: number; height: number};
export type GlassPanel = {id: string; rect: GlassRect; radius: number};
export type GlassScene = {panels: readonly GlassPanel[]; veils: readonly GlassRect[]};

/** Home has at most 128 placements; the layer draws only the ones in or near the viewport. */
export const MAX_PANELS = 128;
export const MAX_VEILS = 12;
/** How far past the viewport a panel still matters: its shadow and the lip of light reach about this far. */
const REACH = 64;
const DEFAULT_RADIUS = 34;

const visible = (rect: GlassRect, width: number, height: number): boolean => rect.width > 0 && rect.height > 0
  && rect.x < width + REACH && rect.y < height + REACH && rect.x + rect.width > -REACH && rect.y + rect.height > -REACH;
const rectOf = (element: Element): GlassRect => {const box = element.getBoundingClientRect();return {x: box.left, y: box.top, width: box.width, height: box.height};};

/** Reads every marked panel and veil in or near the viewport. The layer calls it at most once per frame. */
export function readScene(root: ParentNode, veilScope: ParentNode, viewport: {width: number; height: number}): GlassScene {
  const panels: GlassPanel[] = [];
  for (const element of root.querySelectorAll<HTMLElement>('[data-glass-panel]')) {
    if (panels.length >= MAX_PANELS) break;
    const rect = rectOf(element);if (!visible(rect, viewport.width, viewport.height)) continue;
    const radius = Number.parseFloat(getComputedStyle(element).getPropertyValue('--glass-radius'));
    panels.push({id: element.dataset['glassPanel'] ?? '', rect, radius: Math.min(Number.isFinite(radius) ? radius : DEFAULT_RADIUS, rect.width / 2, rect.height / 2)});
  }
  const veils: GlassRect[] = [];
  for (const element of veilScope.querySelectorAll('[data-glass-veil]')) {
    if (veils.length >= MAX_VEILS) break;
    const rect = rectOf(element);if (visible(rect, viewport.width, viewport.height)) veils.push(rect);
  }
  return {panels, veils};
}

const sameRect = (a: GlassRect, b: GlassRect): boolean => Math.abs(a.x - b.x) < 0.25 && Math.abs(a.y - b.y) < 0.25
  && Math.abs(a.width - b.width) < 0.25 && Math.abs(a.height - b.height) < 0.25;
/** Whether two reads would draw the same picture, so a read that finds nothing new draws no frame. */
export function sameScene(a: GlassScene, b: GlassScene): boolean {
  return a.panels.length === b.panels.length && a.veils.length === b.veils.length
    && a.panels.every((panel, index) => {const other = b.panels[index];return other !== undefined && other.id === panel.id && other.radius === panel.radius && sameRect(panel.rect, other.rect);})
    && a.veils.every((veil, index) => {const other = b.veils[index];return other !== undefined && sameRect(veil, other);});
}
