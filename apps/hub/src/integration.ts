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
  capabilities:v => shape(v,Object.fromEntries(['settings.set','elements.assign','task.assign','project.color'].map(k => [k,(c:unknown) => shape(c,{supported:one(true),scope:one('control')})]).concat([
    ['mode.set',(c:unknown) => shape(c,{supported:one(true),scope:one('control'),route:one('/controller/v1/commands')})]
  ]))),
  limits:v => shape(v,{maxItems:one(1000),maxPending:one(1),maxReceipts:one(256),maxBodyBytes:one(65536)})
},{
  // Nanoleaf #64: discovered saved scenes; ids match the shared v1 `scenes` capability.
  scenes:list(scene,256)
});
