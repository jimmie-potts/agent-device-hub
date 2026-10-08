// The core's operation-record scenario (Hub #922), shared by the in-memory harness and disposable runs.
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {switchLamp} from '../fixtures/lamp.js';
import {act, answered, dispatchOnce, expect, holds, show, type Harness, type Outcome, type Scenario} from './framework.js';

const lampPower = (h: Harness, power: 'on' | 'off'): Outcome =>
  h.devices().lamp.power['lamp-1'] === power || `lamp-1 is ${String(h.devices().lamp.power['lamp-1'])}`;

/** The core's `operation` records for a request, in the order the core published them (Hub #922). */
const operationSteps = (h: Harness, requestId: string): string[] => h.published().map(({message}) => message)
  .filter(message => message.source === 'bunny/core' && message.kind === 'state' && message.dataschema.endsWith('/operation/2.0'))
  .map(message => message.data as OperationRecord).filter(record => record.requestId === requestId)
  .map(record => [record.status, record.result, record.evidence].filter(part => part !== undefined).join(' '));
/** The reader's copy of a request's `operation` record. */
const operationOf = (h: Harness, requestId: string): OperationRecord | undefined =>
  h.reader.states<OperationRecord>('operation').map(state => state.data).find(record => record.requestId === requestId);

/**
 * The core's `operation` family (Hub #922): each tracked action's latest state, which a display syncs to show it
 * requested, accepted and completed. A switch the lamp holds stays `sent`, a released one completes with the evidence
 * the lamp reported, a failed one says nothing reached the lamp, and the reader's copy holds each latest record.
 */
const operationRecords: Scenario = {
  id: 'operation-records',
  title: 'each tracked action\'s latest state reaches the reader as its operation record',
  seed: {modules: ['core', 'lamp'], follows: [['session', 'operation'], ['lamp']]},
  steps: [
    act('the lamp holds its next switch', h => { h.simulate({device: 'lamp', action: 'hold'}); }),
    act('the operator switches lamp-1 on as req-op through the core\'s dispatcher', h => { void h.dispatch('operator', 'op', switchLamp('lamp-1', 'on'), 'req-op'); }),
    expect('the reader\'s copy shows req-op sent, with no result yet', h => {
      const record = operationOf(h, 'req-op');
      return (record?.status === 'sent' && record.result === undefined && record.family === 'lamp-switch' && record.target === 'lamp-1' &&
        record.requestedBy === 'bunny/parts/operator') || `the record is ${show(record?.status)}`;
    }),
    act('the lamp lets the switch go', h => { h.simulate({device: 'lamp', action: 'release'}); }),
    expect('the action was accepted', h => answered(h, 'op', 'accepted')),
    expect('the record completed, succeeded, with the lamp\'s observation as its evidence', h => {
      const record = operationOf(h, 'req-op');
      return (record?.status === 'completed' && record.result === 'succeeded' && record.evidence === 'observed') || `the record is ${show(record)}`;
    }),
    expect('the core published it sent first and completed last', h => {
      const published = operationSteps(h, 'req-op');
      return (published[0] === 'sent' && published.at(-1) === 'completed succeeded observed') || show(published);
    }),
    act('the lamp cannot be reached for its next switch', h => { h.simulate({device: 'lamp', action: 'fail-next'}); }),
    act('the operator switches lamp-1 off as req-op-off', h => dispatchOnce(h, 'operator', 'off', switchLamp('lamp-1', 'off'), 'req-op-off')),
    expect('its record says it failed, with no evidence that anything reached the lamp', h => {
      const record = operationOf(h, 'req-op-off');
      return (record?.status === 'completed' && record.result === 'failed' && record.evidence === 'none' && record.error?.code === 'unavailable') ||
        `the record is ${show(record)}`;
    }),
    holds('the lamp stays on: nothing was sent again', h => lampPower(h, 'on'), 300),
  ],
};

export const operationScenarios: readonly Scenario[] = [operationRecords];
