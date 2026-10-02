export type SourceLimits = { maxRows: number; maxBytes: number; maxMemoryBytes: number; deadlineMs: number };
export const SOURCE_LIMITS: Readonly<SourceLimits> = Object.freeze({
  maxRows: 100_000, maxBytes: 256 * 1024 * 1024,
  maxMemoryBytes: 512 * 1024 * 1024, deadlineMs: 10_000,
});
export const OPTIONAL_COLUMNS = ['duration', 'speechDuration', 'numWordsCorrected', 'numDictionaryReplacements', 'appName'] as const;
export type OptionalColumn = typeof OPTIONAL_COLUMNS[number];
export type SourceRow = {
  id: string; timestamp: string | null; status: string | null;
  numWords: number | null; duration: number | null; speechDuration: number | null;
  numWordsCorrected: number | null; numDictionaryReplacements: number | null; appName: string | null;
  invalid: string[];
};
export type SourceRead = { rows: SourceRow[]; coverage: Record<OptionalColumn, boolean>; selectedBytes: number };
export const READ_CODES = ['source-unavailable', 'source-schema', 'source-busy', 'source-capacity', 'source-deadline', 'source-read', 'unsupported-platform', 'unsafe-path'] as const;
export type ReadCode = typeof READ_CODES[number];
export class SourceError extends Error {
  constructor(readonly code: ReadCode) { super(code); this.name = 'SourceError'; }
}
export function sourceLimits(overrides: Partial<SourceLimits>): SourceLimits {
  const result = { ...SOURCE_LIMITS };
  for (const key of Object.keys(overrides) as (keyof SourceLimits)[]) {
    const value = overrides[key];
    if (!(key in result) || !Number.isSafeInteger(value) || value! < 1 || value! > SOURCE_LIMITS[key]) throw new SourceError('source-capacity');
    result[key] = value!;
  }
  return result;
}
