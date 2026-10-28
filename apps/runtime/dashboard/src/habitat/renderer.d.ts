import type {ConversationDestination,presentation} from './session.ts';
export type ResidentData=ReturnType<typeof presentation>;
export type RendererSnapshot={ready:boolean;selected:number;frameCount:number;agents:{id:number;name:string;state:string;liveBound:boolean;liveResident:boolean;liveUncertain:boolean;room:string;targetRoom:string}[]};
export type HabitatRenderer={ready:Promise<boolean>;snapshot:()=>RendererSnapshot;apply:(id:number,data:ResidentData)=>void;unassigned:(id:number)=>void;unbind:(id:number)=>void;select:(id:number)=>void;refresh:()=>void;destroy:()=>void};
export function mountHabitat(root:HTMLElement,callbacks:{destination:(id:number)=>ConversationDestination;selected:(id:number)=>void;unavailable:()=>void}):HabitatRenderer|null;
