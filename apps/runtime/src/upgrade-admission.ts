// Read-only binding of the coordinator's reviewed qualification decision.
// The production preflight supplies expected identities; this does not itself
// interpret recovery receipts or accept a runtime upgrade.
import {createHash} from 'node:crypto';
import {dirname, isAbsolute, relative, resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {checkStateDirectory, readPrivateFile} from './state.js';

type Pin = {path: string; sha256: string};
type Release = {kind: 'release'; sourceRevision: string; version: string; archiveSha256: string; manifestSha256: string};
type Releases = {previous: Release; target: Release; recovery: Release};
type Formats = {
  scope: 'runtime-durable-formats/1.0'; qualificationRevision: string; inventorySha256: string;
  inventories: {previous: Pin; target: Pin; recovery: Pin; qualification: Pin};
};
type Admission = {
  schema: 'runtime-proof-admission/1.0'; installationId: string;
  coordinator: {name: string; authority: Pin; admittedAt: string};
  releases: Releases; installedBaselineClosure: Pin; procedure: Pin;
  sourceReviews: {standards: Pin; specification: Pin}; formats: Formats;
  coverage: {owner: string; phases: {phase: string; receipt: Pin}[]}[];
};

export type UpgradeAdmissionExpected = {
  installationId: string; provenanceDirectory: string; releases: Releases; formats: Formats;
};

export type UpgradeAdmissionBinding = {
  schema: Admission['schema']; admissionSha256: string; installedBaselineClosure: Readonly<Pin>;
};

const owners = ['core', 'playback', 'nanoleaf', 'pixoo', 'tidbyt', 'lifx', 'sdk-outbox'];
const phases = ['baseline', 'candidate', 'recovery', 'reupgrade'];
const revision = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const text = (value: unknown, maximum = 128): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= maximum
    && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const refuse = (): never => { throw new Error('runtime-proof-admission-refused'); };

function closed(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

function pin(value: unknown): value is Pin {
  return closed(value, ['path', 'sha256']) && text(value.path, 4096)
    && isAbsolute(value.path) && resolve(value.path) === value.path && digest(value.sha256);
}

function release(value: unknown): value is Release {
  return closed(value, ['kind', 'sourceRevision', 'version', 'archiveSha256', 'manifestSha256'])
    && value.kind === 'release' && revision(value.sourceRevision) && text(value.version)
    && digest(value.archiveSha256) && digest(value.manifestSha256);
}

function formats(value: unknown): value is Formats {
  return closed(value, ['scope', 'qualificationRevision', 'inventorySha256', 'inventories'])
    && value.scope === 'runtime-durable-formats/1.0' && revision(value.qualificationRevision)
    && digest(value.inventorySha256) && closed(value.inventories, ['previous', 'target', 'recovery', 'qualification'])
    && Object.values(value.inventories).every(pin);
}

function exactNames(values: unknown[], names: string[]): boolean {
  return values.length === names.length && isDeepStrictEqual([...values].sort(), [...names].sort());
}

function admission(value: unknown): value is Admission {
  if (!closed(value, ['schema', 'installationId', 'coordinator', 'releases', 'installedBaselineClosure',
    'procedure', 'sourceReviews', 'formats', 'coverage']) || value.schema !== 'runtime-proof-admission/1.0'
    || !text(value.installationId) || !closed(value.coordinator, ['name', 'authority', 'admittedAt'])
    || !text(value.coordinator.name) || !pin(value.coordinator.authority) || !text(value.coordinator.admittedAt, 24)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.coordinator.admittedAt)) return false;
  const instant = Date.parse(value.coordinator.admittedAt);
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== value.coordinator.admittedAt
    || !closed(value.releases, ['previous', 'target', 'recovery']) || !Object.values(value.releases).every(release)
    || !pin(value.installedBaselineClosure) || !pin(value.procedure)
    || !closed(value.sourceReviews, ['standards', 'specification']) || !Object.values(value.sourceReviews).every(pin)
    || !formats(value.formats) || !Array.isArray(value.coverage) || value.coverage.length !== owners.length) return false;
  const names: string[] = [];
  for (const row of value.coverage) {
    if (!closed(row, ['owner', 'phases']) || !text(row.owner) || !Array.isArray(row.phases)
      || row.phases.length !== phases.length) return false;
    names.push(row.owner);
    const phaseNames: string[] = [];
    for (const phase of row.phases) {
      if (!closed(phase, ['phase', 'receipt']) || !text(phase.phase) || !pin(phase.receipt)) return false;
      phaseNames.push(phase.phase);
    }
    if (!exactNames(phaseNames, phases)) return false;
  }
  return exactNames(names, owners);
}

function inside(root: string, path: string): boolean {
  const name = relative(root, path);
  return name !== '' && !isAbsolute(name) && name !== '..' && !name.startsWith('../');
}

export async function bindUpgradeAdmission(path: string, expected: UpgradeAdmissionExpected): Promise<UpgradeAdmissionBinding> {
  try {
    const root = await checkStateDirectory(expected.provenanceDirectory);
    if (resolve(path) !== path || !inside(root, path)) refuse();
    const bytes = await readPrivateFile(path, 256 * 1024);
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (!admission(value) || value.installationId !== expected.installationId
      || !isDeepStrictEqual(value.releases, expected.releases) || !isDeepStrictEqual(value.formats, expected.formats)) return refuse();
    const pins = [value.coordinator.authority, value.installedBaselineClosure, value.procedure,
      ...Object.values(value.sourceReviews), ...Object.values(value.formats.inventories),
      ...value.coverage.flatMap(row => row.phases.map(phase => phase.receipt))];
    for (const evidence of pins) {
      if (!inside(root, evidence.path)) refuse();
      await checkStateDirectory(dirname(evidence.path));
      if (sha256(await readPrivateFile(evidence.path, 8 * 1024 * 1024)) !== evidence.sha256) refuse();
    }
    if (!bytes.equals(await readPrivateFile(path, 256 * 1024))) refuse();
    return {schema: value.schema, admissionSha256: sha256(bytes), installedBaselineClosure: {...value.installedBaselineClosure}};
  } catch {
    // Paths, documents, parsing failures and underlying private-file messages
    // never escape into publishable operator diagnostics.
    return refuse();
  }
}
