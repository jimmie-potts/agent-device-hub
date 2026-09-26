/* NL22 Light Panels drawn as triangles in the Prism material: the connector pane gradient and edge stroke,
   one light color per element, a soft spill and a two-second Work pulse on active elements. The wall map
   has no Panels art, so this is new drawing in the same language (Hub #355). No network, device access or writes. */
import {materials, utils, constants, color, type Mode} from './prism';
let instance = 0;
const {esc, fmt, pale, attr, clamp} = utils, FLOW_SECONDS = constants.flowSeconds;
export type Triangle = {id: string; number: string | number; points: [number, number][]};
export type PanelsLayoutInput = {name?: string; elements: Triangle[]};
export type ElementMetadata = {ariaLabel?: string; status?: string | null};
type ReducedMotion = {matches: boolean; addEventListener(type: 'change', listener: () => void): void; removeEventListener(type: 'change', listener: () => void): void};
const centroid = (points: [number, number][]) => points.reduce<[number, number]>((sum, [x, y]) => [sum[0] + x / points.length, sum[1] + y / points.length], [0, 0]);
/** Corners moved toward the centroid by `inset` units, so the light sits inside the pane's edge. */
function shrink(points: [number, number][], inset: number): string {
 const [cx, cy] = centroid(points);
 return points.map(([x, y]) => { const dx = x - cx, dy = y - cy, length = Math.hypot(dx, dy) || 1, keep = Math.max(0, length - inset) / length; return `${fmt(cx + dx * keep)} ${fmt(cy + dy * keep)}`; }).join(' ');
}
export function validatePanels(input: PanelsLayoutInput | null | undefined): {name: string; elements: (Triangle & {index: number; cx: number; cy: number})[]} {
 if (!input || !Array.isArray(input.elements) || input.elements.length < 1 || input.elements.length > 300) throw Error('Choose a Panels layout with 1–300 triangles.');
 const ids = new Set<string>();
 const elements = input.elements.map((element, index) => {
  const id = String(element?.id ?? ''); if (!id || id.length > 150 || ids.has(id)) throw Error('Every triangle needs a unique, stable ID.'); ids.add(id);
  if (!Array.isArray(element.points) || element.points.length !== 3 || element.points.some(p => !Array.isArray(p) || p.length !== 2 || p.some(v => !Number.isFinite(v) || Math.abs(v) > 1e7))) throw Error('A triangle needs three finite corners.');
  const [cx, cy] = centroid(element.points);
  return {id, number: element.number ?? index + 1, points: element.points.map(([x, y]) => [x, y] as [number, number]), index, cx, cy};
 });
 return {name: String(input.name || 'Light Panels'), elements};
}
/** Draws one Panels layout. The API mirrors the Prism renderer's subset that pages use: colors, mode, activity, selection, pending, metadata and destroy. */
export class PanelsRenderer {
 host: HTMLElement; p: string; svg!: SVGSVGElement; layout!: ReturnType<typeof validatePanels>; mode: Mode = 'work'; destroyed = false; frameId = 0;
 selection = new Set<string>(); activity = new Set<string>(); pending = new Set<string>(); hovered = new Set<string>(); focused = new Set<string>(); metadata = new Map<string, {ariaLabel?: string; status: string | null}>(); colors = new Map<string, string>();
 flowElapsed = 0; flowLast: number | null = null; pauseReasons = new Set<string>(); reduced: ReducedMotion; visibilityObserver: IntersectionObserver | null; inputAbort?: AbortController; onSelect?: (event: Event, element: Triangle) => void;
 private _hidden: () => void; private _reduce: () => void;
 constructor(host: HTMLElement, layout: PanelsLayoutInput, options: {onSelect?: (event: Event, element: Triangle) => void} = {}) {
  if (!host) throw Error('A host element is required.');
  validatePanels(layout);
  this.host = host; this.p = 'pn' + (++instance) + '-'; this.onSelect = options.onSelect;
  this.reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : {matches: false, addEventListener() {}, removeEventListener() {}};
  const rect = host.getBoundingClientRect(); this._setPauseReason('host-hidden', !(rect.bottom >= 0 && rect.top < innerHeight));
  this.visibilityObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => { const latest = entries.at(-1); if (latest) this._setPauseReason('host-hidden', !latest.isIntersecting); }) : null; this.visibilityObserver?.observe(host);
  this._hidden = () => this._setPauseReason('document-hidden', document.hidden);
  this._reduce = () => { this.flowLast = null; this.light(performance.now()); this.schedule(); };
  document.addEventListener('visibilitychange', this._hidden); this.reduced.addEventListener('change', this._reduce); this._hidden();
  this.setLayout(layout);
 }
 _setPauseReason(reason: string, paused: boolean) { paused ? this.pauseReasons.add(reason) : this.pauseReasons.delete(reason); this.flowLast = null; if (this.pauseReasons.size) { cancelAnimationFrame(this.frameId); this.frameId = 0; } else this.schedule(); }
 setLayout(input: PanelsLayoutInput) {
  this.layout = validatePanels(input);
  const keep = (set: Set<string>) => new Set([...set].filter(id => this.layout.elements.some(e => e.id === id)));
  this.selection = keep(this.selection); this.activity = keep(this.activity); this.pending = keep(this.pending); this.hovered = keep(this.hovered); this.focused = keep(this.focused);
  this.build(); this.light(performance.now()); this.schedule(); return this;
 }
 build() {
  this.inputAbort?.abort(); this.inputAbort = new AbortController();
  const listen = (node: Element, type: string, callback: (event: Event) => void) => node.addEventListener(type, callback, {signal: this.inputAbort!.signal});
  const p = this.p, all = this.layout.elements.flatMap(e => e.points), xs = all.map(q => q[0]), ys = all.map(q => q[1]), margin = 40;
  const x = Math.min(...xs) - margin, y = Math.min(...ys) - margin, w = Math.max(...xs) - x + margin, h = Math.max(...ys) - y + margin;
  const triangle = (e: typeof this.layout.elements[number]) => { const outline = e.points.map(([px, py]) => `${fmt(px)} ${fmt(py)}`).join(' '), label = 'Select Panel ' + esc(e.number); return `<g data-element="${e.index}" data-element-id="${esc(e.id)}"><g data-part="diffuse-spill" data-spill="${e.index}" filter="url(#${p}soft)"><polygon data-light="${e.index}" points="${shrink(e.points, 6)}" fill="#65e7ff" opacity=".5"/></g><polygon data-part="pane" points="${outline}" fill="url(#${p}pane)" stroke="url(#${p}edge)" stroke-width="1.2" stroke-linejoin="round"/><polygon data-part="light" data-light="${e.index}" data-bed="${e.index}" points="${shrink(e.points, 9)}" fill="#65e7ff" opacity=".55"/><polygon data-part="core" data-light="${e.index}" data-hot="true" points="${shrink(e.points, 22)}" fill="#eaffff" opacity=".35"/><polygon data-part="facet" points="${shrink(e.points, 3)}" fill="none" stroke="#e6f6ff" stroke-opacity=".18" stroke-width=".6"/><g class="wall-line prism-panel-interaction" data-control="${e.index}" data-line="${esc(e.id)}" data-line-id="${esc(e.id)}" role="button" tabindex="0" aria-label="${label}" aria-pressed="false"><title>${label}</title><polygon class="hit" data-hit="${e.index}" points="${outline}" fill="transparent"/><polygon class="outline selection-ring" data-selection="${e.index}" points="${shrink(e.points, -4)}" fill="none" opacity="0" stroke-linejoin="round"/><polygon class="pending-ring" data-pending-ring="${e.index}" points="${shrink(e.points, -8)}" fill="none" opacity="0" stroke-linejoin="round"/></g><g class="number-tag" data-label="${e.index}" visibility="hidden" transform="translate(${fmt(e.cx)} ${fmt(e.cy)})">${materials.numeral(p, e.number)}</g></g>`; };
  this.host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${[x, y, w, h].map(fmt).join(' ')}" role="group" aria-label="${esc(this.layout.name)}" class="prism-scene prism-panels" data-prism-mode="${this.mode}"><title>${esc(this.layout.name)}</title><defs>${materials.defs(p)}</defs><g data-layer="panels">${this.layout.elements.map(triangle).join('')}</g></svg>`;
  this.svg = this.host.querySelector('svg') as SVGSVGElement;
  for (const element of this.layout.elements) {
   const control = this.control(element.index), activate = (event: Event) => this.onSelect?.(event, element);
   listen(control, 'click', activate);
   listen(control, 'keydown', event => { const key = (event as KeyboardEvent).key; if (key === 'Enter' || key === ' ') { event.preventDefault(); activate(event); } });
   listen(control, 'pointerenter', () => { this.hovered.add(element.id); this.updateInteraction(); }); listen(control, 'pointerleave', () => { this.hovered.delete(element.id); this.updateInteraction(); });
   listen(control, 'focus', () => { this.focused.add(element.id); this.updateInteraction(); }); listen(control, 'blur', () => { this.focused.delete(element.id); this.updateInteraction(); });
   this.paint(element.id);
  }
  this.updateInteraction();
 }
 private control(index: number) { return this.svg.querySelector<SVGElement>(`[data-control="${index}"]`) as SVGElement; }
 private set(ids: Iterable<string | number> | null | undefined, label: string) { const known = new Set(this.layout.elements.map(e => e.id)), result = new Set([...(ids ?? [])].map(String)); if ([...result].some(id => !known.has(id))) throw Error(label + ' contains an unknown element ID.'); return result; }
 paint(id: string) { const element = this.layout.elements.find(e => e.id === id); if (!element) return; const fill = this.colors.get(id) ?? '#65e7ff'; this.svg.querySelectorAll<SVGElement>(`[data-light="${element.index}"]`).forEach(el => attr(el, 'fill', el.dataset.hot ? pale(fill) : fill)); }
 setColors(id: string | number, colors: string[]) { const key = String(id); if (!this.layout.elements.some(e => e.id === key)) throw Error('Unknown element ID.'); const fill = colors[0]; if (!color(fill)) throw Error('Provide a hex color.'); if (this.colors.get(key) === fill) return this; this.colors.set(key, fill); this.paint(key); return this; }
 setMode(mode: Mode) { if (!['work', 'quiet', 'free'].includes(mode)) throw Error('Unknown wall mode.'); if (this.mode !== mode) { this.mode = mode; this.flowLast = null; } this.light(performance.now()); this.schedule(); return this; }
 setActivity(ids: Iterable<string | number> | null | undefined) { this.activity = this.set(ids, 'Activity'); this.light(performance.now()); this.schedule(); return this; }
 setSelection(ids: Iterable<string | number> | null | undefined) { this.selection = this.set(ids, 'Selection'); this.updateInteraction(); return this; }
 setPending(ids: Iterable<string | number> | null | undefined) { this.pending = this.set(ids, 'Pending elements'); this.updateInteraction(); return this; }
 setLineMetadata(entries: Map<string, ElementMetadata> | Record<string, ElementMetadata | null | undefined> | null | undefined) { const pairs = entries instanceof Map ? [...entries] : Object.entries(entries || {}), next = new Map<string, {ariaLabel?: string; status: string | null}>(); for (const [rawId, raw] of pairs) { const id = String(rawId); if (!this.layout.elements.some(e => e.id === id)) throw Error('Element metadata contains an unknown element ID.'); const meta = raw || {}; if (meta.ariaLabel !== undefined && typeof meta.ariaLabel !== 'string') throw Error('Element ariaLabel must be text.'); if (meta.status !== undefined && meta.status !== null && typeof meta.status !== 'string') throw Error('Element status must be text or null.'); next.set(id, {ariaLabel: meta.ariaLabel, status: meta.status ?? null}); } this.metadata = next; this.updateInteraction(); return this; }
 updateInteraction() {
  if (!this.svg) return;
  for (const element of this.layout.elements) {
   const id = element.id, control = this.control(element.index), meta = this.metadata.get(id) || {} as {ariaLabel?: string; status?: string | null};
   control.classList.toggle('selected', this.selection.has(id)); control.classList.toggle('hovered', this.hovered.has(id)); control.classList.toggle('focused', this.focused.has(id)); control.classList.toggle('pending', this.pending.has(id));
   attr(control, 'aria-pressed', this.selection.has(id)); if (meta.status) control.dataset.status = meta.status; else delete control.dataset.status;
   const aria = meta.ariaLabel || 'Select Panel ' + element.number; attr(control, 'aria-label', aria); const title = control.querySelector('title'); if (title) title.textContent = aria;
   attr(this.svg.querySelector(`[data-selection="${element.index}"]`), 'opacity', this.selection.has(id) || this.focused.has(id) ? 1 : 0);
   attr(this.svg.querySelector(`[data-pending-ring="${element.index}"]`), 'opacity', this.pending.has(id) ? 1 : 0);
   attr(this.svg.querySelector(`[data-label="${element.index}"]`), 'visibility', this.selection.has(id) || this.hovered.has(id) || this.focused.has(id) ? 'visible' : 'hidden');
  }
 }
 light(now: number) {
  if (!this.svg) return;
  const flowAllowed = !this.reduced.matches && this.mode === 'work' && this.activity.size > 0 && this.pauseReasons.size === 0;
  if (!flowAllowed) this.flowLast = null; else if (this.flowLast === null) this.flowLast = now; else { this.flowElapsed += Math.max(0, (now - this.flowLast) / 1000); this.flowLast = Math.max(this.flowLast, now); }
  const t = (this.flowElapsed / FLOW_SECONDS) % 1, pulse = .5 - .5 * Math.cos(t * 2 * Math.PI);
  const bed = this.mode === 'work' ? .62 : this.mode === 'quiet' ? .34 : .15, spill = this.mode === 'work' ? .5 : this.mode === 'quiet' ? .22 : .08;
  for (const element of this.layout.elements) {
   const active = flowAllowed && this.activity.has(element.id), lift = active ? .3 * pulse : 0;
   attr(this.svg.querySelector(`[data-part="light"][data-light="${element.index}"]`), 'opacity', fmt(clamp(bed + lift)));
   attr(this.svg.querySelector(`[data-part="core"][data-light="${element.index}"]`), 'opacity', fmt(clamp(bed * .55 + lift)));
   attr(this.svg.querySelector(`[data-spill="${element.index}"] polygon`), 'opacity', fmt(clamp(spill + lift * .8)));
  }
  const layer = this.svg.querySelector<SVGElement>('[data-layer="panels"]'); if (layer) layer.style.filter = this.mode === 'free' ? 'saturate(.35)' : '';
  this.svg.dataset.prismMode = this.mode; this.svg.dataset.reducedMotion = String(this.reduced.matches); this.svg.dataset.flow = String(flowAllowed);
 }
 _needsFrame() { return !this.destroyed && !!this.layout && this.pauseReasons.size === 0 && !this.reduced.matches && this.mode === 'work' && this.activity.size > 0; }
 schedule() { if (!this._needsFrame()) { cancelAnimationFrame(this.frameId); this.frameId = 0; return; } if (this.frameId) return; this.frameId = requestAnimationFrame(now => { this.frameId = 0; this.light(now); this.schedule(); }); }
 destroy() { if (this.destroyed) return; this.destroyed = true; this.inputAbort?.abort(); this.visibilityObserver?.disconnect(); cancelAnimationFrame(this.frameId); this.frameId = 0; document.removeEventListener('visibilitychange', this._hidden); this.reduced.removeEventListener('change', this._reduce); this.host.replaceChildren(); }
}
