// Browser-safe choice reader. No storage, transport, default permission or device inference.
import type {Mode, ModeOverride, ModeState} from './families.js';

export const MAX_MODE_OVERRIDES = 128;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const mode = (value: unknown): value is Mode => value === 'work' || value === 'free' || value === 'quiet';
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const instant = (value: unknown): value is number => integer(value) && value <= 8_640_000_000_000_000;
const target = (value: unknown): value is string => typeof value === 'string' && value.length <= 128 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

/** Read the retained private 2.0 shape or current 2.1 shape without replacing an invalid store. */
export function normalizeModeState(value: unknown): (ModeState & {overrides: ModeOverride[]}) | undefined {
  if (!object(value) || Object.keys(value).some(key => !['id', 'revision', 'mode', 'selectedAtMs', 'overrides'].includes(key)) ||
    !target(value.id) || !integer(value.revision) || !mode(value.mode) || !instant(value.selectedAtMs)) return undefined;
  const overrides = value.overrides ?? [];
  if (!Array.isArray(overrides) || overrides.length > MAX_MODE_OVERRIDES || value.overrides === null) return undefined;
  const seen = new Set<string>(), choices: ModeOverride[] = [];
  for (const entry of overrides) {
    if (!object(entry) || Object.keys(entry).some(key => !['target', 'mode', 'selectedAtMs'].includes(key)) ||
      !target(entry.target) || !mode(entry.mode) || entry.mode === value.mode || !instant(entry.selectedAtMs) || seen.has(entry.target)) return undefined;
    seen.add(entry.target); choices.push({target: entry.target, mode: entry.mode, selectedAtMs: entry.selectedAtMs});
  }
  return {id: value.id, revision: value.revision, mode: value.mode, selectedAtMs: value.selectedAtMs, overrides: choices};
}

/** A caller must establish freshness; missing/stale state never grants a default Free choice. */
export function effectiveMode(record: ModeState | undefined, target: string, live: boolean): Mode | undefined {
  if (!live || record === undefined) return undefined;
  return record.overrides?.find(choice => choice.target === target)?.mode ?? record.mode;
}
