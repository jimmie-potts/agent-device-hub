import React, {useEffect, useRef} from 'react';
import type {LightingGroup, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {useAttempt, type TrackedCommand} from './command-control.tsx';
import {lightCapabilities, memberPower, type GroupGuards, type LightingDevice, type PlugDevice} from './lighting.ts';
import {wemoCardState} from './wemo.ts';
import {newerRequest} from './requested.ts';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';

/**
 * A group's panel on Home (#1933, the Clear reference): its name, one All on or All off control, Ungroup, and its members
 * with their switches. Lights and plugs both appear. Every switch, and All on or All off, sends each member its own
 * existing power command with that member's guards (`memberPower`); there is no group command. A member a guard blocks
 * is not sent and says why, and the others still switch. Each member's switch shows its newest power (its observation,
 * or a power request that succeeded after its last report, said so in its state line) and, when its last
 * command needs attention (refused, not sent, no answer yet, uncertain), that result, so the panel never shows the
 * whole group as switched on the strength of the requests alone. Read-only sessions can neither switch nor ungroup.
 */
export type GroupPanelProps = {
  id: string; name: string; group: Pick<LightingGroup, 'devices' | 'plugs'>;
  devices: readonly LightingDevice[]; plugs: readonly PlugDevice[];
  control: boolean; operations: readonly OperationRecord[]; operationsLive: boolean;
  /** Ungroups, or undefined while the layout cannot be saved. */
  ungroup: (() => void) | undefined;
  handle: React.ReactNode; options: React.ReactNode;
  /** A status about the card's arrangement, such as stale layout records, shown inside the panel (as #1932's light card). */
  notice?: string;
};
type Member = {id: string; name: string; plug: boolean; power: boolean | undefined; state: string};
type Commands = Map<string, TrackedCommand>;
/** Results that need the operator's attention: anything but no command or a completed success. */
const attention = (command: TrackedCommand): boolean => command.phase.kind !== 'none' &&
  (command.phase.kind !== 'completed' || command.phase.result !== 'succeeded');

/**
 * A member's power as its switch shows it: the newest of its observation and its latest power request that succeeded
 * after its last report (`requested.ts`, as the ring dial and the plug panel show it), which a press switches away from.
 * The state line says which one it is; a guard that blocks the member shows instead.
 */
function memberOf(id: string, group: GroupPanelProps['group'], devices: readonly LightingDevice[], plugs: readonly PlugDevice[], control: boolean, operations: readonly OperationRecord[], operationsLive: boolean, now: number): Member {
  const word = (value: boolean | undefined): string => value === undefined ? 'unknown' : value ? 'on' : 'off';
  const newest = (record: DeviceRecord, observed: boolean | undefined): {power: boolean | undefined; requested: string | undefined} => {
    const requested = newerRequest(record, operations, 'power-set') && record.desired.power.status === 'known' ? record.desired.power.value : undefined;
    return {power: requested ?? observed, requested: requested !== undefined && requested !== observed ? `Requested ${word(requested)} · observed ${word(observed)}` : undefined};
  };
  const plug = group.plugs?.find(item => item.device === id);
  if (plug !== undefined) {
    const found = plugs.filter(item => item.record.id === id && item.owner === plug.owner);
    const record = found.length === 1 ? found[0] : undefined;
    if (record === undefined) return {id, name: id, plug: true, power: undefined, state: 'Unavailable'};
    const view = wemoCardState(record.record, record.live, control, operationsLive, false, now), {power, requested} = newest(record.record, view.power);
    return {id, name: record.record.label ?? id, plug: true, power: view.status === '' || view.status === 'Read-only' ? power : undefined,
      state: view.status !== '' && view.status !== 'Read-only' ? view.status : requested ?? (view.power === true ? 'On' : 'Off')};
  }
  const light = devices.filter(item => item.record.id === id), record = light.length === 1 ? light[0]?.record : undefined;
  if (record === undefined) return {id, name: id, plug: false, power: undefined, state: 'Unavailable'};
  const current = light[0]?.live === true && record.availability === 'available' && record.observed.status === 'known' ? record.observed : undefined;
  const observed = current?.power.status === 'known' ? current.power.value : undefined;
  if (lightCapabilities([id], devices, true, true).blocked !== undefined) return {id, name: record.label ?? id, plug: false, power: undefined, state: light[0]?.live === true ? 'Unavailable' : 'Stale'};
  const {power, requested} = newest(record, observed);
  return {id, name: record.label ?? id, plug: false, power,
    state: requested ?? (observed === undefined ? 'Unknown' : observed ? `On${current?.brightness.status === 'known' ? ` · ${String(current.brightness.value)}%` : ''}` : 'Off')};
}

function Binding({target, operations, operationsLive, commands, changed}: {target: string; operations: readonly OperationRecord[]; operationsLive: boolean; commands: Commands; changed: () => void}): null {
  const command = useAttempt(target, operations, operationsLive);
  commands.set(target, command);
  useEffect(changed, [command.phase, command.locked, command.requestId, changed]);
  useEffect(() => () => {commands.delete(target);}, [commands, target]);
  return null;
}

/**
 * A held key repeats and a double click is two clicks, and a command can finish between them; each would send every
 * member another command. Only the first press of a key and the first click of a series act.
 */
const once = (event: React.KeyboardEvent<HTMLButtonElement>): void => {if (event.repeat) event.preventDefault();};

const icon = (plug: boolean): React.JSX.Element => <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">{plug
  ? <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
  : <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>}</svg>;

