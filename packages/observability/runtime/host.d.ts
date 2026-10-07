import type {Tracer} from '@opentelemetry/api';
import type {DiagnosticRecord,Primitive,SchemaVersion} from '../dist/index.js';
export type HostOperation={scope:string;operation:string;spanName?:string;attributes?:Record<string,Primitive>;root?:boolean;traceparent?:unknown;authenticated?:boolean;owned?:boolean;outcome?:(value:unknown)=>string};
export type HostDiagnostics={
 emit(record:DiagnosticRecord):boolean;
 event(eventName:string,scope?:string,attributes?:Record<string,Primitive>,severity?:string):boolean;
 tracerFor(binding:{resource:Record<string,string>|((name:string,options:unknown)=>Record<string,string>);scope:string|((name:string,options:unknown)=>string)}):Pick<Tracer,'startSpan'>|undefined;
 run<T>(operation:HostOperation,action:()=>T|Promise<T>):Promise<T>;
 counts():Record<string,unknown>;
 shutdown():Promise<void>;
};
export function streamSink(stream:{write(line:string,callback:(error?:Error|null)=>void):unknown}):(line:string,signal?:AbortSignal)=>Promise<void>;
export function createHostDiagnostics(options?:{enabled?:boolean;resource?:Record<string,string>;tracing?:boolean;samplingRatio?:number;collectorOrigin?:string;localSink?:(line:string,signal:AbortSignal)=>unknown;localSpanSink?:(line:string,signal:AbortSignal)=>unknown;globalContext?:boolean;schemaVersion?:SchemaVersion;queueOptions?:{maxRecords?:number;maxBytes?:number;flushMs?:number;minimumSeverity?:number}}):Promise<HostDiagnostics>;
