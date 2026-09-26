/* Pure adapter from the hub's Nanoleaf reads to the shared device art. The hub geometry route
   (`GET /api/controllers/v1/<alias>/integration/geometry`, codex-nanoleaf#169) supplies the shape;
   the `nanoleaf.integration/1.0` snapshot supplies mode, project colors, element reservations and
   pending edits. Task placement and status are not in that snapshot, so they are inputs here. */
import {color, type LayoutInput, type Mode} from './prism';
import type {PanelsLayoutInput} from './panels';

export type Geometry = {apiVersion: string; identity: {controllerId: string; deviceId: string; sourceId: string; controllerEpoch: string}; kind: null | 'lines' | 'panels'; elements: {id: string; number: number; zones: number[]; points: [number, number][] | null}[]; connectors: null | {nodes: {id: string; x: number; y: number}[]; lines: {id: string; a: string; b: string}[]}};
/** One geometry read. `final` means the answer will not change this session: a validated geometry, a device without a saved layout, or an owner that predates the route. Any other failure is read again after the next successful poll. */
export type GeometryRead = {geometry?: Geometry; error?: string; final: boolean};
export type ArtSnapshot = {mode: string; settings: {style?: string; coverage?: string}; projects: {id: string; color: string}[]; elements: {id: string; projectId: string | null; signature: number}[]; wallPending: unknown};
export type ElementStatus = 'working' | 'question' | 'blocked' | 'unread';
export const STATUSES: ElementStatus[] = ['working', 'question', 'blocked', 'unread'];
/** Fixed-meaning wall status colors, read from the application skin's `--wall-*` tokens by the page. */
export type StatusTokens = Record<ElementStatus, string>;
export type Presentation = {mode: Mode; colors: Map<string, [string, string]>; pending: Set<string>; activity: Set<string>; metadata: Map<string, {ariaLabel: string; status: string | null}>};
export type StripCell = {id: string; number: number; colors: [string, string]; pending: boolean; reserved: string | null; label: string};

