import {DEVICE_HISTORY_SOURCES, deviceHistoryQuery, type DeviceHistoryQuery, type DeviceHistorySnapshot} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import type {InboxItem} from '@jimmie-potts/event-contracts/v2/families';
import type {ModuleTool} from '@jimmie-potts/sdk';
import {HISTORY_FILTER_SCHEMA, historyFilter, type HistoryFilter, type HistoryPage} from './history.js';

export function inboxTool(read: () => InboxItem[] | undefined): ModuleTool {
  return {
    name: 'inbox', description: 'Read the whole shared operation inbox. Reading handles nothing and sends no command.',
    input: {type: 'object', additionalProperties: false},
    output: {type: 'object', additionalProperties: false, required: ['items'], properties: {items: {type: 'array'}}},
    read: () => {
      const items = read();
      return items === undefined ? errorBody('unavailable', {detail: 'the core inbox is unavailable'}) : {items};
    },
  };
}
export function historyTool(read: (filter: HistoryFilter) => HistoryPage | ErrorBody | undefined): ModuleTool {
  return {
    name: 'history', description: 'Read retained history with inclusive time, kind, source and session filters and an optional latest-row limit (1..500). Reading sends nothing.',
    input: HISTORY_FILTER_SCHEMA,
    output: {type: 'object', additionalProperties: false, required: ['rows'], properties: {rows: {type: 'array'}, open: {type: 'array'}}},
    read: input => {
      const filter = historyFilter(input);
      if (filter === undefined) return errorBody('invalid-request', {detail: 'invalid history filters'});
      return read(filter) ?? errorBody('unavailable', {detail: 'the core history is unavailable'});
    },
  };
}


export function devicePowerHistoryTool(read: (query: DeviceHistoryQuery) => DeviceHistorySnapshot | ErrorBody | undefined): ModuleTool {
  return {
    name: 'device_power_history',
    description: 'Read a bounded, versioned projection of observed power history and evidence for one device. Times are epoch milliseconds and the interval is half open.',
    input: {type: 'object', additionalProperties: false, required: ['source', 'target', 'fromAtMs', 'toAtMs'],
      properties: {source: {enum: [...DEVICE_HISTORY_SOURCES]}, target: {type: 'string'},
        fromAtMs: {type: 'integer'}, toAtMs: {type: 'integer'}}},
    output: {type: 'object', required: ['schema', 'query', 'boundary', 'complete', 'evidence', 'durations', 'lastChange', 'links'],
      properties: {schema: {type: 'string'}, query: {type: 'object'}, boundary: {type: 'integer'}, complete: {type: 'boolean'},
        evidence: {type: 'array'}, durations: {type: 'object'}, lastChange: {}, links: {type: 'array'}}},
    read: input => {
      if (Object.keys(input).length !== 4) return errorBody('invalid-request');
      const query = deviceHistoryQuery(input);
      return query === undefined ? errorBody('invalid-request') : read(query) ?? errorBody('unavailable');
    },
  };
}
