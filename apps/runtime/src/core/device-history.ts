import {Outcome} from '@jimmie-potts/sdk';
import {DEVICE_HISTORY_VERSION, type DeviceHistoryEvidence, type DeviceHistoryQuery, type DeviceHistorySnapshot, type DevicePower} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import type {HistoryOpenSpan, HistoryRow} from './history.js';

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const instant = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function projectDeviceHistory(query: DeviceHistoryQuery, boundary: number, rows: readonly HistoryRow[],
  open: readonly HistoryOpenSpan[], complete: boolean): DeviceHistorySnapshot {
  type Readback = {requestId: string; transmittedAtMs: number};
  type Observation = DeviceHistoryEvidence & {readbacks: Readback[]};
  const evidence: Observation[] = [];
  let prior: Observation | undefined;
  for (const row of rows) {
    if (row.source !== query.source) continue;
    if (row.kind === 'removal') {
      if (row.type !== 'org.bunny.device.removed') continue;
      prior = {seq: row.seq, messageId: row.messageId, atMs: row.atMs, power: 'unknown', kind: 'removal', confirmedThroughMs: row.atMs, readbacks: []};
      evidence.push(prior);
      continue;
    }
    if (row.kind !== 'change' || row.record.family !== 'device') continue;
    const {changed, gapMs, span, revision} = row.record;
    if (prior !== undefined && prior.power !== 'unknown' && object(span) && instant(span.lastConfirmedAtMs)) {
      prior.confirmedThroughMs = Math.max(prior.confirmedThroughMs, span.lastConfirmedAtMs);
    }
    if (row.record.closedBy === 'removal') continue;
    const gap = typeof gapMs === 'number';
    const reset = object(changed) && (changed.availability === 'unavailable' || changed.availability === 'unknown' ||
      Object.hasOwn(changed, 'observed') && !object(changed.observed)) ||
      Array.isArray(row.record.removed) && row.record.removed.includes('observed');
    const observed = object(changed) && object(changed.observed) ? changed.observed : undefined;
    const known = observed?.status === 'known' && object(observed.power) && observed.power.status === 'known' &&
      typeof observed.power.value === 'boolean' && instant(observed.observedAtMs);
    const atMs = known && typeof observed.observedAtMs === 'number' && !reset ? observed.observedAtMs : row.atMs;
    const power: DevicePower = reset ? 'unknown' : known && object(observed.power) ? observed.power.value === true ? 'on' : 'off'
      : observed === undefined && !gap ? prior?.power ?? 'unknown' : 'unknown';
    const kind = gap || reset ? 'gap' : observed === undefined ? 'continuation' : 'observation';
    if (kind === 'continuation' && power === 'unknown') continue;
    const tags = object(changed) && Array.isArray(changed.powerReadbacks) ? changed.powerReadbacks : [];
    const readbacks: Readback[] = [];
    for (const value of tags) {
      if (!object(value) || typeof value.requestId !== 'string' || !instant(value.transmittedAtMs) || value.transmittedAtMs > atMs ||
        !object(value.reading) || value.reading.status !== 'known' || value.reading.observedAtMs !== atMs ||
        value.reading.on !== (power === 'on') || value.requestedOn !== value.reading.on || power === 'unknown') continue;
      if (!readbacks.some(item => item.requestId === value.requestId)) readbacks.push({requestId: value.requestId, transmittedAtMs: value.transmittedAtMs});
    }
    const heldOpen = open.find(value => value.revision === revision);
    prior = {seq: row.seq, messageId: row.messageId, atMs, kind, power,
      confirmedThroughMs: Math.max(atMs, heldOpen?.lastConfirmedAtMs ?? atMs), readbacks};
    evidence.push(prior);
  }
  evidence.sort((left, right) => left.atMs === right.atMs ? left.seq - right.seq : left.atMs - right.atMs);
  const durations: Record<DevicePower, number> = {on: 0, off: 0, unknown: query.toAtMs - query.fromAtMs};
  for (const [index, point] of evidence.entries()) {
    if (point.power === 'unknown') continue;
    const from = Math.max(query.fromAtMs, point.atMs);
    const to = Math.min(query.toAtMs, point.confirmedThroughMs, evidence[index + 1]?.atMs ?? query.toAtMs);
    const duration = Math.max(0, to - from);
    durations[point.power] += duration;
    durations.unknown -= duration;
  }
  const relevant = evidence.filter(point => point.atMs < query.toAtMs &&
    (point.atMs >= query.fromAtMs || point.confirmedThroughMs >= query.fromAtMs));
  const links = relevant.flatMap(point => {
    const [readback] = point.readbacks;
    if (point.readbacks.length !== 1 || readback === undefined) return [];
    const {requestId, transmittedAtMs} = readback;
    const steps = rows.filter(row => row.kind === 'operation' && row.requestId === requestId && row.subject === query.target && row.record.command === 'power-set');
    const sent = steps.find(row => row.record.event === 'sent' && row.atMs <= transmittedAtMs);
    const transmission = steps.find(row => row.record.event === 'outcome' && row.record.result === Outcome.succeeded && row.record.evidence === Outcome.transmitted);
    return sent === undefined || transmission === undefined || transmission.seq <= sent.seq ? [] :
      [{requestId, observationSeq: point.seq, sentSeq: sent.seq, transmissionOutcomeSeq: transmission.seq, transmittedAtMs}];
  });
  let lastChange: DeviceHistorySnapshot['lastChange'] = null;
  for (const [index, point] of evidence.entries()) {
    const previous = evidence[index - 1];
    if (point.atMs < query.fromAtMs || point.atMs >= query.toAtMs || point.power === 'unknown' || point.kind !== 'observation' || previous === undefined ||
      previous.power === 'unknown' || previous.power === point.power) continue;
    lastChange = {atMs: point.atMs, from: previous.power, to: point.power, seq: point.seq};
  }
  return {schema: DEVICE_HISTORY_VERSION, query, boundary, complete, evidence: relevant.map(({readbacks: _, ...point}) => point), durations, links, lastChange};
}
