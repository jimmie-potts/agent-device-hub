import {type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {LIBRARY_BYTES, TEXT_BYTES, TITLE_BYTES, type PreferenceLibrary} from './model.js';

export class PreferenceFault extends Error {constructor(readonly code: ErrorCode) {super(code);}}
export function fail(code: ErrorCode): never {throw new PreferenceFault(code);}
export const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(value);
export const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim() !== '' && Buffer.byteLength(value, 'utf8') <= max;
export type PreferenceInput = {expectedRevision: number} & (
  {action: 'create'; title: string; text: string} |
  {action: 'edit'; id: string; title: string; text: string} |
  {action: 'set-active'; id: string; active: boolean} |
  {action: 'import'; library: PreferenceLibrary}
);
/** Check even existing IDs before any writes. Imported provenance is file data, not verified authority. */
function libraryOf(value: unknown): void {
  if (!object(value) || !exact(value, ['schema', 'entries']) || value.schema !== 'preference-library/1.0' || !Array.isArray(value.entries) ||
    Buffer.byteLength(JSON.stringify(value)) > LIBRARY_BYTES) fail('invalid-request');
  const ids = new Set<string>();
  for (const entry of value.entries) {
    if (!object(entry) || !exact(entry, ['id', 'title', 'text', 'active', 'createdAtMs', 'updatedAtMs', 'history']) ||
      !id(entry.id) || ids.has(entry.id) || !text(entry.title, TITLE_BYTES) || !text(entry.text, TEXT_BYTES) || typeof entry.active !== 'boolean' ||
      !integer(entry.createdAtMs) || !integer(entry.updatedAtMs) || entry.updatedAtMs < entry.createdAtMs || !Array.isArray(entry.history) || entry.history.length === 0) fail('invalid-request');
    ids.add(entry.id);
    let previous = entry.createdAtMs;
    for (const event of entry.history) {
      if (!object(event) || !exact(event, ['action', 'source', 'atMs', 'title', 'text', 'active']) ||
        !['created', 'edited', 'deactivated', 'reactivated', 'imported'].includes(String(event.action)) ||
        event.source !== (event.action === 'imported' ? 'import' : 'owner') || !integer(event.atMs) || event.atMs < previous || event.atMs > entry.updatedAtMs ||
        !text(event.title, TITLE_BYTES) || !text(event.text, TEXT_BYTES) || typeof event.active !== 'boolean' ||
        (['created', 'reactivated'].includes(String(event.action)) && !event.active) || (['deactivated', 'imported'].includes(String(event.action)) && event.active)) fail('invalid-request');
      previous = event.atMs;
    }
    const last = entry.history.at(-1) as Record<string, unknown>;
    if (last.atMs !== entry.updatedAtMs || last.title !== entry.title || last.text !== entry.text || last.active !== entry.active) fail('invalid-request');
  }
}
export function inputOf(value: unknown): PreferenceInput {
  if (!object(value) || !integer(value.expectedRevision)) fail('invalid-request');
  switch (value.action) {
    case 'create':
    case 'edit':
      if (!exact(value, value.action === 'create' ? ['action', 'expectedRevision', 'title', 'text'] : ['action', 'expectedRevision', 'id', 'title', 'text']) ||
        !text(value.title, TITLE_BYTES) || !text(value.text, TEXT_BYTES) || (value.action === 'edit' && !id(value.id))) fail('invalid-request');
      break;
    case 'set-active':
      if (!exact(value, ['action', 'expectedRevision', 'id', 'active']) || !id(value.id) || typeof value.active !== 'boolean') fail('invalid-request');
      break;
    case 'import':
      if (!exact(value, ['action', 'expectedRevision', 'library'])) fail('invalid-request');
      libraryOf(value.library);
      break;
    default: fail('invalid-request');
  }
  return value as PreferenceInput;
}
