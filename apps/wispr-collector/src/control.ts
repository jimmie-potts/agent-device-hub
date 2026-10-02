import { existsSync, readFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { atomicJson } from './publication.js';

export type Control = {
  format: 1; namespace: string; generation: string; dataEpoch: string; textEpoch: number;
  languageEnabled: boolean; cleanupPending: boolean; captureAfter: number | null; revisionFloor: number; changedAt: string;
};
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const controlPath = (directory: string) => join(directory, 'control.json');
export function readControl(directory: string): Control {
  if(statSync(controlPath(directory)).size>4096)throw new Error('invalid-control');
  const raw=readFileSync(controlPath(directory),'utf8');
  if(Buffer.byteLength(raw)>4096)throw new Error('invalid-control');
  const c=JSON.parse(raw) as Control;
  if(Object.keys(c).sort().join(',')!=='captureAfter,changedAt,cleanupPending,dataEpoch,format,generation,languageEnabled,namespace,revisionFloor,textEpoch'||c.format!==1||!uuid(c.namespace)||!uuid(c.generation)||!uuid(c.dataEpoch)||typeof c.languageEnabled!=='boolean'||typeof c.cleanupPending!=='boolean'||!Number.isSafeInteger(c.textEpoch)||c.textEpoch<0||!Number.isSafeInteger(c.revisionFloor)||c.revisionFloor<0||(c.captureAfter!==null&&!Number.isSafeInteger(c.captureAfter))||!Number.isFinite(Date.parse(c.changedAt)))throw new Error('invalid-control');
  return c;
}
export function writeControl(directory: string, value: Control): void { atomicJson(controlPath(directory),value,4096); }
export function initializeControl(directory: string, namespace: string): Control {
  if(existsSync(controlPath(directory)))return readControl(directory);
  if(existsSync(join(directory,'analytics.sqlite')))throw new Error('control-missing');
  const value:Control={format:1,namespace,generation:randomUUID(),dataEpoch:randomUUID(),textEpoch:0,languageEnabled:false,cleanupPending:false,captureAfter:null,revisionFloor:0,changedAt:new Date().toISOString()};
  writeControl(directory,value);return readControl(directory);
}
