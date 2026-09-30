import {createHash, randomUUID} from 'node:crypto';
import {validDisplayText} from '@jimmie-potts/agent-lifecycle-contracts';
import {validate, type ReceiptV1_1} from '@jimmie-potts/device-contracts';
import type {MomentInput, MomentResult, MomentStart} from './moment-sender.js';
import {id, object, exact} from './common.js';
import type {AutomationStore, LogRow, NewLogRow, RuleRow} from './automation-store.js';

// Hub #358: owner-approved event rules, the interrupt set, event intake, arbitration and hand-off (ADR 0006).

/** A normalized event from an in-process source. `delivery:'replay'` never reaches a rule. */
export type HubEvent = {id:string; source:string; kind:string; alias?:string; agent?:string; task?:string; delivery:'live'|'replay'};
export type EventTrigger = {source:string; kind:string; alias?:string};
export type MomentAction = {mood:string; priorityClass:'event'|'flourish'; durationMs:number; palette?:string[]; targets:string[]};
export type Rule = {id:string; name:string; enabled:boolean; kind:'event'; trigger:EventTrigger; action:MomentAction; createdAtMs:number; updatedAtMs:number};
export type RuleInput = {name:string; kind:'event'; enabled?:boolean; trigger:EventTrigger; action:MomentAction};
export type AutomationSettings = {
  noFlourishes:boolean;
  quietHours:{enabled:boolean; start:string; end:string; timeZone:string|null};
  budgets:{perAgentTask:number; perAgentHour:number; globalHour:number; deviceSpacingMs:number};
};

/** The moment one call hands to the sender, before the start instant; identical for every target of one arbitrated moment. */
export type MomentIntent = Omit<MomentInput,'startAtHubMs'|'toleranceMs'>;
/**
 * The shared moment sender for one target alias: #335's `sendMoment` bound to that alias's controller client at composition.
 * It owns 1.1 negotiation, the controller-clock start, tickets and guards, and applies no policy; this module arbitrates.
 */
export type MomentSender = (target:string, moment:MomentInput) => Promise<MomentResult>;
/**
 * Device-neutral evidence for one target: its presentation, its alert state and whether it can play moments at all
 * (`1.0-only` for a controller that serves only contract 1.0). Unknown never blocks at the hub; an absent `moments` is unknown.
 */
export type TargetState = {presentation:'status'|'content'|'quiet'|'unknown'; alert:'active'|'none'|'unknown'; moments?:'supported'|'unsupported'|'1.0-only'|'unknown'};
export type TargetReader = (alias:string) => Promise<TargetState>;
export type IntakeResult = {accepted:true; matched:number} | {accepted:false; reason:'invalid-event'|'duplicate'|'replay'|'unavailable'};

export const DEFAULT_INTERRUPT_SET: readonly string[] = ['ci.failed','meeting.reminder','pull-request.merged'];
export const DEFAULT_SETTINGS: Readonly<AutomationSettings> = Object.freeze({noFlourishes:false,
  quietHours:{enabled:false,start:'22:00',end:'07:00',timeZone:null},
  budgets:{perAgentTask:1,perAgentHour:2,globalHour:6,deviceSpacingMs:300000}});
export const RULE_LIMIT = 64;
export const START_LEAD_MS = 1000;
const QUEUE_LIMIT = 32, RECENT_LIMIT = 4096, HOUR_MS = 3600000, CLOSE_WAIT_MS = 10000;

export class AutomationError extends Error {
  constructor(readonly code:string, readonly status:number) { super(code); }
}
const fail = (code:string, status = 400): never => { throw new AutomationError(code,status); };

const kindPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){0,3}$/;
const sourcePattern = /^[a-z][a-z0-9-]{0,31}$/;
const eventKind = (value:unknown): value is string => typeof value === 'string' && value.length <= 64 && kindPattern.test(value);
const source = (value:unknown): value is string => typeof value === 'string' && sourcePattern.test(value);
const optional = (value:Record<string,unknown>, key:string, check:(item:unknown)=>boolean) => !Object.hasOwn(value,key) || check(value[key]);
/**
 * An ID that does not look like a credential, for owner- or source-chosen names that are stored. It uses the lifecycle
 * contract's token prefixes, but only at the start of a word, so IDs such as `desk-lamp-glow-effect` stay valid.
 */
