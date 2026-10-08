// Pure cutover preparation. Supplied facts are not installed observations or execution authority.
import {createHash} from 'node:crypto';
import {posix} from 'node:path';

export const MIGRATION_ORDER = [
  'nanoleaf', 'pixoo-library', 'pixoo-configuration', 'lifx', 'tidbyt', 'playback',
  'hub-edge', 'codex-desktop', 'automation', 'wispr-configuration',
] as const;
export type MigrationGroup = typeof MIGRATION_ORDER[number];
export type WriterFact = Readonly<{id: string; kind: 'user-unit' | 'process-set'; target: string}>;
export type StoreFact = Readonly<{
  id: string; path: string; kind: 'file' | 'directory' | 'sqlite'; bytes: number; sha256: string;
  writers: readonly string[]; use: 'migration-input' | 'backup-only';
}>;
export type MigrationFact = Readonly<{
  group: MigrationGroup; selection: 'convert'; inputs: readonly string[]; bytes: number;
  converter: string | null; verifier: string | null;
}> | Readonly<{group: MigrationGroup; selection: 'not-configured'; reason: string}>;
export type DestinationFact = Readonly<{path: string; volume: string}>;
export type CutoverFacts = Readonly<{
  owner: string;
  source: Readonly<{revision: string; tree: string}>;
  destinations: Readonly<{backup: DestinationFact; runtime: DestinationFact}>;
  volumes: readonly Readonly<{id: string; availableBytes: number; reserveBytes: number}>[];
  releaseBytes: number;
  writers: readonly WriterFact[];
  stores: readonly StoreFact[];
  migrations: readonly MigrationFact[];
}>;
export type PreparationStep = Readonly<
  {kind: 'stop-writers'; writers: readonly string[]} |
  {kind: 'backup' | 'verify-backups'; stores: readonly string[]} |
  {kind: 'convert'; group: MigrationGroup; inputs: readonly string[]} |
  {kind: 'verify-conversions'; groups: readonly MigrationGroup[]} |
  {kind: 'await-execution-qualification'}
>;
export type PreparationBlocker = Readonly<
  {kind: 'missing-converter' | 'missing-verifier'; group: MigrationGroup} |
  {kind: 'insufficient-space'; volume: string; requiredBytes: number; availableBytes: number}
>;
export type CutoverPreparation = Readonly<{
  kind: 'runtime-cutover-preparation'; execution: 'unavailable';
  status: 'prepared' | 'blocked'; digest: string;
  facts: CutoverFacts; steps: readonly PreparationStep[];
  space: readonly Readonly<{volume: string; requiredBytes: number; availableBytes: number}>[];
  blockers: readonly PreparationBlocker[];
}>;

