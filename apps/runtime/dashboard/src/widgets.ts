/**
 * The widget catalog (Hub #277). A widget is one placeable block over one source: the core's families, a module's
 * families, or a read-only external source (Hub #287). A widget renders identically wherever it is placed, so moving one
 * between pages is a placement change. Placement is a developer decision here; Hub #366 makes it the owner's from this
 * catalog. On the runtime (Hub #922) a widget names the families it reads through sync, never a polled route.
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
  /** The source kind and the families the widget reads. */
  source: {kind: SourceKind; families: readonly string[]};
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
  {
    id: 'attention', name: 'Attention', description: 'Sessions that are waiting on a question, input or an approval.',
    sizes: ['small', 'medium'], source: {kind: 'core', families: ['session']}, commands: false,
  },
];

export type Placement = {widget: string; size: WidgetSize; /** The source instance, such as a device; absent for a core-wide widget. */ instance?: string};
export const widgetDefinition = (id: string): WidgetDefinition | undefined => widgetCatalog.find(widget => widget.id === id);

/**
 * The home, as the owner-approved mockup lays it out ("Recommended (d)", owner decision 7, 2026-10-06): the Hub mode and
 * the agent sessions in the wide column, the inbox and the attention summary in the narrow one. Every placement names a
 * catalog widget at one of its declared sizes.
 */
export function homeLayout(): {wide: Placement[]; narrow: Placement[]} {
  return {
    wide: [{widget: 'hub-mode', size: 'medium'}, {widget: 'sessions', size: 'medium'}],
    narrow: [{widget: 'inbox', size: 'small'}, {widget: 'attention', size: 'small'}],
  };
}

/** Placements whose widget is not in the catalog or whose size it does not declare. */
export function invalidPlacements(placements: readonly Placement[]): Placement[] {
  return placements.filter(placement => {
    const widget = widgetDefinition(placement.widget);
    return widget === undefined || !widget.sizes.includes(placement.size);
  });
}
