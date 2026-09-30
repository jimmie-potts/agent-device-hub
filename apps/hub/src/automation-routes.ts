import {HttpError, object, exact} from './common.js';
import {AutomationError, type Automation} from './automation.js';

export const AUTOMATION_PREFIX = '/api/automation/v1/';

type Request = {
  method: string;
  url: URL;
  /** The authorized caller's device grants. The hub's shared guard already checked scope, origin and `X-Pixoo-Request`. */
  devices: readonly string[];
  /** Reads a bounded JSON body and re-checks that the caller is still live. */
  body: (maximum: number) => Promise<unknown>;
  /** False while the hub is a staged migration destination or has released its state. */
  writable: boolean;
};

const RULE_BYTES = 8192;

/**
 * Hub #358 typed routes. Returns undefined for a path this module does not serve, so the caller answers `not-found`.
 * Creating, updating or enabling a rule needs every target in the caller's `devices`: a token cannot automate a device
 * it cannot command. Disabling and deleting only reduce automation and need no device grant.
 */
export async function automationRoute(automation: Automation, request: Request): Promise<{status:number; body:unknown}|undefined> {
  const {method, url} = request;
  const path = url.pathname.slice(AUTOMATION_PREFIX.length);
  const rule = /^rules\/([A-Za-z0-9_.-]{1,128})(?:\/(enable|disable))?$/.exec(path);
  const noQuery = [...url.searchParams.keys()].length === 0;
  const write = async <T>(work: () => Promise<T>|T): Promise<T> => {
    if (!request.writable) throw new HttpError('owner-quiesced',503);
    try { return await work(); }
    catch (error) { if (error instanceof AutomationError) throw new HttpError(error.code,error.status); throw error; }
  };
  const read = <T>(work: () => T): T => {
    try { return work(); }
    catch (error) { if (error instanceof AutomationError) throw new HttpError(error.code,error.status); throw error; }
  };
  const granted = (targets: readonly string[]) => { if (targets.some(target => !request.devices.includes(target))) throw new HttpError('forbidden',403); };
  const empty = async () => { const value = await request.body(16); if (!object(value) || !exact(value,[])) throw new HttpError('invalid-input',400); };

  if (path === 'rules') {
    if (!noQuery) throw new HttpError('invalid-input',400);
    if (method === 'GET') return {status:200,body:{rules:automation.rules()}};
    if (method === 'POST') return write(async () => {
      const value = await request.body(RULE_BYTES);
      return {status:201,body:automation.create(value,true,granted)};
    });
    return undefined;
  }
  if (rule) {
    if (!noQuery) throw new HttpError('invalid-input',400);
    const [,ruleId,action] = rule;
    if (action) {
      if (method !== 'POST') return undefined;
      return write(async () => {
        await empty();
        if (action === 'enable') granted(automation.rule(ruleId).action.targets);
        return {status:200,body:automation.setEnabled(ruleId,action === 'enable')};
      });
    }
    if (method === 'GET') return {status:200,body:read(() => automation.rule(ruleId))};
    if (method === 'PUT') return write(async () => {
      const value = await request.body(RULE_BYTES);
      return {status:200,body:automation.update(ruleId,value,granted)};
    });
    if (method === 'DELETE') return write(() => { automation.remove(ruleId); return {status:200,body:{deleted:true,id:ruleId}}; });
    return undefined;
  }
  if (path === 'interrupt-set') {
    if (!noQuery) throw new HttpError('invalid-input',400);
    if (method === 'GET') return {status:200,body:{kinds:automation.interruptSet()}};
    if (method === 'PUT') return write(async () => ({status:200,body:{kinds:automation.replaceInterruptSet(await request.body(8192))}}));
    return undefined;
  }
  if (path === 'settings') {
    if (!noQuery) throw new HttpError('invalid-input',400);
    if (method === 'GET') return {status:200,body:automation.settings()};
    if (method === 'PUT') return write(async () => ({status:200,body:automation.replaceSettings(await request.body(1024))}));
    return undefined;
  }
  if (path === 'log' && method === 'GET') {
    const keys = [...url.searchParams.keys()];
    const limitText = url.searchParams.get('limit'), beforeText = url.searchParams.get('before');
    if (keys.some(key => !['limit','before'].includes(key)) || new Set(keys).size !== keys.length ||
        (limitText !== null && !/^[1-9][0-9]{0,2}$/.test(limitText)) || (beforeText !== null && !/^[1-9][0-9]{0,15}$/.test(beforeText))) throw new HttpError('invalid-input',400);
    const limit = limitText === null ? 100 : Number(limitText);
    if (limit > 500 || (beforeText !== null && !Number.isSafeInteger(Number(beforeText)))) throw new HttpError('invalid-input',400);
    const entries = automation.log(limit,beforeText === null ? undefined : Number(beforeText));
    return {status:200,body:{entries,...(entries.length === limit ? {next:entries.at(-1)!.seq} : {})}};
  }
  return undefined;
}
