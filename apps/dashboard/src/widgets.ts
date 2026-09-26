/** The widget catalog (Hub #277). A widget is one placeable block over one source: a registered controller alias, a hub route such as the monitor or, later, history and automation, or a read-only external source (Hub #287). Device widgets are one source kind, not the model. A widget renders identically wherever it is placed, so moving one between pages is a placement change. Placement is a developer decision here; Hub #366 makes it the owner's from this catalog. */
export type SourceKind='controller'|'hub'|'external';
/** small takes one grid column, medium two and large the whole row; narrow screens collapse every size to one column. */
export type WidgetSize='small'|'medium'|'large';
export type WidgetDefinition={
 /** Stable identifier in lowercase letters, digits and hyphens. */
 id:string;
 name:string;
 description:string;
 /** The sizes the widget renders well at. */
 sizes:readonly WidgetSize[];
 /** The source kind and the hub reads the widget needs, named by route family. */
 source:{kind:SourceKind;needs:readonly string[]};
 /** true when the widget offers explicit command actions; a read-only widget has none. */
 commands:boolean;
};
export const widgetCatalog:readonly WidgetDefinition[]=[
 {id:'component-status',name:'Component',description:'Health, mode, power and brightness of one registered component, its everyday mode and power actions, and a link to its page.',sizes:['small','medium'],source:{kind:'controller',needs:['controllers.snapshot','controllers.integration']},commands:true},
 {id:'attention',name:'Attention',description:'Sessions that are waiting on a question or an approval.',sizes:['small','medium'],source:{kind:'hub',needs:['monitor.sessions']},commands:false},
 {id:'sessions',name:'Sessions',description:'Observed agent sessions as compact rows with their labels, activity, attention, read evidence and retained notices.',sizes:['medium','large'],source:{kind:'hub',needs:['monitor.sessions','dashboard.context']},commands:true},
];
export type Placement={widget:string;size:WidgetSize;/** The source instance, such as a controller alias; absent for a hub-wide widget. */instance?:string};
export const widgetDefinition=(id:string):WidgetDefinition|undefined=>widgetCatalog.find(w=>w.id===id);
/** The home grid: one component widget per registered component, then the hub-wide widgets. Every placement names a catalog widget at one of its declared sizes. */
export function homeLayout(components:readonly {id:string}[]):Placement[]{
 return [...components.map(c=>({widget:'component-status',size:'small' as const,instance:c.id})),{widget:'sessions',size:'medium'},{widget:'attention',size:'small'}];
}
/** Placements whose widget is not in the catalog or whose size it does not declare. */
export function invalidPlacements(placements:readonly Placement[]):Placement[]{
 return placements.filter(p=>{const w=widgetDefinition(p.widget);return !w||!w.sizes.includes(p.size);});
}
