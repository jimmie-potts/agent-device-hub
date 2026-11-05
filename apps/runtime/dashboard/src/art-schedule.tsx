import React, {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import type {ArtSchedulePolicy, ArtScheduleRecord} from '@jimmie-potts/event-contracts/v2/art-schedule';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {DashboardConnection} from './connection.ts';
import {artMinute, artScheduleCopy, artTime, artTimeInput, sameArtPolicy, saveArtSchedule} from './art-schedule-client.ts';
import './art-schedule.css';

type Draft = {revision: number; policy: ArtSchedulePolicy; start: string; end: string};
type Mutation = {kind: 'idle' | 'sending' | 'refreshing' | 'uncertain' | 'conflict'} | {kind: 'confirming'; revision: number; policy: ArtSchedulePolicy};
const draftOf = (record: ArtScheduleRecord): Draft => ({revision: record.settingsRevision, policy: structuredClone(record.policy),
  start: artTimeInput(record.policy.wakingStartMinute), end: artTimeInput(record.policy.wakingEndMinute)});
const reasons = {disabled: 'Daily art is disabled.', 'quiet-hours': 'Quiet hours', attention: 'Active attention', 'no-flourishes': 'Flourishes are disabled',
  spacing: 'Minimum spacing', budget: 'Appearance budget', 'no-art': 'No usable saved art', expired: 'The window ended', 'policy-changed': 'Settings changed',
  'source-unavailable': 'Weather evidence is unavailable', 'no-surfaces': 'No eligible surface', unavailable: 'An owner is unavailable'};
function outcome(requestId: string | null, family: string, target: string, operations: readonly OperationRecord[], live: boolean): string {
  if (requestId === null) return 'Not requested';
  if (!live) return 'Outcome evidence is stale';
  const operation = operations.find(value => value.requestId === requestId && value.family === family && value.target === target && value.requestedBy === 'bunny/core');
  return operation === undefined ? 'No current outcome' : [operation.status, operation.result, operation.evidence, operation.error?.code].filter(Boolean).join(' · ');
}
export function ArtSchedulePanel({connection, live, control}: {connection: DashboardConnection; live: boolean; control: boolean}): React.JSX.Element {
  const state = useSyncExternalStore(connection.subscribe, connection.getState, connection.getState);
  const {record, synced} = artScheduleCopy(state.runtime);
  const [draft, setDraft] = useState<Draft>(), [dirty, setDirty] = useState(false);
  const [mutation, setMutation] = useState<Mutation>({kind: 'idle'}), [message, setMessage] = useState('');
  const mounted = useRef(true), inFlight = useRef(false);
  useEffect(() => {mounted.current = true;return () => {mounted.current = false;};}, []);
  const fresh = live && state.feed === 'connected' && synced && record !== undefined && record.status !== 'unavailable';
  const mayEdit = fresh && control && state.runtime.control && mutation.kind === 'idle';
  useEffect(() => {
    if (!fresh || record === undefined) return;
    if (mutation.kind === 'confirming') {
      if (record.settingsRevision === mutation.revision && sameArtPolicy(record.policy, mutation.policy)) {
        setDraft(draftOf(record));setDirty(false);setMutation({kind: 'idle'});setMessage('Daily art settings saved.');
      } else if (record.settingsRevision >= mutation.revision) {
        setMutation({kind: 'conflict'});setMessage('Settings changed elsewhere. Refresh and review the saved settings.');
      }
    } else if (!dirty && mutation.kind === 'idle') setDraft(draftOf(record));
  }, [record, fresh, dirty, mutation]);
  const update = (change: Partial<ArtSchedulePolicy>): void => {
    if (!mayEdit) return;setDirty(true);setDraft(value => value === undefined ? undefined : {...value, policy: {...value.policy, ...change}});
  };
  const save = async (): Promise<void> => {
    const current = connection.getState(), currentCopy = artScheduleCopy(current.runtime);
    if (!mayEdit || inFlight.current || draft === undefined || current.feed !== 'connected' || !current.runtime.control || !currentCopy.synced) return;
    const start = artMinute(draft.start), end = artMinute(draft.end);
    if (start === undefined || end === undefined || start === end) {setMessage('Choose different valid waking start and end times.');return;}
    const policy = {...draft.policy, wakingStartMinute: start, wakingEndMinute: end};
    inFlight.current = true;setMutation({kind: 'sending'});setMessage('Saving daily art settings…');
    const result = await saveArtSchedule({expectedSettingsRevision: draft.revision, policy});
    inFlight.current = false;if (!mounted.current) return;
    if (result.kind === 'acknowledged') {setMutation({kind: 'confirming', revision: result.settingsRevision, policy});setMessage('Waiting for the saved policy to sync…');}
    else if (result.kind === 'uncertain') {setMutation({kind: 'uncertain'});setMessage('The change has no reliable reply. Refresh current art settings before another attempt. Nothing will be sent again automatically.');}
    else {setMutation({kind: result.code === 'revision-conflict' ? 'conflict' : 'idle'});setMessage(result.code === 'revision-conflict'
      ? 'Settings changed elsewhere. Your draft is retained. Refresh and review the saved settings.' : `Art settings were refused: ${result.code}.`);}
  };
  const refresh = async (): Promise<void> => {
    if (inFlight.current || !live || connection.getState().feed !== 'connected') return;
    inFlight.current = true;setMutation({kind: 'refreshing'});
    try {
      const completed = await connection.refreshArtSchedule();
      if (!mounted.current) return;
      const current = connection.getState(), value = artScheduleCopy(current.runtime);
      if (!completed || current.feed !== 'connected' || !value.synced || value.record === undefined || value.record.status === 'unavailable') throw new Error('unavailable');
      setDraft(draftOf(value.record));setDirty(false);setMutation({kind: 'idle'});setMessage('Current art settings refreshed. Nothing was sent again.');
    } catch {if (mounted.current) {setMutation({kind: 'uncertain'});setMessage('Current art settings could not be refreshed. Your draft is retained.');}}
    finally {inFlight.current = false;}
  };
  const devices = state.runtime.copies.filter(copy => copy.family === 'device' && copy.synced).flatMap(copy => copy.records
    .filter((value): value is DeviceRecord => 'kind' in value && (value.kind === 'pixoo' || value.kind === 'tidbyt') && copy.owner === `bunny/modules/${value.kind}`));
  const targets = [...new Set([...devices.map(device => device.id), ...(draft?.policy.targets ?? [])])];
  const operationCopy = state.runtime.copies.find(copy => copy.family === 'operation' && copy.owner === 'bunny/core');
  const operations = (operationCopy?.records ?? []).filter((value): value is OperationRecord => 'requestId' in value && 'requestedBy' in value);
  const operationsLive = live && operationCopy?.synced === true && state.feed === 'connected';
  const last = record?.lastOpportunity;
  return <section aria-label="Daily art" className="art-schedule card"><header className="automation-section-heading"><h2>Daily art</h2>
    <button type="button" className="secondary" disabled={!live || mutation.kind === 'sending' || mutation.kind === 'refreshing'} onClick={() => {void refresh();}}>Refresh art settings</button></header>
    <p>Saved art can appear through the waking day. Quiet hours, attention and each display's controls take precedence.</p>
    {!fresh && <p role="status">Art settings are unavailable or stale. No changes can be sent.</p>}
    <p role="status" className="art-schedule-feedback">{message}</p>
    {draft !== undefined && <form className="edit wide" onSubmit={event => {event.preventDefault();void save();}}><fieldset disabled={!mayEdit}><legend>Daily art settings</legend>
      <label className="check"><input type="checkbox" checked={draft.policy.enabled} onChange={event => {update({enabled: event.target.checked});}}/>Enable daily art</label>
      <p className="hint">Times use the runtime's clock: {record?.timeZone ?? 'Unavailable'}. At least 45 minutes separate appearances; short or quiet windows may fit fewer.</p>
      <div className="art-schedule-times"><label>Waking day starts<input type="time" required value={draft.start} onChange={event => {setDirty(true);setDraft({...draft, start: event.target.value});}}/></label>
        <label>Waking day ends<input type="time" required value={draft.end} onChange={event => {setDirty(true);setDraft({...draft, end: event.target.value});}}/></label>
        <label>Appearances per day<select value={draft.policy.appearances} onChange={event => {const value = event.target.value;if (value === '6' || value === '7' || value === '8') update({appearances: value === '6' ? 6 : value === '7' ? 7 : 8});}}>
          {[6, 7, 8].map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
      <fieldset><legend>Art surfaces</legend><label className="check"><input type="checkbox" checked={draft.policy.browser} onChange={event => {update({browser: event.target.checked});}}/>Browser</label>
        {targets.map(target => {const device = devices.find(value => value.id === target);return <label className="check" key={target}><input type="checkbox" checked={draft.policy.targets.includes(target)} onChange={event => {
          update({targets: event.target.checked ? [...draft.policy.targets, target] : draft.policy.targets.filter(value => value !== target)});
        }}/>{device === undefined ? `${target} · unavailable` : `${device.kind === 'pixoo' ? 'Pixoo' : 'Tidbyt'} · ${target}`}</label>;})}
        {targets.length === 0 && <p>No display is currently available in the configured device records.</p>}</fieldset>
      <label className="check"><input type="checkbox" checked={draft.policy.ambient} onChange={event => {update({ambient: event.target.checked});}}/>Refresh ambient art</label>
      <p className="hint">Use saved art without taking over a display. The current ambient tile keeps its existing maintenance after scheduling is disabled.</p>
      <label className="check"><input type="checkbox" checked={draft.policy.generation} onChange={event => {update({generation: event.target.checked});}}/>Allow new art generation</label>
      <p className="hint">Generation uses the existing provider allowances. Saved art remains available when generation is off or unavailable.</p>
      <label className="check"><input type="checkbox" checked={draft.policy.weather} onChange={event => {update({weather: event.target.checked});}}/>Use weather for art and rain forecasts</label>
      <label className="check"><input type="checkbox" checked={draft.policy.coversStatus} onChange={event => {update({coversStatus: event.target.checked});}}/>Allow art to briefly cover status</label>
      <p className="hint">Attention, pins, explicit pauses and Now Playing still take precedence.</p>
      <button disabled={!dirty}>Save art settings</button></fieldset></form>}
    {record !== undefined && <section aria-label="Art schedule evidence"><h3>Schedule evidence</h3><p>State: {fresh ? record.status : 'stale'} · Weather: {fresh ? record.weather : 'stale'}</p>
      <p>{record.nextOpportunity === null ? 'No next opportunity is planned.' : `Next ${record.nextOpportunity.kind === 'appearance' ? 'appearance' : 'ambient update'}: ${artTime(record.nextOpportunity.startAtMs, record.timeZone)}`}</p>
      {last != null && <details><summary>Latest art opportunity</summary><p>{artTime(last.startAtMs, record.timeZone)}{last.reason === null ? '' : ` · ${reasons[last.reason]}`}</p>
        <p>Generation request: {outcome(last.generationRequestId, 'art-auto', 'art', operations, operationsLive)}</p>
        <p>Browser selection: {outcome(last.browserRequestId, 'art-auto', 'art', operations, operationsLive)}</p>
        <ul>{last.displays.map(display => <li key={display.target}>{display.target}: preparation {outcome(display.prepareRequestId, 'art-auto', 'art', operations, operationsLive)};
          {' '}appearance {outcome(display.momentRequestId, 'moment-play', display.target, operations, operationsLive)}{display.error === null ? '' : ` · ${display.error}`}</li>)}</ul>
        <p className="hint">Generation, selection and display transmission are separate. A successful command does not establish visible pixels.</p></details>}
    </section>}
  </section>;
}
