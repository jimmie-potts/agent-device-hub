// The Codex Desktop module's section of the runtime's configuration file (Hub #926, #567), and the cutover's conversion
// of the old Hub's `codexDesktop` setting into it, which the installer (#935) runs at #840. The released section keeps
// the Hub's three members and its checks (`codexDesktopOptions` in apps/hub/src/codex-desktop.ts at main 8590332f): the
// Codex home, an absolute normalized path, which may lie on a Windows mount, and the neutral host and source IDs of the
// Codex Desktop producer whose sessions the marker speaks for. Hub #567 adds the `sources` form: each source is read
// locally from its `home`, or, without one, fed by a host-local collector's snapshots over the bus.
import {isAbsolute, normalize} from 'node:path';
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import type {Configured} from '@jimmie-potts/sdk';

/** One Codex Desktop producer the module gives evidence for: read locally from `home`, or remotely without one. */
export type DesktopSourceConfig = {
  /** The Codex home that holds Desktop's read marker, such as `/mnt/c/Users/<user>/.codex`. Never leaves the module. */
  readonly home?: string;
  /** The Codex Desktop producer's host and source IDs: only its sessions get read evidence. */
  readonly hostId: string;
  readonly sourceId: string;
};
export type CodexDesktopConfig = {
  /** The configured sources, in the section's order; at least one. */
  readonly sources: readonly DesktopSourceConfig[];
  /** Whether the section was the released single-source form, which health shows as it did. */
  readonly legacy: boolean;
};
/** The released single-source section, as the Hub's `codexDesktop` setting. */
export type LegacySection = {readonly home: string; readonly hostId: string; readonly sourceId: string};

const MAX_HOME = 1024;
/** How many sources one module may follow. */
export const MAX_SOURCES = 4;
const ID = /^[A-Za-z0-9_.-]{1,128}$/;
/** The members a released section may have: the Hub's three, and the runtime's `secrets`, which this module never reads. */
const LEGACY_MEMBERS = new Set(['home', 'hostId', 'sourceId', 'secrets']);
const SOURCES_MEMBERS = new Set(['sources', 'secrets']);
const SOURCE_MEMBERS = new Set(['home', 'hostId', 'sourceId']);
const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);
const refused = (detail: string): ErrorBody => errorBody('invalid-request', {detail});
const HOME_DETAIL = 'home must be an absolute, normalized path of at most 1024 characters';
const ID_DETAIL = 'hostId and sourceId must each be 1 to 128 letters, digits, underscores, dots or hyphens';

const validHome = (home: unknown): home is string =>
  typeof home === 'string' && home.length > 0 && home.length <= MAX_HOME && !home.includes('\0') && isAbsolute(home) && normalize(home) === home;
const validId = (id: unknown): id is string => typeof id === 'string' && ID.test(id);

/** Checks one source of the `sources` form: exactly `hostId` and `sourceId`, and optionally `home`. */
function configureSource(source: unknown): DesktopSourceConfig | ErrorBody {
  if (!isObject(source) || Object.keys(source).some(key => !SOURCE_MEMBERS.has(key))) return refused('each source has only hostId, sourceId and an optional home');
  const {home, hostId, sourceId} = source;
  if (!validId(hostId) || !validId(sourceId)) return refused(ID_DETAIL);
  if (home === undefined) return {hostId, sourceId};
  if (!validHome(home)) return refused(HOME_DETAIL);
  return {home, hostId, sourceId};
}

/**
 * Checks the module's section. The released form has exactly `home`, an absolute normalized path of at most 1024
 * characters without a NUL, and `hostId` and `sourceId`, each 1 to 128 letters, digits, underscores, dots or hyphens.
 * The `sources` form has exactly `sources`: 1 to 4 sources, each with `hostId` and `sourceId` so checked and an optional
 * `home`, with no two sources naming the same host and source, so one producer is never collected twice. A refusal's
 * detail is fixed text that repeats no value, since health shows it.
 */
export function configureCodexDesktop(section: unknown): Configured<CodexDesktopConfig> | ErrorBody {
  if (!isObject(section)) return refused('the section has either home, hostId and sourceId, or sources');
  const keys = Object.keys(section);
  if (Object.hasOwn(section, 'sources')) {
    if (keys.some(key => !SOURCES_MEMBERS.has(key))) return refused('the section has either home, hostId and sourceId, or sources');
    const {sources} = section;
    if (!Array.isArray(sources) || sources.length === 0 || sources.length > MAX_SOURCES) return refused(`sources must list 1 to ${MAX_SOURCES} sources`);
    const checked: DesktopSourceConfig[] = [];
    const seen = new Set<string>();
    for (const source of sources) {
      const result = configureSource(source);
      if ('error' in result) return result;
      const producer = JSON.stringify([result.hostId, result.sourceId]);
      if (seen.has(producer)) return refused('no two sources may name the same host and source');
      seen.add(producer);
      checked.push(result);
    }
    return {config: {sources: checked, legacy: false}};
  }
  if (keys.some(key => !LEGACY_MEMBERS.has(key))) return refused('the section has either home, hostId and sourceId, or sources');
  const {home, hostId, sourceId} = section;
  if (!validHome(home)) return refused(HOME_DETAIL);
  if (!validId(hostId) || !validId(sourceId)) return refused(ID_DETAIL);
  return {config: {sources: [{home, hostId, sourceId}], legacy: true}};
}

/** Whether a section names only remote sources: no `home` anywhere, so the module reads no local file for it. */
export function remoteOnlySection(section: unknown): boolean {
  const checked = configureCodexDesktop(section);
  return !('error' in checked) && checked.config.sources.every(source => source.home === undefined);
}

/**
 * Converts the old Hub's host configuration (its `host.json`) into this module's released section: its `codexDesktop`
 * member as it is, or undefined when the Hub reads no Codex Desktop marker, so the runtime then refuses the module with
 * `not-found` and runs on. The result is checked with the module's own `configure`, so a section the runtime would
 * refuse is refused here, with fixed text.
 */
export function convertHubCodexDesktop(hostConfiguration: unknown): {section: LegacySection} | undefined | ErrorBody {
  if (!isObject(hostConfiguration)) return refused('the Hub\'s configuration is not an object');
  const setting = hostConfiguration.codexDesktop;
  if (setting === undefined) return undefined;
  if (!isObject(setting) || Object.hasOwn(setting, 'secrets') || Object.hasOwn(setting, 'sources')) return refused('the Hub\'s codexDesktop has only home, hostId and sourceId');
  const checked = configureCodexDesktop(setting);
  if ('error' in checked) return checked;
  const [source] = checked.config.sources;
  if (source?.home === undefined) return refused('the Hub\'s codexDesktop has only home, hostId and sourceId');
  return {section: {home: source.home, hostId: source.hostId, sourceId: source.sourceId}};
}
