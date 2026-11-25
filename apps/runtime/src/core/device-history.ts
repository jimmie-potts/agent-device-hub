import {DEVICE_HISTORY_VERSION, type DeviceHistoryEvidence, type DeviceHistoryQuery, type DeviceHistorySnapshot, type DevicePower} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import type {HistoryOpenSpan, HistoryRow} from './history.js';

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const instant = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function projectDeviceHistory(query: DeviceHistoryQuery, boundary: number, rows: readonly HistoryRow[],
  open: readonly HistoryOpenSpan[], complete: boolean): DeviceHistorySnapshot {
  type Observation = DeviceHistoryEvidence & {requestIds: string[]};
  const evidence: Observation[] = [];
  let prior: Observation | undefined;
  for (const row of rows) {
    if (row.source !== query.source) continue;
    if (row.kind === 'removal') {
      if (row.type !== 'org.bunny.device.removed') continue;
      prior = {seq: row.seq, messageId: row.messageId, atMs: row.atMs, power: 'unknown', kind: 'removal', confirmedThroughMs: row.atMs, requestIds: []};
      evidence.push(prior);
      continue;
    }
    if (row.kind !== 'change' || row.record.family !== 'device') continue;
    const {changed, gapMs, span, revision} = row.record;
    if (prior !== undefined && prior.power !== 'unknown' && object(span) && instant(span.lastConfirmedAtMs)) {
      prior.confirmedThroughMs = Math.max(prior.confirmedThroughMs, span.lastConfirmedAtMs);
    }
    const gap = typeof gapMs === 'number';
    if (!object(changed) || changed.availability === 'unavailable' || changed.availability === 'unknown' || !object(changed.observed)) {
      if (gap || object(changed) && (changed.availability === 'unavailable' || changed.availability === 'unknown')) {
        prior = {seq: row.seq, messageId: row.messageId, atMs: row.atMs, power: 'unknown', kind: 'gap', confirmedThroughMs: row.atMs, requestIds: []};
        evidence.push(prior);
      }
      continue;
    }
    const observed = changed.observed;
    const known = observed.status === 'known' && object(observed.power) && observed.power.status === 'known' &&
      typeof observed.power.value === 'boolean' && instant(observed.observedAtMs);
    const atMs = known && typeof observed.observedAtMs === 'number' ? observed.observedAtMs : row.atMs;
    const power: DevicePower = known && object(observed.power) ? observed.power.value === true ? 'on' : 'off' : 'unknown';
    const requestIds = Array.isArray(changed.powerReadbacks) ? changed.powerReadbacks.flatMap(value => {
      if (!object(value) || typeof value.requestId !== 'string' || !object(value.reading) || value.reading.status !== 'known' ||
        value.reading.observedAtMs !== atMs || value.reading.on !== (power === 'on') || value.requestedOn !== value.reading.on || power === 'unknown') return [];
      return [value.requestId];
    }) : [];
    const heldOpen = open.find(value => value.revision === revision);
    prior = {seq: row.seq, messageId: row.messageId, atMs, kind: gap ? 'gap' : 'observation', power,
      confirmedThroughMs: Math.max(atMs, heldOpen?.lastConfirmedAtMs ?? atMs), requestIds: [...new Set(requestIds)]};
    evidence.push(prior);
  }
  evidence.sort((left, right) => left.atMs - right.atMs || left.seq - right.seq);
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
  const causes = relevant.flatMap(point => {
    if (point.requestIds.length !== 1) return [];
    const requestId = point.requestIds[0];
    if (requestId === undefined) return [];
    const steps = rows.filter(row => row.kind === 'operation' && row.requestId === requestId && row.subject === query.target && row.record.command === 'power-set');
    const sent = steps.find(row => row.record.event === 'sent' && row.atMs <= point.atMs);
    const outcome = steps.find(row => row.record.event === 'outcome' && row.record.result === 'succeeded' && row.record.evidence === 'observed');
    return sent === undefined || outcome === undefined ? [] : [{requestId, observationSeq: point.seq, outcomeSeq: outcome.seq, sentSeq: sent.seq}];
  });
  let lastChange: DeviceHistorySnapshot['lastChange'] = null;
  for (const [index, point] of evidence.entries()) {
    const previous = evidence[index - 1];
    if (point.atMs < query.fromAtMs || point.atMs >= query.toAtMs || point.power === 'unknown' || point.kind === 'gap' || previous === undefined ||
      previous.power === 'unknown' || previous.power === point.power) continue;
    lastChange = {atMs: point.atMs, from: previous.power, to: point.power, seq: point.seq};
  }
  return {schema: DEVICE_HISTORY_VERSION, query, boundary, complete, evidence: relevant.map(({requestIds: _, ...point}) => point), durations, causes, lastChange};
}