export function GroupPanel({id, name, group, devices, plugs, control, operations, operationsLive, ungroup, handle, options, notice}: GroupPanelProps): React.JSX.Element {
  const commands = useRef<Commands>(new Map()).current;
  const [, render] = React.useState(0);
  const changed = React.useMemo(() => () => {render(value => value + 1);}, []);
  const now = Date.now();
  const members = group.devices.map(member => memberOf(member, group, devices, plugs, control, operations, operationsLive, now));
  const guards = (): GroupGuards => ({control, operationsLive, now: Date.now(), locks: new Set(group.devices.filter(id => commands.get(id)?.locked !== false))});
  const send = (id: string, on: boolean): void => {
    const action = memberPower(group, id, devices, plugs, on, guards(), () => crypto.randomUUID());
    void commands.get(id)?.run(action);
  };
  // All off while any member is on (as its switch shows it); All on otherwise.
  const anyOn = members.some(member => member.power === true), all = !anyOn;
  const problems = members.flatMap(member => {const command = commands.get(member.id);return command !== undefined && attention(command) ? [`${member.name}: ${command.text}`] : [];});
  const count = `${String(members.length)} ${members.every(member => member.plug) ? 'plugs' : members.some(member => member.plug) ? 'lights and plugs' : 'lights'}`;
  return <article className="card group-panel" aria-label={name} data-group-panel={id}>
    {group.devices.map(id => <Binding key={id} target={id} operations={operations} operationsLive={operationsLive} commands={commands} changed={changed}/>)}
    <header className="group-panel-heading">
      <div className="group-panel-title"><h3 title={name}>{name}</h3><small>{count}</small></div>
      <button type="button" className="secondary group-panel-action" disabled={!control} onKeyDown={once} onClick={event => {if (event.detail > 1) return;for (const member of members) send(member.id, all);}}>{all ? 'All on' : 'All off'}</button>
      <button type="button" className="secondary group-panel-action" disabled={!control || ungroup === undefined} onClick={ungroup}>Ungroup</button>
      {options}
    </header>
    {notice !== undefined && <p className="light-card-notice" role="status" title={notice}>{notice}</p>}
    <div className="group-members" role="group" aria-label={`${name} members`}>{members.map(member =>
      <button key={member.id} type="button" className="group-member" data-group-member={member.id} aria-pressed={member.power === true} aria-label={`${member.name} power`}
        disabled={!control || member.power === undefined || commands.get(member.id)?.locked === true} onKeyDown={once}
        onClick={event => {if (event.detail <= 1 && member.power !== undefined) send(member.id, !member.power);}}>
        <span className="group-member-icon">{icon(member.plug)}</span>
        <span className="group-member-text"><strong title={member.name}>{member.name}</strong><small title={member.state}>{member.state}</small></span>
      </button>)}</div>
    {/* Each member whose last command needs attention, on its own line: refused, not sent, no answer yet or uncertain. */}
    <div className="group-panel-result" role="status">{problems.map(problem => <p key={problem} title={problem}>{problem}</p>)}</div>
    {handle}
  </article>;
}
