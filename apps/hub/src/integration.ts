import {validate} from '@jimmie-potts/device-contracts';
import {apiVersion, ticket, validateRequest} from './vendor/nanoleaf-integration.js';
import {object, id} from './common.js';

type Check = (value:unknown) => boolean;
const shape = (value:unknown, required:Record<string,Check>, optional:Record<string,Check> = {}): boolean => object(value) &&
  Object.keys(required).every(k => Object.hasOwn(value,k)) && Object.keys(value).every(k => Object.hasOwn(required,k) || Object.hasOwn(optional,k)) &&
  Object.entries(value).every(([k,v]) => (required[k] ?? optional[k])(v));
const one = (...values:unknown[]):Check => value => values.includes(value);
const list = (check:Check, maximum:number):Check => value => Array.isArray(value) && value.length <= maximum && value.every(check);
const matches = (expression:RegExp):Check => value => typeof value === 'string' && expression.test(value);
const project:Check = matches(/^project-[a-f0-9]{64}(?![\s\S])/);
const nullableProject:Check = value => value === null || project(value);
const task:Check = matches(/^task-[a-f0-9]{64}(?![\s\S])/);
const line:Check = matches(/^[0-9]{1,5}:[0-9]{1,5}(?![\s\S])/);
const count:Check = value => Number.isSafeInteger(value) && (value as number) >= 0;
const settings:Check = value => shape(value,{}, {style:one('classic','project'),coverage:one('whole','status')});
const element:Check = value => shape(value,{id:line},{projectId:nullableProject,signature:one(0,1)});
const identity:Check = value => shape(value,{provider:one('codex','claude'),client:one('cli','desktop','code'),hostId:id,sourceId:id,sessionId:id});
const sceneId:Check = matches(/^scene-[a-f0-9]{64}(?![\s\S])/);
// User-chosen Nanoleaf app names within the shared 80-character label bound, exactly as the source emits them; never titles or paths.
const sceneName:Check = value => typeof value === 'string' && [...value].length >= 1 && [...value].length <= 80;
const scene:Check = value => shape(value,{id:sceneId},{name:sceneName});
const failure:Check = value => shape(value,{code:one('unauthenticated','forbidden','unsupported-capability','invalid-request','unknown-device','revision-conflict','stale-generation','request-conflict','request-expired','request-order','capacity','external-control','transport-failure','uncertain-result')});

export const validateIntegrationReceipt:Check = value => shape(value,{
  apiVersion:one(apiVersion),requestId:ticket,outcome:one('queued','applied','failed','cancelled'),priorEffects:one('none','configuration'),physicalOutcome:one('unknown')
},{failure}) && object(value) && (value.outcome === 'applied' ? value.priorEffects === 'configuration' : value.priorEffects === 'none');

/** Closed validation at the native boundary; unknown fields never reach clients. */
export const validateIntegrationSnapshot:Check = value => shape(value,{
  apiVersion:one(apiVersion),identity:v => validate('identity',v),configurationRevision:count,
  revision:matches(/^[a-f0-9]{64}(?![\s\S])/),mode:one('Work','Quiet','Free'),settings,source:one('legacy','shared'),
  projects:list(v => shape(v,{id:project,color:matches(/^#[a-fA-F0-9]{6}(?![\s\S])/ )},{sharedProjectId:id}),1000),
  tasks:list(v => shape(v,{id:task,projectId:nullableProject,overrideProjectId:nullableProject},{sharedIdentity:identity}),1000),
  elements:list(v => shape(v,{id:line,projectId:nullableProject,signature:one(0,1)}),300),
  wallPending:v => v === null || shape(v,{settings,elements:list(element,300),tasks:list(t => shape(t,{taskId:task,projectId:nullableProject}),1000)}),
  pending:list(validateRequest,1),outcomes:list(validateIntegrationReceipt,32),nextRequestId:ticket,
  // codex-nanoleaf#113: a device other than the Lines, such as the Panels, is read-only and marks the four configuration operations unsupported.
  capabilities:v => shape(v,Object.fromEntries(['settings.set','elements.assign','task.assign','project.color'].map(k => [k,(c:unknown) => shape(c,{supported:one(true,false),scope:one('control')})]).concat([
    ['mode.set',(c:unknown) => shape(c,{supported:one(true),scope:one('control'),route:one('/controller/v1/commands')})]
  ]))),
  limits:v => shape(v,{maxItems:one(1000),maxPending:one(1),maxReceipts:one(256),maxBodyBytes:one(65536)})
},{
  // Nanoleaf #64: discovered saved scenes; ids match the shared v1 `scenes` capability.
  scenes:list(scene,256)
});

const finite:Check = value => typeof value === 'number' && Number.isFinite(value);
const point:Check = value => Array.isArray(value) && value.length === 2 && value.every(finite);
const zone:Check = value => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 65535;
const node:Check = value => shape(value,{id:matches(/^[0-9]{1,5}(?![\s\S])/),x:finite,y:finite});
const geometryElement:Check = value => shape(value,{id:v => typeof v === 'string',number:count,zones:v => Array.isArray(v) && v.every(zone),
  points:v => v === null || (Array.isArray(v) && v.length === 3 && v.every(point))});

/** Closed validation of Nanoleaf's read-only `GET /geometry`: saved elements in the wall map's display coordinates. */
export const validateIntegrationGeometry:Check = value => {
  // The owner's identity has exactly four keys; the shared schema's optional label is not part of this contract.
  if (!shape(value,{apiVersion:one(apiVersion),identity:v => validate('identity',v) && object(v) && !Object.hasOwn(v,'label'),kind:one(null,'lines','panels'),
    elements:list(geometryElement,300),connectors:v => v === null || shape(v,{nodes:list(node,600),lines:list(l => shape(l,{id:v => typeof v === 'string',a:id,b:id}),300)})}) || !object(value)) return false;
  const elements = value.elements as {id:string;number:number;zones:number[];points:unknown}[];
  const connectors = value.connectors as {nodes:{id:string}[];lines:{id:string;a:string;b:string}[]}|null;
  if (value.kind === null) return elements.length === 0 && connectors === null;
  // A Line has two zones and a triangle one; its id is its zones in ascending order.
  const size = value.kind === 'lines' ? 2 : 1, drawn = elements[0]?.points !== null, ids = new Set<string>();
  const valid = elements.every((e,index) => {
    const ok = e.number === index + 1 && e.zones.length === size && new Set(e.zones).size === size && (e.points === null) !== drawn &&
      e.id === [...e.zones].sort((a,b) => a - b).join(':') && !ids.has(e.id);
    ids.add(e.id);return ok;
  });
  if (!valid || connectors === null) return valid;
  const nodes = new Set(connectors.nodes.map(n => n.id));
  return value.kind === 'lines' && connectors.nodes.length > 0 && nodes.size === connectors.nodes.length && connectors.lines.length === elements.length &&
    connectors.lines.every((l,index) => l.id === elements[index].id && nodes.has(l.a) && nodes.has(l.b) && l.a !== l.b);
};
