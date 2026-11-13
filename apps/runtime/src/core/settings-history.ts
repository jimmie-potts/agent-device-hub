import {errorBody, SCHEMA_BASE, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {coreValidator} from '@jimmie-potts/event-contracts/v2/families';
import type {StateDraft} from '@jimmie-potts/sdk';
import {familyOf, LEGACY_HISTORY_BARRIER, type History, type HistoryPosition, type SettingsHistoryRow} from './history.js';
import {
  checkpointText, isSettingsFamily, parseSettingsCheckpoint, projectSettingsMembers, removableSettingsFamily, settingsFactId, settingsId,
  settingsInteger, settingsObject, validSettingsMembers, SETTINGS_ANSWER_BYTES, SETTINGS_SCAN_LIMIT,
  SETTINGS_SINGLETONS, SETTINGS_SNAPSHOT_LIMIT,
  type SettingsCheckpoint, type SettingsFact, type SettingsPage, type SettingsRead, type SettingsRecord, type SettingsSnapshot,
} from './settings-contract.js';

const unavailable = () => errorBody('unavailable', {detail: 'the core settings are unavailable'});
const conflict = () => errorBody('revision-conflict', {detail: 'the settings checkpoint requires a new snapshot'});
const invalid = () => errorBody('internal', {detail: 'the core settings could not be read'});

function position(origin: string, row: HistoryPosition | undefined): string | undefined {
  if (row?.continuity === null) return undefined;
  const stored = row?.continuity ?? '-';
  const anchor = stored.startsWith(LEGACY_HISTORY_BARRIER) ? stored.slice(LEGACY_HISTORY_BARRIER.length) : stored;
  const checkpoint = checkpointText({origin, seq: row?.originSeq ?? 0, anchor});
  return parseSettingsCheckpoint(checkpoint) === undefined ? undefined : checkpoint;
}

function bounded<T extends SettingsSnapshot | SettingsPage>(answer: T): T | ErrorBody {
  return Buffer.byteLength(JSON.stringify(answer)) <= SETTINGS_ANSWER_BYTES ? answer : invalid();
}

function snapshot(history: History, current: readonly StateDraft[]): SettingsSnapshot | ErrorBody {
  const checkpoint = position(history.origin, history.localHead());
  if (checkpoint === undefined) return conflict();
  if (current.length > SETTINGS_SNAPSHOT_LIMIT) return invalid();
  const records: SettingsRecord[] = [], seen = new Map<string, Set<string>>();
  for (const {dataschema, type, subject: id, data} of current) {
    const family = familyOf(dataschema);
    if (!isSettingsFamily(family) || type !== `org.bunny.${family}.updated` || !settingsId(family, id) || !settingsObject(data) || data.id !== id) return invalid();
    const value = projectSettingsMembers(family, data);
    if (family === 'mode' && !Object.hasOwn(value, 'overrides')) value.overrides = [];
    if (!validSettingsMembers(family, id, value, true)) return invalid();
    const ids = seen.get(family) ?? new Set<string>();
    if (ids.has(id)) return invalid();
    ids.add(id);
    seen.set(family, ids);
    records.push({family, id, value} as SettingsRecord);
  }
  if (Object.entries(SETTINGS_SINGLETONS).some(([family, id]) => seen.get(family)?.has(id) !== true)) return unavailable();
  if ((seen.get('power-limit')?.size ?? 0) > 64 ||
      (seen.get('automation-rule')?.size ?? 0) + (seen.get('automation-routine')?.size ?? 0) > 128) return invalid();
  return bounded({schema: 'history/2.0', settings: 'snapshot', origin: history.origin, checkpoint, records});
}

/** Undefined is an unrelated or operational-only row. A selected malformed row refuses the page. */
function factOf(row: SettingsHistoryRow): SettingsFact | ErrorBody | undefined {
  if (row.source !== 'bunny/core' || (row.kind !== 'change' && row.kind !== 'removal')) return undefined;
  const suffix = row.kind === 'change' ? '.updated' : '.removed';
  if (!row.type.startsWith('org.bunny.') || !row.type.endsWith(suffix)) return undefined;
  const family = row.type.slice('org.bunny.'.length, -suffix.length);
  if (!isSettingsFamily(family)) return undefined;
  const id = row.subject, {originSeq: seq, revision, atMs} = row;
  if (!settingsFactId(family, id) || !settingsInteger(revision) || !settingsInteger(atMs)) return invalid();
  if (row.settings === null) return undefined;
  const patch: unknown = JSON.parse(row.settings);
  if (!settingsObject(patch)) return invalid();
  const record: unknown = JSON.parse(row.record);
  if (!settingsObject(record)) return invalid();
  if (row.kind === 'removal') {
    const {data} = record;
    if (patch.kind !== 'removal' || !removableSettingsFamily(family) || record.kind !== 'removal' || record.source !== row.source ||
        record.type !== row.type || record.subject !== id || record.dataschema !== `${SCHEMA_BASE}removal/2.0` ||
        !settingsObject(data) || !settingsObject(data.entity) || data.entity.family !== family || data.entity.id !== id ||
        !coreValidator().validate(record).ok) return invalid();
    return {family, id, seq, revision, atMs, kind: 'removal'};
  }
  if (patch.kind !== 'change' || record.family !== family || record.id !== id || record.closedBy !== undefined ||
      !validSettingsMembers(family, id, patch.changed, false)) return invalid();
  if (Object.keys(patch.changed).length === 0) return undefined;
  return {family, id, seq, revision, atMs, kind: 'change', changed: patch.changed, removed: []} as SettingsFact;
}

function matches(checkpoint: SettingsCheckpoint, row: HistoryPosition | undefined): boolean {
  return (checkpoint.seq === 0 || row !== undefined) && checkpointText(checkpoint) === position(checkpoint.origin, row);
}

function sealedPosition(rows: readonly SettingsHistoryRow[], prior: HistoryPosition | undefined): HistoryPosition | null | undefined {
  const tail = rows.at(-1);
  if (tail === undefined) return prior;
  for (let index = rows.length - 2; index >= 0; index -= 1) {
    const row = rows[index];
    if (row !== undefined && row.revision !== tail.revision) return row;
  }
  return prior?.revision === tail.revision ? null : prior;
}

function page(history: History, after: SettingsCheckpoint, through: SettingsCheckpoint | undefined): SettingsPage | ErrorBody {
  const {origin} = history;
  if (after.origin !== origin || (through !== undefined && through.origin !== origin)) {
    return errorBody('invalid-state', {detail: 'the settings origin changed'});
  }
  const previous = after.seq === 0 ? undefined : history.localPosition(after.seq);
  const end = through === undefined ? history.localHead() : through.seq === 0 ? undefined : history.localPosition(through.seq);
  if (!matches(after, previous) || (through !== undefined && !matches(through, end))) return conflict();
  const endText = position(origin, end);
  if (endText === undefined) return conflict();
  const endSeq = end?.originSeq ?? 0;
  if (after.seq > endSeq) return errorBody('invalid-request', {detail: 'the settings start follows the fixed head'});
  if (history.localBarrier(after.seq, endSeq)) return conflict();
  const rows = history.localRows(after.seq, endSeq, SETTINGS_SCAN_LIMIT);
  const seq = after.seq + rows.length;
  if (rows.length !== Math.min(SETTINGS_SCAN_LIMIT, endSeq - after.seq) ||
      rows.some((row, index) => row.originSeq !== after.seq + index + 1 ||
        row.continuity === null || row.continuity.startsWith(LEGACY_HISTORY_BARRIER) || position(origin, row) === undefined)) return conflict();
  const last = rows.at(-1) ?? previous;
  const done = seq === endSeq;
  const next = position(origin, last);
  const seal = done ? last : sealedPosition(rows, previous);
  const applyThrough = seal === null ? null : position(origin, seal);
  if (next === undefined || applyThrough === undefined) return conflict();
  const facts: SettingsFact[] = [];
  for (const row of rows) {
    const fact = factOf(row);
    if (fact === undefined) continue;
    if ('error' in fact) return fact;
    facts.push(fact);
  }
  return bounded({schema: 'history/2.0', settings: 'page', origin, after: checkpointText(after), through: endText, next, applyThrough, done, facts});
}

export function readSettingsHistory(history: History, read: SettingsRead, current: () => readonly StateDraft[] | undefined): SettingsSnapshot | SettingsPage | ErrorBody {
  return history.committed(() => {
    if (read.mode === 'page') return page(history, read.after, read.through);
    const states = current();
    return states === undefined ? unavailable() : snapshot(history, states);
  }) ?? unavailable();
}
