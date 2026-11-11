/**
 * The widget catalog (Hub #277). A widget is one placeable block over one source: the core's families, a module's
 * families, or a read-only external source (Hub #287). A widget renders identically wherever it is placed, so moving one
 * between pages is a placement change. Home's editor (#366) extends this core catalog with existing device, lighting,
 * room and Music instances in home-catalog.ts. On the runtime (Hub #922) widgets read named families through sync.
 * Wispr (#927) reads private numeric content on demand; it never joins the broadcast families.
 */
import type {HomeShape} from './home-shapes.ts';
export type SourceKind = 'core' | 'module' | 'external';
/** Small prefers a compact width, medium a wider card and large a whole row; narrow screens stack every size. */
export type WidgetSize = 'small' | 'medium' | 'large';
export type WidgetDefinition = {
  /** Stable identifier in lowercase letters, digits and hyphens. */
  id: string;
  name: string;
  description: string;
  /** The sizes the widget renders well at. */
  sizes: readonly WidgetSize[];
  /**
   * The Home shapes the widget offers (#1672), each fitting the 220px unit: shapes its own content fills, and the generic
   * compact face for a widget without compact content of its own. `standard` is the shape a placement saved as Standard
   * shows until the owner picks one.
   */
  shapes: readonly HomeShape[]; standard: HomeShape;
  /** Offered shapes that show the generic compact face (name, state and Open) instead of the widget's own content. */
  generic?: readonly HomeShape[];
  /** The page that holds the widget's full content and controls, for its compact faces. */
  open?: string;
  /** The source kind and its synced families or explicit private content reads. */
  source: {kind: SourceKind; families: readonly string[]; content?: readonly string[]};
  /** true when the widget offers explicit command actions; a read-only widget has none. */
  commands: boolean;
  /**
   * A panel the owner-approved layout places now and another story fills (mockup "Recommended (d)"): the inbox (#923).
   * It shows its heading and says it is not shown here yet; it reads nothing.
   */
  slot?: {story: string};
};

export const widgetCatalog: readonly WidgetDefinition[] = [
  {
    id: 'art', name: 'Art', description: 'A rich generated composition, private gallery and explicit owner requests.',
    sizes: ['small', 'medium', 'large'], shapes: ['square', 'wide', 'tall', 'large-square'], standard: 'large-square', open: '#/module/art/gallery', source: {kind: 'module', families: ['art'], content: ['art/catalog', 'art/rendition']}, commands: true,
  },
  {
    id: 'reachy', name: 'Reachy', description: 'Latest fixed-text reaction, guarded text controls and separately enabled browser speech.',
    sizes: ['medium', 'large'], shapes: ['square'], standard: 'square', generic: ['square'], open: '#/module/companions/reachy', source: {kind: 'module', families: ['companion-state', 'companion-speech-state']}, commands: true,
  },
  {
    id: 'roborock', name: 'Roborock', description: 'Observed vacuum state, battery, recorded run and care usage.',
    sizes: ['small', 'medium', 'large'], shapes: ['square'], standard: 'square', generic: ['square'], open: '#/module/roborock/status', source: {kind: 'module', families: ['roborock-vacuum'], content: ['roborock/status', 'roborock/latest-run']}, commands: false,
  },
  {
    id: 'volcano', name: 'Volcano', description: 'Observed heater state, heating timeline, sessions, daily totals and the session threshold.',
    sizes: ['small', 'medium', 'large'], shapes: ['square'], standard: 'square', generic: ['square'], source: {kind: 'module', families: ['volcano-status'], content: ['volcano/timeline', 'volcano/sessions', 'volcano/totals', 'volcano/gaps']}, commands: true,
  },
  {
    id: 'duck-latest', name: 'MicroDuck', description: 'Latest intended meaning from one explicitly selected Reachy–Duck conversation.',
    sizes: ['medium', 'large'], shapes: ['square'], standard: 'square', generic: ['square'], open: '#/module/companions/microduck', source: {kind: 'module', families: ['assistant-state'], content: ['companions/duck-widget', 'companions/companion-history']}, commands: true,
  },
  {
    id: 'timeline', name: 'Timeline', description: 'Retained Hub activity with read-only filters and evidence.',
    sizes: ['medium', 'large'], shapes: ['square', 'wide', 'tall', 'large-square'], standard: 'tall', open: '#/timeline', source: {kind: 'core', families: [], content: ['/api/v2/history']}, commands: false,
  },
  {
    // Reads the capture state and the existing derived feature stream in the browser (#1619); it starts no capture.
    id: 'music-visualizer', name: 'Music visualizer', description: 'A live visualizer of the measured Music audio, in the effect chosen in this browser.',
    sizes: ['medium', 'large'], shapes: ['square', 'wide', 'tall', 'large-square'], standard: 'wide', open: '#/audio/visualizer', source: {kind: 'core', families: ['music-capture-state']}, commands: false,
  },
  {
    id: 'wispr', name: 'Wispr', description: 'Numeric dictation totals from the manually selected collector files.',
    sizes: ['small', 'medium'], shapes: ['square'], standard: 'square', generic: ['square'], open: '#/module/wispr/analytics', source: {kind: 'module', families: [], content: ['wispr/status', 'wispr/summary']}, commands: false,
  },
  {
    id: 'hub-mode', name: 'Hub mode', description: 'The Hub mode and the result of each device\'s mode command.',
    sizes: ['medium', 'large'], shapes: ['square', 'wide', 'tall', 'large-square'], standard: 'wide', source: {kind: 'core', families: ['mode', 'operation']}, commands: true,
  },
  {
    id: 'sessions', name: 'Agent sessions',
    description: 'Agent sessions as compact rows with their names, activity, attention, finished turns and read evidence, synced from the core.',
    sizes: ['medium', 'large'], shapes: ['tall', 'large-square'], standard: 'large-square', source: {kind: 'core', families: ['session']}, commands: true,
  },
  {
    id: 'inbox', name: 'Inbox', description: 'Device commands that failed or whose result is unknown, for a person to decide on.',
    // No Small square: Inbox has no page of its own to hold the rest of the list (owner decision, #1672). Its Standard
    // shape is Wide, so its usual empty state is not a mostly blank Tall card.
    sizes: ['small', 'medium'], shapes: ['wide', 'tall', 'large-square'], standard: 'wide', source: {kind: 'core', families: ['inbox-item']}, commands: false, slot: {story: '#923'},
  },
];

export type Placement = {widget: string; size: WidgetSize; /** The source instance, such as a device; absent for a core-wide widget. */ instance?: string};
export const widgetDefinition = (id: string): WidgetDefinition | undefined => widgetCatalog.find(widget => widget.id === id);

/** Placements whose widget is not in the catalog or whose size it does not declare. */
export function invalidPlacements(placements: readonly Placement[]): Placement[] {
  return placements.filter(placement => {
    const widget = widgetDefinition(placement.widget);
    return widget === undefined || !widget.sizes.includes(placement.size);
  });
}