type InputReason = 'owner' | 'source' | 'writer' | 'store' | 'migration' | 'path' | 'volume' | 'size';
export class CutoverInputError extends Error {
  constructor(readonly reason: InputReason) {
    super('cutover-plan-invalid');
    this.name = 'CutoverInputError';
  }
}
function requireFact(condition: boolean, reason: InputReason): asserts condition {
  if (!condition) throw new CutoverInputError(reason);
}
const identifier = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const hasControl = (value: string): boolean => [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const text = (value: string): boolean => value.length > 0 && value.length <= 256 && value.trim() === value && !hasControl(value);
const overlaps = (a: string, b: string): boolean => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

function uniqueIds(values: readonly string[], reason: InputReason): void {
  requireFact(values.every(identifier) && new Set(values).size === values.length, reason);
}
function validateInventory(facts: CutoverFacts): void {
  requireFact(/^[A-Za-z0-9_.-]{1,128}$/.test(facts.owner), 'owner');
  requireFact(/^[a-f0-9]{40}$/.test(facts.source.revision) && /^[a-f0-9]{40}$/.test(facts.source.tree), 'source');
  requireFact(facts.writers.length > 0 && facts.stores.length > 0, 'store');
  uniqueIds(facts.writers.map(writer => writer.id), 'writer');
  uniqueIds(facts.stores.map(store => store.id), 'store');
  for (const writer of facts.writers) {
    requireFact(['user-unit', 'process-set'].includes(writer.kind) && text(writer.target), 'writer');
  }
  const writerIds = new Set(facts.writers.map(writer => writer.id));
  const stores = new Map(facts.stores.map(store => [store.id, store]));
  for (const store of facts.stores) {
    requireFact(['file', 'directory', 'sqlite'].includes(store.kind), 'store');
    requireFact(['migration-input', 'backup-only'].includes(store.use), 'store');
    requireFact(/^[a-f0-9]{64}$/.test(store.sha256), 'store');
    uniqueIds(store.writers, 'writer');
    requireFact(store.writers.length > 0 && store.writers.every(id => writerIds.has(id)), 'writer');
  }
  const paths = [facts.destinations.backup.path, facts.destinations.runtime.path, ...facts.stores.map(store => store.path)];
  for (const [index, path] of paths.entries()) {
    requireFact(path.length <= 4096 && !path.endsWith('/') && posix.isAbsolute(path) && posix.normalize(path) === path && !hasControl(path), 'path');
    requireFact(paths.slice(0, index).every(other => !overlaps(other, path)), 'path');
  }
  uniqueIds(facts.migrations.map(migration => migration.group), 'migration');
  requireFact(facts.migrations.length === MIGRATION_ORDER.length && facts.migrations.every(migration => MIGRATION_ORDER.includes(migration.group)), 'migration');
  const consumed = new Set<string>();
  for (const migration of facts.migrations) {
    if (migration.selection === 'not-configured') {
      requireFact(text(migration.reason), 'migration');
    } else {
      requireFact(migration.selection === 'convert', 'migration');
      uniqueIds(migration.inputs, 'migration');
      requireFact(migration.inputs.length > 0, 'migration');
      requireFact(migration.converter === null || text(migration.converter), 'migration');
      requireFact(migration.verifier === null || text(migration.verifier), 'migration');
      for (const id of migration.inputs) {
        requireFact(stores.get(id)?.use === 'migration-input', 'migration');
        consumed.add(id);
      }
    }
  }
  requireFact(facts.stores.every(store => store.use === 'backup-only' || consumed.has(store.id)), 'migration');
}

function bytes(value: number): number {
  requireFact(Number.isSafeInteger(value) && value >= 0, 'size');
  return value;
}
function sum(values: readonly number[]): number {
  return values.reduce((total, value) => bytes(total + bytes(value)), 0);
}
function capacity(facts: CutoverFacts): CutoverPreparation['space'] {
  uniqueIds(facts.volumes.map(volume => volume.id), 'volume');
  const destinations = new Set([facts.destinations.backup.volume, facts.destinations.runtime.volume]);
  requireFact(facts.volumes.length === destinations.size && facts.volumes.every(volume => destinations.has(volume.id)), 'volume');
  const backup = sum(facts.stores.map(store => store.bytes));
  const runtime = sum([facts.releaseBytes, ...facts.migrations.flatMap(migration => migration.selection === 'convert' ? [migration.bytes] : [])]);
  return [...facts.volumes].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(volume => ({
    volume: volume.id,
    requiredBytes: sum([volume.reserveBytes, volume.id === facts.destinations.backup.volume ? backup : 0, volume.id === facts.destinations.runtime.volume ? runtime : 0]),
    availableBytes: bytes(volume.availableBytes),
  }));
}

function byId<T extends {id: string}>(values: readonly T[]): T[] {
  return [...values].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
/** Project only this model's fields in fixed order; arrays that represent sets are sorted. */
function normalize(facts: CutoverFacts): CutoverFacts {
  const destination = ({path, volume}: DestinationFact): DestinationFact => ({path, volume});
  const migrations: MigrationFact[] = MIGRATION_ORDER.map(group => {
    const migration = facts.migrations.find(entry => entry.group === group);
    requireFact(migration !== undefined, 'migration');
    return migration.selection === 'not-configured'
      ? {group, selection: 'not-configured', reason: migration.reason}
      : {group, selection: 'convert', inputs: [...migration.inputs].sort(), bytes: migration.bytes, converter: migration.converter, verifier: migration.verifier};
  });
  return {
    owner: facts.owner, source: {revision: facts.source.revision, tree: facts.source.tree},
    destinations: {backup: destination(facts.destinations.backup), runtime: destination(facts.destinations.runtime)},
    volumes: byId(facts.volumes).map(({id, availableBytes, reserveBytes}) => ({id, availableBytes, reserveBytes})),
    releaseBytes: facts.releaseBytes,
    writers: byId(facts.writers).map(({id, kind, target}) => ({id, kind, target})),
    stores: byId(facts.stores).map(({id, path, kind, bytes, sha256, writers, use}) => ({id, path, kind, bytes, sha256, writers: [...writers].sort(), use})),
    migrations,
  };
}

export function prepareCutover(input: CutoverFacts): CutoverPreparation {
  validateInventory(input);
  const facts = normalize(input);
  const writers = facts.writers.map(writer => writer.id).sort();
  const stores = facts.stores.map(store => store.id).sort();
  const conversions = MIGRATION_ORDER.flatMap(group => {
    const migration = facts.migrations.find(entry => entry.group === group);
    return migration?.selection === 'convert' ? [migration] : [];
  });
  const steps: PreparationStep[] = [
    {kind: 'stop-writers', writers}, {kind: 'backup', stores}, {kind: 'verify-backups', stores},
    ...conversions.map(migration => ({kind: 'convert' as const, group: migration.group, inputs: [...migration.inputs].sort()})),
    {kind: 'verify-conversions', groups: conversions.map(migration => migration.group)},
    {kind: 'await-execution-qualification'},
  ];
  const space = capacity(facts);
  const blockers: PreparationBlocker[] = [];
  for (const migration of conversions) {
    if (migration.converter === null) blockers.push({kind: 'missing-converter', group: migration.group});
    if (migration.verifier === null) blockers.push({kind: 'missing-verifier', group: migration.group});
  }
  for (const volume of space) {
    if (volume.requiredBytes > volume.availableBytes) blockers.push({kind: 'insufficient-space', ...volume});
  }
  const bound = {
    kind: 'runtime-cutover-preparation' as const, execution: 'unavailable' as const,
    status: blockers.length === 0 ? 'prepared' as const : 'blocked' as const, facts, steps, space, blockers,
  };
  return {...bound, digest: createHash('sha256').update(JSON.stringify(bound)).digest('hex')};
}

/** Checks unchanged input content only; it grants no authority to execute. */
export function assertPreparationDigest(facts: CutoverFacts, digest: string): void {
  if (!/^[a-f0-9]{64}$/.test(digest) || prepareCutover(facts).digest !== digest) throw new Error('cutover-preparation-changed');
}
