import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import type {InboxItem} from '@jimmie-potts/event-contracts/v2/families';
import type {ModuleTool} from '@jimmie-potts/sdk';
import {HISTORY_FILTER_SCHEMA, historyFilter, type HistoryFilter, type HistoryRow} from './history.js';

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
export function historyTool(read: (filter: HistoryFilter) => HistoryRow[] | ErrorBody | undefined): ModuleTool {
  return {
    name: 'history', description: 'Read retained history with inclusive time, kind, source and session filters. Reading sends nothing.',
    input: HISTORY_FILTER_SCHEMA,
    output: {type: 'object', additionalProperties: false, required: ['rows'], properties: {rows: {type: 'array'}}},
    read: input => {
      const filter = historyFilter(input);
      if (filter === undefined) return errorBody('invalid-request', {detail: 'invalid history filters'});
      const rows = read(filter);
      return Array.isArray(rows) ? {rows} : rows ?? errorBody('unavailable', {detail: 'the core history is unavailable'});
    },
  };
}
