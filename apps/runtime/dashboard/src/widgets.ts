/**
 * The widget catalog (Hub #277). A widget is one placeable block over one source: the core's families, a module's
 * families, or a read-only external source (Hub #287). A widget renders identically wherever it is placed, so moving one
 * between pages is a placement change. Home's editor (#366) extends this core catalog with existing device, lighting,
 * room and Music instances in home-catalog.ts. On the runtime (Hub #922) widgets read named families through sync.
 * Wispr (#927) reads private numeric content on demand; it never joins the broadcast families.
 */
export type SourceKind = 'core' | 'module' | 'external';
/** small takes one grid column, medium two and large the whole row; narrow screens collapse every size to one column. */
export type WidgetSize = 'small' | 'medium' | 'large';
export type WidgetDefinition = {
  /** Stable identifier in lowercase letters, digits and hyphens. */
  id: string;
  name: string;
  description: string;
  /** The sizes the widget renders well at. */
  sizes: readonly WidgetSize[];
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
    id: 'roborock', name: 'Roborock', description: 'Observed vacuum state, battery, recorded run and care usage.',
    sizes: ['small', 'medium', 'large'], source: {kind: 'module', families: ['roborock-vacuum'], content: ['roborock/status', 'roborock/latest-run']}, commands: false,
  },
  {
    id: 'duck-latest', name: 'MicroDuck', description: 'Latest intended meaning from one explicitly selected Reachy–Duck conversation.',
    sizes: ['medium', 'large'], source: {kind: 'module', families: ['assistant-state'], content: ['companions/duck-widget']}, commands: false,
  },
  {
    id: 'timeline', name: 'Timeline', description: 'Retained Hub activity with read-only filters and evidence.',
    sizes: ['medium', 'large'], source: {kind: 'core', families: [], content: ['/api/v2/history']}, commands: false,
  },
  {
    id: 'wispr', name: 'Wispr', description: 'Numeric dictation totals from the manually selected collector files.',
    sizes: ['small', 'medium'], source: {kind: 'module', families: [], content: ['wispr/status', 'wispr/summary']}, commands: false,
  },
  {
    id: 'hub-mode', name: 'Hub mode', description: 'The Hub mode and the result of each device\'s mode command.',
    sizes: ['medium', 'large'], source: {kind: 'core', families: ['mode', 'operation']}, commands: true,
  },
  {
    id: 'sessions', name: 'Agent sessions',
    description: 'Agent sessions as compact rows with their names, activity, attention, finished turns and read evidence, synced from the core.',
    sizes: ['medium', 'large'], source: {kind: 'core', families: ['session']}, commands: true,
  },
  {
    id: 'inbox', name: 'Inbox', description: 'Device commands that failed or whose result is unknown, for a person to decide on.',
    sizes: ['small', 'medium'], source: {kind: 'core', families: ['inbox-item']}, commands: false, slot: {story: '#923'},
  },
];

export type Placement = {widget: string; size: WidgetSize; /** The source instance, such as a device; absent for a core-wide widget. */ instance?: string};
export const widgetDefinition = (id: string): WidgetDefinition | undefined => widgetCatalog.find(widget => widget.id === id);

/**
 * The built-in core placements ("Recommended (d)", owner decision 7, 2026-10-06): the Hub mode and
 * the agent sessions in the wide column, the inbox in the narrow one. Attention is highlighted on each session card. The Wispr port adds its numeric widget there when exposed. Every placement names a
 * catalog widget at one of its declared sizes. The Home editor uses these default sizes until explicitly saved.
 */
export function homeLayout(): {wide: Placement[]; narrow: Placement[]} {
  return {
    wide: [{widget: 'hub-mode', size: 'medium'}, {widget: 'sessions', size: 'medium'}],
    narrow: [{widget: 'inbox', size: 'small'}, {widget: 'wispr', size: 'small'}],
  };
}

/** Placements whose widget is not in the catalog or whose size it does not declare. */
export function invalidPlacements(placements: readonly Placement[]): Placement[] {
  return placements.filter(placement => {
    const widget = widgetDefinition(placement.widget);
    return widget === undefined || !widget.sizes.includes(placement.size);
  });
}
