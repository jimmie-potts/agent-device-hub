/** Native-client contract only. This module never sends or retries a request. */
export const apiVersion = 'nanoleaf.integration/1.0';
export type Ticket = {epoch: string; sequence: number};
export type Command =
  | {kind: 'settings.set'; style?: 'classic' | 'project'; coverage?: 'whole' | 'status'}
  | {kind: 'elements.assign'; elements: {id: string; projectId?: string | null; signature?: 0 | 1}[]}
  | {kind: 'task.assign'; taskId: string; projectId: string | null}
  | {kind: 'project.color'; projectId: string; color: string};
export type Request = {apiVersion: typeof apiVersion; controllerId: string; deviceId: string;
  requestId: Ticket; expectedRevision: string; command: Command};
export type Receipt = {apiVersion: typeof apiVersion; requestId: Ticket;
  outcome: 'queued' | 'applied' | 'failed' | 'cancelled'; priorEffects: 'none' | 'configuration';
  physicalOutcome: 'unknown'; failure?: {code: string}};

const object = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, any>, keys: string[]) => Object.keys(v).sort().join(',') === keys.sort().join(',');
const match = (v: unknown, regex: RegExp) => typeof v === 'string' && !/[\r\n]/.test(v) && regex.test(v);
const ref = (v: unknown, kind: string, nullable = false) => nullable && v === null || match(v, new RegExp('^' + kind + '-[a-f0-9]{64}$'));
export const ticket = (v: unknown): v is Ticket => object(v) && exact(v, ['epoch', 'sequence']) && match(v.epoch, /^[a-f0-9]{32}$/) && Number.isSafeInteger(v.sequence) && v.sequence >= 0;

export function validateRequest(v: unknown): v is Request {
  if (!object(v) || !exact(v, ['apiVersion','controllerId','deviceId','requestId','expectedRevision','command']) || v.apiVersion !== apiVersion || !ticket(v.requestId)
      || !match(v.controllerId, /^[A-Za-z0-9_.-]{1,128}$/) || !match(v.deviceId, /^[A-Za-z0-9_.-]{1,128}$/)
      || !match(v.expectedRevision, /^[a-f0-9]{64}$/) || !object(v.command)) return false;
  const c = v.command;
  switch (c.kind) {
    case 'settings.set':
      return Object.keys(c).length >= 2 && Object.keys(c).every(k => ['kind','style','coverage'].includes(k))
        && (!('style' in c) || ['classic','project'].includes(c.style)) && (!('coverage' in c) || ['whole','status'].includes(c.coverage));
    case 'elements.assign': {
      if (!exact(c, ['kind','elements']) || !Array.isArray(c.elements) || c.elements.length < 1 || c.elements.length > 300) return false;
      const seen = new Set();
      return c.elements.every(e => {
        if (!object(e) || Object.keys(e).length < 2 || !Object.keys(e).every(k => ['id','projectId','signature'].includes(k)) || !match(e.id, /^[0-9]{1,5}:[0-9]{1,5}$/) || seen.has(e.id)
          || 'projectId' in e && !ref(e.projectId, 'project', true) || 'signature' in e && ![0,1].includes(e.signature)) return false;
        seen.add(e.id); return true;
      });
    }
    case 'task.assign': return exact(c, ['kind','taskId','projectId']) && ref(c.taskId, 'task') && ref(c.projectId, 'project', true);
    case 'project.color': return exact(c, ['kind','projectId','color']) && ref(c.projectId, 'project') && match(c.color, /^#[a-fA-F0-9]{6}$/);
    default: return false;
  }
}

export function configurationResult(receipt: Receipt): 'pending' | 'saved' | 'refresh' | 'stopped' {
  // A saved configuration never establishes physical delivery. A lost response
  // requires receipt lookup using the original ticket, never a fresh write.
  switch (receipt.outcome) {
    case 'queued': return 'pending';
    case 'applied': return 'saved';
    case 'failed': return 'refresh';
    case 'cancelled': return 'stopped';
  }
}