const credentialLike = /(?:^|[^A-Za-z0-9])(?:sk-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}/;
const screenedId = (value:unknown): value is string => id(value) && !credentialLike.test(value);
const keysWithin = (value:Record<string,unknown>, required:string[], allowed:string[]) =>
  required.every(key => Object.hasOwn(value,key)) && Object.keys(value).every(key => allowed.includes(key));

export function parseEvent(value:unknown): HubEvent|null {
  if (!object(value) || !keysWithin(value,['id','source','kind','delivery'],['id','source','kind','alias','agent','task','delivery']) ||
      !screenedId(value.id) || !source(value.source) || !eventKind(value.kind) || !['live','replay'].includes(value.delivery as string) ||
      !optional(value,'alias',screenedId) || !optional(value,'agent',id) || !optional(value,'task',id)) return null;
  return {id:value.id,source:value.source,kind:value.kind,...(value.alias === undefined ? {} : {alias:value.alias as string}),
    ...(value.agent === undefined ? {} : {agent:value.agent as string}),...(value.task === undefined ? {} : {task:value.task as string}),delivery:value.delivery as HubEvent['delivery']};
}
function parseTrigger(value:unknown): EventTrigger {
  if (!object(value) || !keysWithin(value,['source','kind'],['source','kind','alias']) || !source(value.source) || !eventKind(value.kind) || !optional(value,'alias',screenedId)) fail('invalid-trigger');
  const trigger = value as Record<string,unknown>;
  return {source:trigger.source as string,kind:trigger.kind as string,...(trigger.alias === undefined ? {} : {alias:trigger.alias as string})};
}
function parseAction(value:unknown, routed:readonly string[]|null): MomentAction {
  if (!object(value) || !keysWithin(value,['mood','priorityClass','durationMs','targets'],['mood','priorityClass','durationMs','palette','targets']) ||
      !screenedId(value.mood) || !['event','flourish'].includes(value.priorityClass as string) ||
      !Number.isInteger(value.durationMs) || (value.durationMs as number) < 1000 || (value.durationMs as number) > 300000 ||
      !optional(value,'palette',item => Array.isArray(item) && item.length >= 1 && item.length <= 8 && item.every(color => typeof color === 'string' && /^#[0-9a-f]{6}$/.test(color))) ||
      !Array.isArray(value.targets) || value.targets.length < 1 || value.targets.length > 16 || !value.targets.every(id) || new Set(value.targets).size !== value.targets.length) fail('invalid-action');
  const action = value as Record<string,unknown>;
  if (routed && (action.targets as string[]).some(target => !routed.includes(target))) fail('unknown-target');
  return {mood:action.mood as string,priorityClass:action.priorityClass as MomentAction['priorityClass'],durationMs:action.durationMs as number,
    ...(action.palette === undefined ? {} : {palette:[...action.palette as string[]]}),targets:[...action.targets as string[]]};
}
/**
 * Validates a create (`enabled` allowed) or update (`enabled` not part of the definition) body. `routed` lists the aliases a
 * new definition may target; stored rows pass null, because a target removed from configuration is logged at arbitration.
 */
export function parseRuleInput(value:unknown, routed:readonly string[]|null, allowEnabled:boolean): RuleInput {
  const allowed = ['name','kind','trigger','action',...(allowEnabled ? ['enabled'] : [])];
  if (!object(value) || !keysWithin(value,['name','kind','trigger','action'],allowed) || value.kind !== 'event' ||
      typeof value.name !== 'string' || !value.name.trim() || !validDisplayText(value.name,80) || !optional(value,'enabled',item => typeof item === 'boolean')) fail('invalid-rule');
  const input = value as Record<string,unknown>;
  return {name:input.name as string,kind:'event',...(input.enabled === undefined ? {} : {enabled:input.enabled as boolean}),
    trigger:parseTrigger(input.trigger),action:parseAction(input.action,routed)};
}
export function parseInterruptSet(value:unknown): string[] {
  if (!object(value) || !exact(value,['kinds']) || !Array.isArray(value.kinds) || value.kinds.length > 64 || !value.kinds.every(eventKind) ||
      new Set(value.kinds).size !== value.kinds.length) fail('invalid-interrupt-set');
  return [...(value as {kinds:string[]}).kinds].sort();
}
const clockTime = (value:unknown) => typeof value === 'string' && /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
const zone = (value:unknown) => {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US',{timeZone:value}); return true; } catch { return false; }
};
const count = (value:unknown, maximum:number) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
export function parseSettings(value:unknown, code = 'invalid-settings'): AutomationSettings {
  if (!object(value) || !exact(value,['noFlourishes','quietHours','budgets']) || typeof value.noFlourishes !== 'boolean' ||
      !object(value.quietHours) || !exact(value.quietHours,['enabled','start','end','timeZone']) || typeof value.quietHours.enabled !== 'boolean' ||
      !clockTime(value.quietHours.start) || !clockTime(value.quietHours.end) || !zone(value.quietHours.timeZone) ||
      !object(value.budgets) || !exact(value.budgets,['perAgentTask','perAgentHour','globalHour','deviceSpacingMs']) ||
      !count(value.budgets.perAgentTask,100) || !count(value.budgets.perAgentHour,1000) || !count(value.budgets.globalHour,1000) ||
      !count(value.budgets.deviceSpacingMs,86400000)) fail(code);
  return structuredClone(value) as AutomationSettings;
}

function ruleFromRow(row:RuleRow): Rule {
  // Stored rows were validated on write; a row that no longer validates is corrupt state, as in agent state.
  try {
    if (row.kind !== 'event' || !id(row.id)) throw new Error();
    const input = parseRuleInput({name:row.name,kind:row.kind,trigger:JSON.parse(row.trigger),action:JSON.parse(row.action)},null,false);
    return {id:row.id,name:input.name,enabled:row.enabled,kind:'event',trigger:input.trigger,action:input.action,createdAtMs:row.createdAtMs,updatedAtMs:row.updatedAtMs};
  } catch { throw new Error('invalid-state'); }
}

/** Minutes past midnight of `atMs` in `timeZone` (the host zone when null). */
function localMinutes(atMs:number, timeZone:string|null): number {
  const parts = new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',...(timeZone ? {timeZone} : {})}).formatToParts(atMs);
  const part = (type:string) => Number(parts.find(item => item.type === type)?.value);
  return part('hour') * 60 + part('minute');
}
export function inQuietHours(settings:AutomationSettings['quietHours'], atMs:number): boolean {
  if (!settings.enabled) return false;
  const minutes = (text:string) => Number(text.slice(0,2)) * 60 + Number(text.slice(3));
  const now = localMinutes(atMs,settings.timeZone), start = minutes(settings.start), end = minutes(settings.end);
  // Equal start and end means the whole day; an end before the start crosses midnight.
  return start === end || (start < end ? now >= start && now < end : now >= start || now < end);
}

const momentId = (rule:Rule, event:HubEvent) => 'm-' + createHash('sha256').update(`${rule.id}\0${event.source}\0${event.id}`).digest('hex').slice(0,40);

/** Stores only allowlisted receipt fields, so a sender result can never add content to the private log. */
function receiptProjection(receipt:ReceiptV1_1) {
  return {apiVersion:receipt.apiVersion,requestId:{epoch:receipt.requestId.epoch,sequence:receipt.requestId.sequence},outcome:receipt.outcome,
    priorEffects:receipt.priorEffects,...(receipt.failure ? {failure:{code:receipt.failure.code}} : {})};
}
const startProjection = (start:unknown): MomentStart|null => validate('momentStart',start) ?
  {domain:'controller-monotonic',epoch:(start as MomentStart).epoch,atMs:(start as MomentStart).atMs,toleranceMs:(start as MomentStart).toleranceMs} : null;
const NOT_SENT: readonly string[] = ['1.0-only','moments-unsupported','unsupported-capability','capacity','unavailable'];

export type LogEntry = {seq:number; atMs:number; ruleId:string; event:{source:string; id:string; kind:string; alias?:string; agent?:string; task?:string};
  momentId:string; priorityClass:string; coversStatus:boolean; target:string; outcome:LogRow['outcome']; reason?:string;
  receipt?:ReturnType<typeof receiptProjection>; failure?:{code:string}; start?:MomentStart};
function entry(row:LogRow): LogEntry {
  const detail = row.detail === null ? {} : JSON.parse(row.detail) as {receipt?:LogEntry['receipt']; failure?:{code:string}; start?:MomentStart};
  return {seq:row.seq,atMs:row.atMs,ruleId:row.ruleId,event:{source:row.eventSource,id:row.eventId,kind:row.eventKind,
    ...(row.eventAlias === null ? {} : {alias:row.eventAlias}),...(row.agent === null ? {} : {agent:row.agent}),...(row.task === null ? {} : {task:row.task})},
    momentId:row.momentId,priorityClass:row.priorityClass,coversStatus:row.coversStatus,target:row.target,outcome:row.outcome,
    ...(row.reason === null ? {} : {reason:row.reason}),...(detail.receipt ? {receipt:detail.receipt} : {}),...(detail.failure ? {failure:detail.failure} : {}),...(detail.start ? {start:detail.start} : {})};
}

export type AutomationOptions = {
  store:AutomationStore;
  /** Aliases the hub routes now; rules may target only these. */
  routed:() => readonly string[];
  targets:TargetReader;
  sender?:MomentSender;
  clock:() => number;
  monotonic:() => number;
  /** False while staged, closing or released: the intake then accepts nothing. */
  active:() => boolean;
};
export type Automation = ReturnType<typeof createAutomation>;

export function createAutomation(options:AutomationOptions) {
  const {store} = options;
  let rules = store.rules().map(ruleFromRow);
  const storedKinds = store.interruptSet();
  if (!storedKinds.every(eventKind)) throw new Error('invalid-state');
  let interruptSet = new Set(storedKinds);
  let settings: AutomationSettings;
  try { settings = parseSettings(store.settings()); } catch { throw new Error('invalid-state'); }
  const recent = new Set<string>();
  const queue: {event:HubEvent; matched:Rule[]}[] = [];
  let running: Promise<void> | undefined, closed = false;
  const reload = () => { rules = store.rules().map(ruleFromRow); };
  const stopped = () => closed || !options.active();
  const matching = (event:HubEvent) => rules.filter(rule => rule.trigger.source === event.source &&
    rule.trigger.kind === event.kind && (rule.trigger.alias === undefined || rule.trigger.alias === event.alias));
  const remember = (key:string) => {
    recent.add(key);
    if (recent.size > RECENT_LIMIT) recent.delete(recent.values().next().value!);
  };

  const logRow = (rule:Rule, event:HubEvent, moment:MomentIntent, target:string, outcome:LogRow['outcome'], reason:string|null, detail:object|null): NewLogRow => ({
    atMs:options.clock(),ruleId:rule.id,eventSource:event.source,eventId:event.id,eventKind:event.kind,eventAlias:event.alias ?? null,
    agent:event.agent ?? null,task:event.task ?? null,momentId:moment.momentId,priorityClass:moment.priorityClass,coversStatus:moment.coversStatus,
    target,outcome,reason,detail:detail === null ? null : JSON.stringify(detail)});
  const intent = (rule:Rule, event:HubEvent): MomentIntent => ({momentId:momentId(rule,event),mood:rule.action.mood,
    ...(rule.action.palette ? {palette:[...rule.action.palette]} : {}),durationMs:rule.action.durationMs,priorityClass:rule.action.priorityClass,
    coversStatus:rule.action.priorityClass === 'event' && interruptSet.has(event.kind)});

  /** Moment-wide checks in ADR 0006 order; null means the moment may proceed to per-target checks. */
  function momentBlock(moment:MomentIntent, event:HubEvent, now:number): string|null {
    const flourish = moment.priorityClass === 'flourish';
    if (flourish && settings.noFlourishes) return 'no-flourishes';
    if (inQuietHours(settings.quietHours,now)) return 'quiet-hours';
    if (!flourish) return null;
    const {budgets} = settings;
    if (event.agent !== undefined && event.task !== undefined && store.handedForTask(event.agent,event.task) >= budgets.perAgentTask) return 'agent-task-budget';
    if (event.agent !== undefined && store.handedFlourishes(now - HOUR_MS,event.agent) >= budgets.perAgentHour) return 'agent-hourly-budget';
    if (store.handedFlourishes(now - HOUR_MS) >= budgets.globalHour) return 'global-hourly-budget';
    return null;
  }
  function targetBlock(moment:MomentIntent, target:string, state:TargetState, now:number): string|null {
    if (state.moments === '1.0-only') return '1.0-only';
    if (state.moments === 'unsupported') return 'moments-unsupported';
    if (moment.priorityClass === 'flourish') {
      const last = store.lastFlourishTo(target);
      if (last !== undefined && now - last < settings.budgets.deviceSpacingMs) return 'device-spacing';
    }
    if (state.presentation === 'quiet') return 'quiet';
    if (state.presentation === 'status' && state.alert === 'active') return 'alert';
    return null;
  }
  const readTarget = async (target:string): Promise<TargetState> => {
    try {
      const state = await options.targets(target);
      if (object(state) && ['status','content','quiet','unknown'].includes(state.presentation) && ['active','none','unknown'].includes(state.alert) &&
          (state.moments === undefined || ['supported','unsupported','1.0-only','unknown'].includes(state.moments)))
        return {presentation:state.presentation,alert:state.alert,moments:state.moments ?? 'unknown'};
    } catch {}
    return {presentation:'unknown',alert:'unknown'};
  };
  const logged = (rule:Rule, event:HubEvent, moment:MomentIntent, target:string, result:PromiseSettledResult<unknown>): NewLogRow => {
    if (result.status === 'rejected') return logRow(rule,event,moment,target,'uncertain','sender-error',null);
    const value = result.value;
    if (!object(value) || value.momentId !== moment.momentId) return logRow(rule,event,moment,target,'uncertain','invalid-result',null);
    const start = startProjection(value.start);
    const extra = start ? {start} : null;
    if (value.kind === 'receipt' && validate('receiptV1_1',value.receipt)) {
      const receipt = value.receipt as ReceiptV1_1;
      return logRow(rule,event,moment,target,'receipt',receipt.failure?.code ?? null,{receipt:receiptProjection(receipt),...extra});
    }
    if (value.kind === 'not-sent' && NOT_SENT.includes(value.reason as string)) {
      // #335 reports the controller's failure as a bare contract code. A value outside those codes is not stored; the reason still is.
      const failure = validate('failureCodeV1_1',value.failure) ? {failure:{code:value.failure as string}} : null;
      return logRow(rule,event,moment,target,'not-sent',value.reason as string,extra || failure ? {...extra,...failure} : null);
    }
    if (value.kind === 'uncertain') return logRow(rule,event,moment,target,'uncertain',null,extra);
    return logRow(rule,event,moment,target,'uncertain','invalid-result',null);
  };

  async function evaluate(rule:Rule, event:HubEvent) {
    const moment = intent(rule,event), now = options.clock();
    const blocked = momentBlock(moment,event,now);
    if (blocked) { store.appendLog(rule.action.targets.map(target => logRow(rule,event,moment,target,'blocked',blocked,null))); return; }
    const routed = options.routed();
    const states = await Promise.all(rule.action.targets.map(target => routed.includes(target) ? readTarget(target) : Promise.resolve(undefined)));
    const rows: NewLogRow[] = [], handed: string[] = [];
    rule.action.targets.forEach((target,index) => {
      const state = states[index];
      const reason = state === undefined ? 'unknown-target' : targetBlock(moment,target,state,options.clock()) ?? (options.sender ? null : 'sender-unavailable');
      if (reason) rows.push(logRow(rule,event,moment,target,'blocked',reason,null));
      else handed.push(target);
    });
    store.appendLog(rows);
    // A hub that began closing or released its state during the target reads sends nothing more.
    if (!handed.length || !options.sender || stopped()) return;
    // One hub-monotonic start instant for every target; devices are independent, and nothing is retried.
    const startAt = options.monotonic() + START_LEAD_MS, sender = options.sender;
    const results = await Promise.allSettled(handed.map(target => Promise.resolve().then(() => sender(target,{...structuredClone(moment),startAtHubMs:startAt}))));
    store.appendLog(handed.map((target,index) => logged(rule,event,moment,target,results[index])));
  }
  async function drain() {
    while (queue.length) {
      // After a release or during shutdown, waiting events are dropped rather than evaluated by a retiring owner.
      if (stopped()) { queue.length = 0; return; }
      const {event,matched} = queue.shift()!;
      for (const queued of matched) {
        if (stopped()) { queue.length = 0; return; }
        // The owner may have disabled, edited or deleted the rule while the event waited: use its current definition.
        const rule = rules.find(current => current.id === queued.id);
        if (!rule?.enabled || !matching(event).includes(rule)) continue;
        // A store released during shutdown ends evaluation. Any other failure drops this rule's moment; nothing is retried.
        try { await evaluate(rule,event); }
        catch { if (closed) return; }
      }
    }
  }
  const schedule = () => { running ??= drain().finally(() => { running = undefined; if (queue.length && !closed) schedule(); }); };

  function create(input:RuleInput, owner:boolean): Rule {
    const now = options.clock();
    const rule: Rule = {id:'rule-' + randomUUID(),name:input.name,enabled:owner ? input.enabled ?? false : false,kind:'event',
      trigger:input.trigger,action:input.action,createdAtMs:now,updatedAtMs:now};
    if (!store.insertRule({...rule,trigger:JSON.stringify(rule.trigger),action:JSON.stringify(rule.action)},RULE_LIMIT)) fail('capacity',429);
    reload();return rule;
  }
  const find = (ruleId:string) => rules.find(rule => rule.id === ruleId) ?? fail('unknown-rule',404);
  const save = (rule:Rule) => { if (!store.replaceRule({...rule,trigger:JSON.stringify(rule.trigger),action:JSON.stringify(rule.action)})) fail('unknown-rule',404); reload(); return rule; };

  return {
    /** The one intake sources call. Synchronous: sources never wait for arbitration or devices. */
    submit(value:unknown): IntakeResult {
      const event = parseEvent(value);
      if (!event) return {accepted:false,reason:'invalid-event'};
      if (event.delivery === 'replay') return {accepted:false,reason:'replay'};
      if (closed || !options.active()) return {accepted:false,reason:'unavailable'};
      const key = `${event.source}:${event.id}`;
      if (recent.has(key)) return {accepted:false,reason:'duplicate'};
      try {
        // Persist every accepted key before evaluation, so a crash or restart never evaluates an event again, including one
        // that matched no rule before a rule for it was created.
        if (!store.recordEvent(key)) { remember(key); return {accepted:false,reason:'duplicate'}; }
      } catch { return {accepted:false,reason:'unavailable'}; }
      remember(key);
      const matched = matching(event).filter(rule => rule.enabled);
      if (!matched.length) return {accepted:true,matched:0};
      if (queue.length >= QUEUE_LIMIT) {
        const rows = matched.flatMap(rule => { const moment = intent(rule,event); return rule.action.targets.map(target => logRow(rule,event,moment,target,'blocked','capacity',null)); });
        try { store.appendLog(rows); } catch {}
        return {accepted:true,matched:matched.length};
      }
      queue.push({event,matched});schedule();
      return {accepted:true,matched:matched.length};
    },
    /** Resolves once every accepted event has been evaluated. */
    async settled() { while (running) await running; },
    rules: () => structuredClone(rules),
    rule: (ruleId:string) => structuredClone(find(ruleId)),
    /**
     * `owner` is true only for the owner's explicit route call; every other creator stores the rule disabled. `authorize`
     * sees the validated targets before anything is stored.
     */
    create(value:unknown, owner:boolean, authorize?:(targets:readonly string[])=>void) {
      const input = parseRuleInput(value,options.routed(),true);
      authorize?.(input.action.targets);
      return structuredClone(create(input,owner));
    },
    update(ruleId:string, value:unknown, authorize?:(targets:readonly string[])=>void) {
      const input = parseRuleInput(value,options.routed(),false), current = find(ruleId);
      authorize?.(input.action.targets);
      return structuredClone(save({...current,name:input.name,trigger:input.trigger,action:input.action,updatedAtMs:options.clock()}));
    },
    setEnabled: (ruleId:string, enabled:boolean) => structuredClone(save({...find(ruleId),enabled,updatedAtMs:options.clock()})),
    remove(ruleId:string) { find(ruleId); if (!store.deleteRule(ruleId)) fail('unknown-rule',404); reload(); },
    interruptSet: () => [...interruptSet].sort(),
    replaceInterruptSet(value:unknown) { const kinds = parseInterruptSet(value); store.replaceInterruptSet(kinds); interruptSet = new Set(kinds); return kinds; },
    settings: () => structuredClone(settings),
    replaceSettings(value:unknown) { const next = parseSettings(value); store.replaceSettings(next); settings = next; return structuredClone(next); },
    log: (limit:number, before?:number) => store.readLog(limit,before).map(entry),
    /**
     * Stops intake, drops waiting events and waits for the current evaluation, at most `CLOSE_WAIT_MS`: the sender's own caps
     * normally settle it sooner. After the bound, a late result can no longer be logged, because the store is released.
     */
    async close() {
      closed = true; queue.length = 0;
      let timer: NodeJS.Timeout | undefined;
      const bound = new Promise<void>(resolve => { timer = setTimeout(resolve,CLOSE_WAIT_MS); });
      await Promise.race([(async () => { while (running) await running; })(),bound]);
      clearTimeout(timer);
    }
  };
}
