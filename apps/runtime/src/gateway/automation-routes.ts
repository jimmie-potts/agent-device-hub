// Hub #925: legacy route shapes from apps/hub/src/automation-routes.ts at bf11587c, using the core's fresh controls.
import {errorBody, isErrorCode, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {statusOf} from '@jimmie-potts/sdk';
import type {AutomationControls} from '../core/automation-part.js';
import {AutomationError} from '../core/automation.js';

export const AUTOMATION_PREFIX = '/api/v2/automation/';
export type AutomationRequest = {
  method: string;
  url: URL;
  /** The gateway bounds JSON and re-admits the original principal after reading it. */
  body(maximumBytes: number): Promise<unknown>;
  /** Rechecks the gateway's scope, origin and request header immediately before every mutation, DELETE included. */
  authorize(): void;
};
export type AutomationAnswer = {status: number; body: object};

const answer = (status: number, body: object): AutomationAnswer => ({status, body: {schema: 'automation/2.0', ...body}});
const invalid = (): never => { throw new AutomationError('invalid-request', 400); };
const safeCode = (code: string): ErrorCode => code === 'unknown-rule' ? 'not-found'
  : code === 'unknown-target' || (code.startsWith('invalid-') && !isErrorCode(code)) ? 'invalid-request'
  : isErrorCode(code) ? code : 'internal';

/** Authentication belongs to the gateway. Unknown routes are left to its normal not-found handling. */
export async function automationRoute(controls: AutomationControls, request: AutomationRequest): Promise<AutomationAnswer | undefined> {
  if (!request.url.pathname.startsWith(AUTOMATION_PREFIX)) return undefined;
  const {method, url} = request;
  const path = url.pathname.slice(AUTOMATION_PREFIX.length);
  const rule = /^rules\/([A-Za-z0-9_.-]{1,128})(?:\/(enable|disable))?$/.exec(path);
  const noQuery = (): void => { if (url.searchParams.size > 0) invalid(); };
  const write = (work: () => AutomationAnswer): AutomationAnswer => {
    request.authorize();
    return work();
  };
  try {
    if (path === 'rules') {
      noQuery();
      if (method === 'GET') return answer(200, {rules: controls.rules()});
      if (method === 'POST') {
        const input = await request.body(8192);
        return write(() => answer(201, controls.create(input, true)));
      }
      return undefined;
    }
    if (rule !== null) {
      noQuery();
      const id = rule[1];
      if (id === undefined) return undefined;
      const action = rule[2];
      if (action !== undefined) {
        if (method !== 'POST') return undefined;
        const input = await request.body(16);
        if (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0) invalid();
        return write(() => answer(200, controls.setEnabled(id, action === 'enable')));
      }
      if (method === 'GET') return answer(200, controls.rule(id));
      if (method === 'PUT') {
        const input = await request.body(8192);
        return write(() => answer(200, controls.update(id, input)));
      }
      if (method === 'DELETE') return write(() => { controls.remove(id); return answer(200, {deleted: true, id}); });
      return undefined;
    }
    if (path === 'interrupt-set') {
      noQuery();
      if (method === 'GET') return answer(200, {kinds: controls.interruptSet()});
      if (method === 'PUT') {
        const input = await request.body(8192);
        return write(() => answer(200, {kinds: controls.replaceInterruptSet(input)}));
      }
      return undefined;
    }
    if (path === 'settings') {
      noQuery();
      if (method === 'GET') return answer(200, controls.settings());
      if (method === 'PUT') {
        const input = await request.body(1024);
        return write(() => answer(200, controls.replaceSettings(input)));
      }
      return undefined;
    }
    if (path === 'log' && method === 'GET') {
      const keys = [...url.searchParams.keys()];
      const limitText = url.searchParams.get('limit'), beforeText = url.searchParams.get('before');
      if (keys.some(key => key !== 'limit' && key !== 'before') || new Set(keys).size !== keys.length ||
          (limitText !== null && !/^[1-9][0-9]{0,2}$/.test(limitText)) ||
          (beforeText !== null && !/^[1-9][0-9]{0,15}$/.test(beforeText))) invalid();
      const limit = limitText === null ? 100 : Number(limitText);
      const before = beforeText === null ? undefined : Number(beforeText);
      if (limit > 500 || (before !== undefined && !Number.isSafeInteger(before))) invalid();
      const entries = controls.log(limit, before), next = entries.at(-1)?.seq;
      return answer(200, {entries, ...(entries.length === limit && next !== undefined ? {next} : {})});
    }
    return undefined;
  } catch (error) {
    if (!(error instanceof AutomationError)) throw error;
    const code = safeCode(error.code);
    return {status: statusOf(code), body: errorBody(code)};
  }
}
