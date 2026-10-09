import React, {useCallback, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {isErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {REQUEST_HEADER, childOf} from '@jimmie-potts/sdk/remote';
import type {DashboardConnection} from './connection.ts';
import {Badge, Facts} from './ui.tsx';

export type AutomationPageProps = {connection: DashboardConnection; live: boolean; control: boolean};
// The existing core route shapes, kept browser-safe. Importing the Node core's source types pulls in its SQLite graph.
type RuleInput = {name: string; kind: 'event'; enabled?: boolean; trigger: {source: string; kind: string; alias?: string};
  action: {mood: string; priorityClass: 'event' | 'flourish'; durationMs: number; palette?: string[]; targets: string[]}};
type Rule = RuleInput & {id: string; enabled: boolean; createdAtMs: number; updatedAtMs: number};
type AutomationSettings = {noFlourishes: boolean; quietHours: {enabled: boolean; start: string; end: string; timeZone: string | null};
  budgets: {perAgentTask: number; perAgentHour: number; globalHour: number; deviceSpacingMs: number}};
type LogEntry = {seq: number; atMs: number; ruleId: string; target: string; outcome: string; reason?: string; requestId?: string;
  receipt?: {status: 'accepted'; requestId: string}};
const KINDS = ['attention-raised', 'attention-cleared', 'turn-ended', 'session-ended'];
const BUDGETS = [{key: 'perAgentTask', label: 'Per agent task', maximum: 100}, {key: 'perAgentHour', label: 'Per agent hour', maximum: 1000},
  {key: 'globalHour', label: 'Global per hour', maximum: 1000}, {key: 'deviceSpacingMs', label: 'Device spacing (ms)', maximum: 86400000}] as const;
const newRule = (): RuleInput => ({name: '', kind: 'event', trigger: {source: 'core', kind: 'turn-ended'},
  action: {mood: 'celebrate', priorityClass: 'event', durationMs: 1000, targets: []}});
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
type Snapshot = {rules: Rule[]; settings: AutomationSettings; kinds: string[]; entries: LogEntry[]};

class AutomationFailure extends Error {
  readonly uncertain: boolean;
  constructor(message: string, uncertain = false) { super(message); this.uncertain = uncertain; }
}

/** A rule definition never enables on create or changes enabled as a side effect of editing. */
export function automationRuleInput(draft: RuleInput, creating: boolean): RuleInput {
  const definition: RuleInput = {name: draft.name, kind: 'event', trigger: structuredClone(draft.trigger), action: structuredClone(draft.action)};
  return creating ? {...definition, enabled: false} : definition;
}

/** The admission receipt never stands in for a current, qualified tracked operation. */
export function automationOutcome(entry: LogEntry, operations: readonly OperationRecord[], live: boolean): string {
  if (entry.requestId === undefined) return 'No tracked command.';
  if (!live) return 'Operation evidence is stale.';
  const operation = operations.find(item => item.requestId === entry.requestId && item.target === entry.target &&
    item.family === 'moment-play' && item.requestedBy === 'bunny/core');
  if (operation === undefined) return 'No current operation record.';
  if (operation.status === 'accepted') return 'Accepted; awaiting completion.';
  return [operation.status, operation.result, operation.evidence, operation.error?.code].filter(value => value !== undefined).join(' · ');
}

function mutationReply(path: string, method: string, answer: Record<string, unknown>): boolean {
  if (path === 'interrupt-set') return Array.isArray(answer.kinds) && answer.kinds.every(value => typeof value === 'string');
  if (path === 'settings') return typeof answer.noFlourishes === 'boolean' && object(answer.quietHours) && object(answer.budgets);
  if (method === 'DELETE') return answer.deleted === true && typeof answer.id === 'string';
  return typeof answer.id === 'string' && typeof answer.name === 'string' && typeof answer.enabled === 'boolean' && object(answer.trigger) && object(answer.action);
}

/** One authenticated call. Only an explicit control action calls a mutation; nothing retries a lost reply. */
export async function automationRequest(path: string, method = 'GET', body?: object, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const mutation = method !== 'GET';
  const unreliable = (): AutomationFailure => new AutomationFailure(mutation
    ? 'The change has no reliable reply. Refresh current rules before another attempt.' : 'Automation is unavailable. Refresh to read again.', mutation);
  try {
    const response = await fetch(`/api/v2/automation/${path}`, {
      method, credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      headers: {...childOf(undefined), ...(mutation ? {'content-type': 'application/json', [REQUEST_HEADER]: '1'} : {})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}), ...(signal === undefined ? {} : {signal}),
    });
    const answer: unknown = await response.json();
    if (!object(answer)) throw unreliable();
    if (!response.ok) {
      const code = object(answer.error) ? answer.error.code : undefined;
      if (!isErrorCode(code)) throw unreliable();
      if (mutation && (code === 'uncertain-result' || code === 'internal')) throw unreliable();
      throw new AutomationFailure(`Request refused: ${code}.`);
    }
    if (answer.schema !== 'automation/2.0' || (mutation && !mutationReply(path, method, answer))) throw unreliable();
    return answer;
  } catch (error) {
    if (error instanceof AutomationFailure) throw error;
    throw unreliable();
  }
}

export async function readAutomation(signal: AbortSignal): Promise<Snapshot> {
  const [rules, settings, interrupt, log] = await Promise.all(['rules', 'settings', 'interrupt-set', 'log?limit=100'].map(path => automationRequest(path, 'GET', undefined, signal)));
  if (rules === undefined || settings === undefined || interrupt === undefined || log === undefined ||
      !Array.isArray(rules.rules) || !Array.isArray(interrupt.kinds) || !Array.isArray(log.entries) ||
      !object(settings.quietHours) || !object(settings.budgets) || typeof settings.noFlourishes !== 'boolean')
    throw new AutomationFailure('Automation returned an invalid snapshot. Refresh to read again.');
  return {rules: rules.rules as Rule[], settings: {noFlourishes: settings.noFlourishes,
    quietHours: structuredClone(settings.quietHours) as AutomationSettings['quietHours'],
    budgets: structuredClone(settings.budgets) as AutomationSettings['budgets']},
  kinds: interrupt.kinds as string[], entries: log.entries as LogEntry[]};
}

export function AutomationPage({connection, live, control}: AutomationPageProps): React.JSX.Element {
  const state = useSyncExternalStore(connection.subscribe, connection.getState, connection.getState);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [draft, setDraft] = useState(newRule), [editing, setEditing] = useState<string>();
  const [paletteText, setPaletteText] = useState('');
  const [settings, setSettings] = useState<AutomationSettings>(), [kinds, setKinds] = useState('');
  const [status, setStatus] = useState('Loading automation…'), [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [current, setCurrent] = useState(false);
  const mounted = useRef(false), latestRead = useRef(0), controller = useRef<AbortController | undefined>(undefined);
  const inFlight = useRef(false), locked = useRef(false), initialized = useRef(false), liveNow = useRef(live);
  liveNow.current = live;
  const available = live && state.feed === 'connected' && control && state.runtime.control && current && !reading && !busy && !uncertain;
  const writable = useRef(available); writable.current = available;
  const refresh = useCallback(async (resetDrafts = false, resolveUncertainty = false): Promise<void> => {
    if (!liveNow.current || connection.getState().feed !== 'connected') return;
    const generation = ++latestRead.current;
    controller.current?.abort(); const next = new AbortController(); controller.current = next;
    setReading(true); setCurrent(false);
    try {
      const value = await readAutomation(next.signal);
      if (!mounted.current || generation !== latestRead.current || !liveNow.current) return;
      setSnapshot(value); setCurrent(true);
      if (resetDrafts || !initialized.current) { setSettings(value.settings); setKinds(value.kinds.join(', ')); }
      initialized.current = true;
      if (resolveUncertainty) { locked.current = false; setUncertain(false); }
      setStatus('Current rules and settings loaded. Rules run while this page is closed.');
    } catch (error) {
      if (mounted.current && generation === latestRead.current) setStatus(error instanceof AutomationFailure ? error.message : 'Automation is unavailable.');
    } finally {
      if (mounted.current && generation === latestRead.current) setReading(false);
    }
  }, [connection]);
  useEffect(() => {
    mounted.current = true;
    if (live) void refresh();
    return () => { mounted.current = false; latestRead.current += 1; controller.current?.abort(); };
  }, [live, refresh]);

  const mutate = async (path: string, method: string, value?: object, after?: () => void): Promise<void> => {
    const currentState = connection.getState();
    if (!writable.current || inFlight.current || locked.current || currentState.feed !== 'connected' || !currentState.runtime.control) return;
    inFlight.current = true; setBusy(true); setStatus('Saving…');
    try {
      await automationRequest(path, method, value);
      if (!mounted.current) return;
      after?.(); setStatus('Saved. Reading current state…'); await refresh();
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof AutomationFailure && error.uncertain) { locked.current = true; setUncertain(true); }
      setStatus(error instanceof AutomationFailure ? error.message : 'The change has no reliable reply. Refresh before another attempt.');
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const deviceCopies = state.runtime.copies.filter(copy => copy.family === 'device');
  const devices = deviceCopies.flatMap(copy => (copy.records as DeviceRecord[]).filter(record => copy.owner === `bunny/modules/${record.kind}` && record.capabilities.moments.supported)
    .map(record => ({record, current: copy.synced})));
  const targets = [...new Set([...devices.map(({record}) => record.id), ...draft.action.targets])];
  const operationCopy = state.runtime.copies.find(copy => copy.family === 'operation' && copy.owner === 'bunny/core');
  const operations = (operationCopy?.records ?? []) as readonly OperationRecord[];
  const operationLive = live && operationCopy?.synced === true;
  const updateAction = (change: Partial<RuleInput['action']>): void => { setDraft(value => ({...value, action: {...value.action, ...change}})); };
  const quiet = (change: Partial<AutomationSettings['quietHours']>): void => { setSettings(value => value === undefined ? undefined : {...value, quietHours: {...value.quietHours, ...change}}); };
  return <section aria-label="Automation"><header className="page"><h1>Automation</h1></header>
    <p>Live events can start bounded moments. Quiet, active alerts and your interrupt set still take precedence.</p>
    {!control && <p>Your session is read-only.</p>}
    {!live && <p role="status">The connection is unavailable. Saved evidence may be stale.</p>}
    {uncertain && <p role="alert">The last change has no reliable reply. Refresh current rules before another attempt.</p>}
    <div className="actions"><button type="button" className="secondary" disabled={!live || reading || busy}
      onClick={() => { void refresh(true, true); }}>Refresh rules and logs</button></div>
    <p role="status">{status}</p>
    <div className="cards two"><article className="card"><h2>Rules</h2>
      {snapshot?.rules.length === 0 && <p>No rules yet. Create a rule, then enable it explicitly.</p>}
      {snapshot?.rules.map(rule => <article key={rule.id} className="session"><h3>{rule.name} <Badge>{rule.enabled ? 'Enabled' : 'Disabled'}</Badge></h3>
        <p>{rule.trigger.kind} · {rule.action.mood} · {rule.action.targets.join(', ')}</p>
        <div className="actions"><button type="button" className="secondary" disabled={!available} onClick={() => {
          setEditing(rule.id); setDraft(automationRuleInput(rule, false)); setPaletteText(rule.action.palette?.join(', ') ?? '');
        }}>Edit {rule.name}</button>
          <button type="button" disabled={!available} onClick={() => { void mutate(`rules/${encodeURIComponent(rule.id)}/${rule.enabled ? 'disable' : 'enable'}`, 'POST', {}); }}>{rule.enabled ? 'Disable' : 'Enable'} {rule.name}</button>
          <button type="button" className="secondary" disabled={!available} onClick={() => { void mutate(`rules/${encodeURIComponent(rule.id)}`, 'DELETE', undefined, () => {
            if (editing === rule.id) { setEditing(undefined); setDraft(newRule()); setPaletteText(''); }
          }); }}>Delete {rule.name}</button></div>
      </article>)}
    </article><article className="card"><h2>{editing === undefined ? 'Create rule' : 'Edit rule'}</h2>
      <form className="edit wide" onSubmit={event => {
        event.preventDefault(); const palette = paletteText.split(',').map(color => color.trim()).filter(Boolean);
        const {palette: _palette, ...action} = draft.action;
        const definition = {...draft, action: {...action, ...(palette.length === 0 ? {} : {palette})}};
        void mutate(editing === undefined ? 'rules' : `rules/${encodeURIComponent(editing)}`, editing === undefined ? 'POST' : 'PUT',
          automationRuleInput(definition, editing === undefined), () => { setEditing(undefined); setDraft(newRule()); setPaletteText(''); });
      }}>
        <fieldset disabled={!available}><legend className="vh">Rule definition</legend>
          <label>Rule name<input required maxLength={80} value={draft.name} onChange={event => { setDraft({...draft, name: event.target.value}); }}/></label>
          <label>Source<input required value={draft.trigger.source} onChange={event => { setDraft({...draft, trigger: {...draft.trigger, source: event.target.value}}); }}/></label>
          <label>Occurrence<select value={draft.trigger.kind} onChange={event => { setDraft({...draft, trigger: {...draft.trigger, kind: event.target.value}}); }}>
            {!KINDS.includes(draft.trigger.kind) && <option>{draft.trigger.kind}</option>}{KINDS.map(kind => <option key={kind}>{kind}</option>)}</select></label>
          <label>Source alias (optional)<input value={draft.trigger.alias ?? ''} onChange={event => {
            const trigger = {source: draft.trigger.source, kind: draft.trigger.kind};
            setDraft({...draft, trigger: event.target.value === '' ? trigger : {...trigger, alias: event.target.value}});
          }}/></label>
          <label>Moment<select value={draft.action.mood} onChange={event => { updateAction({mood: event.target.value}); }}>
            {!['celebrate', 'setback', 'reminder'].includes(draft.action.mood) && <option>{draft.action.mood}</option>}
            <option value="celebrate">Celebrate</option><option value="setback">Setback</option><option value="reminder">Reminder</option></select></label>
          <label>Priority<select value={draft.action.priorityClass} onChange={event => { updateAction({priorityClass: event.target.value === 'event' ? 'event' : 'flourish'}); }}>
            <option value="event">Event (interrupt set required in Work)</option><option value="flourish">Flourish (budgets apply)</option></select></label>
          <label>Duration (ms)<input type="number" required min={1000} max={10000} step={1} value={draft.action.durationMs}
            onChange={event => { updateAction({durationMs: Number(event.target.value)}); }}/></label>
          <label>Palette (optional, comma-separated #rrggbb)<input value={paletteText} onChange={event => { setPaletteText(event.target.value); }}/></label>
          <div><p>Targets</p>{targets.map(id => <label className="check" key={id}><input type="checkbox" checked={draft.action.targets.includes(id)}
            onChange={event => { updateAction({targets: event.target.checked ? [...draft.action.targets, id] : draft.action.targets.filter(target => target !== id)}); }}/>
            {devices.find(({record}) => record.id === id)?.record.label ?? id}{devices.some(item => item.record.id === id && item.current) ? '' : ' (unavailable)'}</label>)}
            {targets.length === 0 && <p>No device currently advertises moments.</p>}</div>
          <p>New rules are disabled. Enable a saved rule when you want it to run.</p>
          <div className="actions"><button disabled={draft.action.targets.length === 0}>{editing === undefined ? 'Create disabled rule' : 'Save rule'}</button>
            {editing !== undefined && <button type="button" className="secondary" onClick={() => { setEditing(undefined); setDraft(newRule()); setPaletteText(''); }}>Cancel edit</button>}</div>
        </fieldset>
      </form>
    </article></div>
    <div className="cards two"><article className="card"><h2>Interrupt set</h2><p>Work moments can cover status only for event kinds in this set.</p>
      <form className="edit" onSubmit={event => { event.preventDefault(); void mutate('interrupt-set', 'PUT', {kinds: kinds.split(/[\s,]+/).filter(Boolean)}); }}>
        <fieldset disabled={!available}><legend className="vh">Interrupt set</legend><label>Interrupt kinds<input value={kinds} onChange={event => { setKinds(event.target.value); }}/></label>
          <button>Save interrupt set</button></fieldset></form>
    </article><article className="card"><h2>Quiet hours and budgets</h2>
      <form className="edit wide" onSubmit={event => { event.preventDefault(); if (settings !== undefined) void mutate('settings', 'PUT', settings); }}>
        <fieldset disabled={!available || settings === undefined}><legend className="vh">Automation settings</legend>
          <label className="check"><input type="checkbox" checked={settings?.noFlourishes ?? false} onChange={event => { setSettings(value => value === undefined ? undefined : {...value, noFlourishes: event.target.checked}); }}/>Disable flourishes</label>
          <label className="check"><input type="checkbox" checked={settings?.quietHours.enabled ?? false} onChange={event => { quiet({enabled: event.target.checked}); }}/>Enable quiet hours</label>
          <label>Quiet hours start<input type="time" required value={settings?.quietHours.start ?? ''} onChange={event => { quiet({start: event.target.value}); }}/></label>
          <label>Quiet hours end<input type="time" required value={settings?.quietHours.end ?? ''} onChange={event => { quiet({end: event.target.value}); }}/></label>
          <label>Time zone (blank uses host)<input value={settings?.quietHours.timeZone ?? ''} onChange={event => { quiet({timeZone: event.target.value === '' ? null : event.target.value}); }}/></label>
          {BUDGETS.map(({key, label, maximum}) => <label key={key}>{label}<input type="number" required min={0} max={maximum} step={1} value={settings?.budgets[key] ?? ''}
            onChange={event => { const value = Number(event.target.value); setSettings(current => current === undefined ? undefined : {...current, budgets: {...current.budgets, [key]: value}}); }}/></label>)}
          <button>Save settings</button>
        </fieldset></form>
    </article></div>
    <article className="card"><h2>Recent moments</h2><p>The latest 100 entries. Admission and completion are separate; transmitted effects are not physical observation.</p>
      {snapshot?.entries.length === 0 && <p>No moment evaluations yet.</p>}
      <ol>{snapshot?.entries.map(entry => <li key={entry.seq}><Facts items={[
        ['Time', new Date(entry.atMs).toLocaleString()], ['Rule', snapshot.rules.find(rule => rule.id === entry.ruleId)?.name ?? entry.ruleId],
        ['Target', entry.target], ['Admission', entry.receipt?.status ?? entry.outcome], ['Policy', entry.reason ?? '—'],
        ['Operation', automationOutcome(entry, operations, operationLive)],
      ]}/></li>)}</ol>
    </article>
  </section>;
}