const isHex = (value: unknown): value is string => color(value) !== null;
/** The Prism layout for a Lines device whose geometry carries a connector graph, or undefined when the shape cannot be drawn. */
export function prismLayout(geometry: Geometry | undefined): LayoutInput | undefined {
 if (!geometry || geometry.kind !== 'lines' || !geometry.connectors || geometry.elements.length === 0 || geometry.elements.some(e => e.points === null)) return undefined;
 const numbers = new Map(geometry.elements.map(e => [e.id, e]));
 return {version: 1, name: 'Nanoleaf Lines', nodes: geometry.connectors.nodes.map(n => ({id: n.id, x: n.x, y: n.y})),
  lines: geometry.connectors.lines.map(l => { const element = numbers.get(l.id); return {id: l.id, number: element?.number ?? l.id, a: l.a, b: l.b, zoneIds: element ? [...element.zones] : undefined}; })};
}
/** The triangle layout for a Panels device whose geometry carries three corners per element. */
export function panelsLayout(geometry: Geometry | undefined): PanelsLayoutInput | undefined {
 if (!geometry || geometry.kind !== 'panels' || geometry.elements.length === 0 || geometry.elements.some(e => e.points === null || e.points.length !== 3)) return undefined;
 return {name: 'Nanoleaf Light Panels', elements: geometry.elements.map(e => ({id: e.id, number: e.number, points: (e.points as [number, number][]).map(([x, y]) => [x, y])}))};
}
export const artMode = (mode: string | undefined): Mode => mode === 'Work' ? 'work' : mode === 'Quiet' ? 'quiet' : 'free';
const pendingIds = (pending: unknown): Set<string> => { const value = pending as {elements?: {id?: unknown}[]} | null; return new Set(Array.isArray(value?.elements) ? value!.elements!.map(e => String(e?.id ?? '')).filter(Boolean) : []); };
/** The wall map's color rule: the status color on both zones; in the project layout style the signature zone takes the reservation's project color. With no status source the base is the wall map's own reading of a Line without a task. */
export function elementColors(element: {projectId: string | null; signature: number} | undefined, style: string | undefined, projects: {id: string; color: string}[], status: ElementStatus | undefined, tokens: StatusTokens): [string, string] {
 const base = tokens[status ?? 'unread'];
 const colors: [string, string] = [base, base];
 if (style === 'project' && element) { const owner = projects.find(p => p.id === element.projectId); colors[element.signature === 1 ? 1 : 0] = isHex(owner?.color) ? owner!.color : tokens.unread; }
 return colors;
}
function describe(kind: 'lines' | 'panels', number: number | string, element: {projectId: string | null} | undefined, style: string | undefined, status: ElementStatus | undefined, active: boolean) {
 const parts = [`${kind === 'lines' ? 'Line' : 'Panel'} ${number}`];
 if (style === 'project') parts.push(element?.projectId ? `Reserved: ${element.projectId}` : 'Shared pool');
 parts.push(status ? `${status}${active ? ', active' : ''}` : 'No task shown');
 return parts.join(' · ');
}
/** Presentation for a drawn layout. `status` and `activity` are inputs the pages leave empty today. Only elements the geometry knows are colored; the snapshot's reservations apply where ids match. */
export function presentation({kind, elements, snapshot, status = {}, activity = [], tokens}: {kind: 'lines' | 'panels'; elements: {id: string; number: number | string}[]; snapshot: ArtSnapshot | undefined; status?: Record<string, ElementStatus>; activity?: Iterable<string>; tokens: StatusTokens}): Presentation {
 const style = snapshot?.settings.style, projects = snapshot?.projects ?? [], reservations = new Map((snapshot?.elements ?? []).map(e => [e.id, e])), known = new Set(elements.map(e => e.id));
 const active = new Set([...activity].filter(id => known.has(id))), pending = new Set([...pendingIds(snapshot?.wallPending)].filter(id => known.has(id)));
 const colors = new Map<string, [string, string]>(), metadata = new Map<string, {ariaLabel: string; status: string | null}>();
 for (const element of elements) {
  const reservation = reservations.get(element.id), state = status[element.id];
  colors.set(element.id, elementColors(reservation, style, projects, state, tokens));
  metadata.set(element.id, {ariaLabel: describe(kind, element.number, reservation, style, state, active.has(element.id)), status: state ?? null});
 }
 return {mode: snapshot ? artMode(snapshot.mode) : 'free', colors, pending, activity: active, metadata};
}
/** Why the physical layout is not drawn, in the page's words. */
export function fallbackReason(read: GeometryRead | undefined): string {
 if (!read) return 'the layout has not been read yet';
 if (read.error === 'unsupported-capability') return 'the controller predates the geometry route';
 if (read.error) return `the layout could not be read (${read.error})`;
 if (read.geometry?.kind === null) return 'the controller has no saved layout';
 return 'the saved layout has no drawable shape';
}
/** One cell per element for the schematic strip: the snapshot's elements, or the geometry's when the snapshot has none. */
export function strip({read, snapshot, status = {}, tokens}: {read: GeometryRead | undefined; snapshot: ArtSnapshot | undefined; status?: Record<string, ElementStatus>; tokens: StatusTokens}): StripCell[] {
 const style = snapshot?.settings.style, projects = snapshot?.projects ?? [], pending = pendingIds(snapshot?.wallPending);
 const fromGeometry = read?.geometry?.elements ?? [], numbers = new Map(fromGeometry.map(e => [e.id, e.number]));
 const elements = snapshot?.elements.length ? snapshot.elements.map((e, index) => ({id: e.id, number: numbers.get(e.id) ?? index + 1, reservation: e})) : fromGeometry.map(e => ({id: e.id, number: e.number, reservation: undefined}));
 const kind = read?.geometry?.kind === 'panels' ? 'panels' : 'lines';
 return elements.map(({id, number, reservation}) => ({id, number, colors: elementColors(reservation, style, projects, status[id], tokens), pending: pending.has(id), reserved: reservation?.projectId ?? null, label: describe(kind, number, reservation, style, status[id], false)}));
}
/** Classifies a geometry read for the page: which answers are final and how a failure is named. */
export function geometryRead(result: {geometry: Geometry} | {error: string; status: number}): GeometryRead {
 if ('geometry' in result) return {geometry: result.geometry, final: true};
 return {error: result.error, final: result.status === 422};
}
