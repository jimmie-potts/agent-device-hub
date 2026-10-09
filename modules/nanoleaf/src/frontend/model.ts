// Browser-only wall data and command mapping. No runtime implementation is imported.
import type {FrontendAction} from '@jimmie-potts/sdk/frontend';

export type Point = [number, number];
export type ConnectorGraph = {version: 1; nodes: {id: string; x: number; y: number; sourceIds: number[]}[];
  lines: {id: string; number: number; a: string; b: string; zoneIds: number[]}[]};
export type WallRecord = {
  id: string; revision: number; configurationRevision: number; kind: 'lines' | 'panels'; mode: 'work' | 'quiet' | 'free';
  modePending: boolean; failing: boolean; held: boolean; source: 'shared' | 'paused'; layout: 'saved' | 'missing';
  settings: {style: 'classic' | 'project'; coverage: 'whole' | 'status'; rotation: 0 | 90 | 180 | 270; flipX: 0 | 1; flipY: 0 | 1};
  palette: Record<'base' | 'working' | 'question' | 'blocked' | 'unread', string>; pendingEdit: boolean;
  projects: {id: string; name: string | null; color: string; assigned: number; active: number; waiting: number}[];
  elements: {id: string; number: number; project: string | null; signature: 0 | 1; task: string | null; points: Point[] | null}[];
  tasks: {id: string; title: string; project: string | null; status: 'blocked' | 'question' | 'working' | 'unread' | 'idle';
    startedAtMs?: number; element: string | null; manualProject: string | null; evictionToken?: string; codexUrl?: string;
    statusEvidence: 'current' | 'uncertain'}[];
};
export type WallDevice = {id: string; name: string; default: boolean};
export type LegacyWall = {
  id: string; current: boolean; kind: WallRecord['kind']; mode: WallRecord['mode']; mode_pending: boolean; pending: boolean;
  settings: {style: string; coverage: string; rotation: number; flip_x: number; flip_y: number}; palette: WallRecord['palette'];
  projects: WallRecord['projects']; devices: WallDevice[]; lines: (WallRecord['elements'][number] & {points: Point[]})[];
  tasks: (WallRecord['tasks'][number] & {line: string | null; manual: string | null; started: number | null})[];
  connector_layout?: ConnectorGraph; error: string; geometry_error: string;
};

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const uuidLink = /^codex:\/\/threads\/[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;

/** Translate the retained editor's requests to the existing owner's command contract. The owner validates values. */
export function wallAction(path: string, payload: Record<string, unknown>, target: string, requestId: string): FrontendAction | string {
  const edit = (value: object): FrontendAction => ({family: 'nanoleaf-wall-edit', target, requestId, data: {edit: value}});
  switch (path) {
    case '/api/mode':
      return {family: 'device-mode-set', target, requestId, data: {mode: payload.mode}};
    case '/api/settings':
      return edit({kind: 'settings', settings: Object.fromEntries(Object.entries(payload).map(([key, value]) =>
        [key === 'flip_x' ? 'flipX' : key === 'flip_y' ? 'flipY' : key, value]))});
    case '/api/assign': {
      if (!object(payload.lines) || Object.keys(payload.lines).length === 0) return 'Select an element to edit';
      const elements: object[] = [];
      for (const [id, value] of Object.entries(payload.lines)) {
        if (!object(value)) return 'The element edit is invalid';
        elements.push({...value, id});
      }
      return edit({kind: 'assign', elements});
    }
    case '/api/project': return edit({kind: 'project-color', project: payload.id, color: payload.color});
    case '/api/task': return edit({kind: 'task-project', task: payload.id, project: payload.project});
    case '/api/locate': return edit({kind: 'locate', element: payload.line});
    case '/api/evict': return edit({kind: 'evict', task: payload.id, evictionToken: payload.evictionToken});
    default: return 'The editor action is unavailable';
  }
}

/** Check the bounded read document before it enters the retained renderer. Its adapter validates graph consistency. */
export function editorGeometry(value: unknown, device: string): ConnectorGraph {
  if (!object(value) || value.schema !== 'nanoleaf-editor-layout/2.0' || value.device !== device || !object(value.geometry)) {
    throw new Error('Invalid saved editor geometry.');
  }
  const graph = value.geometry;
  if (graph.version !== 1 || !Array.isArray(graph.nodes) || graph.nodes.length === 0 || graph.nodes.length > 600
    || !Array.isArray(graph.lines) || graph.lines.length === 0 || graph.lines.length > 300
    || !graph.nodes.every((node: unknown) => object(node) && typeof node.id === 'string' && typeof node.x === 'number' && Number.isFinite(node.x)
      && typeof node.y === 'number' && Number.isFinite(node.y) && Array.isArray(node.sourceIds) && node.sourceIds.every(Number.isSafeInteger))
    || !graph.lines.every((line: unknown) => object(line) && typeof line.id === 'string' && Number.isSafeInteger(line.number)
      && typeof line.a === 'string' && typeof line.b === 'string' && Array.isArray(line.zoneIds) && line.zoneIds.length === 2
      && line.zoneIds.every(Number.isSafeInteger))) throw new Error('Invalid saved editor geometry.');
  return graph as ConnectorGraph;
}

/** Adapt the owner's current record without making another state owner or filling missing geometry with guesses. */
export function legacyWall(record: WallRecord, devices: WallDevice[], current: boolean, graph?: ConnectorGraph): LegacyWall {
  const complete = record.elements.length > 0 && record.elements.every(element => element.points !== null && element.points.length === 3);
  return {
    id: record.id, current, kind: record.kind, mode: record.mode, mode_pending: record.modePending, pending: record.pendingEdit,
    settings: {style: record.settings.style, coverage: record.settings.coverage, rotation: record.settings.rotation,
      flip_x: record.settings.flipX, flip_y: record.settings.flipY}, palette: record.palette,
    projects: record.projects.map(project => ({...project, name: project.name ?? project.id})), devices,
    lines: complete ? record.elements.map(element => ({...element, points: element.points ?? []})) : [],
    tasks: record.tasks.map(({codexUrl, ...task}) => ({...task, line: task.element, manual: task.manualProject,
      started: task.startedAtMs === undefined ? null : task.startedAtMs / 1000,
      statusEvidence: current ? task.statusEvidence : 'uncertain',
      ...(codexUrl !== undefined && uuidLink.test(codexUrl) ? {codexUrl} : {})})),
    ...(graph === undefined ? {} : {connector_layout: graph}),
    error: record.held ? 'A write has an uncertain result. The device is held.' : record.failing ? 'The wall worker is unavailable.'
      : record.source === 'paused' ? 'Shared input is paused.' : '',
    geometry_error: complete ? '' : 'Saved geometry is unavailable. Configure the layout through supported setup.',
  };
}
