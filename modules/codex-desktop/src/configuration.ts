// The Codex Desktop module's section of the runtime's configuration file (Hub #926), and the cutover's conversion of
// the old Hub's `codexDesktop` setting into it, which the installer (#935) runs at #840. The section keeps the Hub's
// three members and its checks (`codexDesktopOptions` in apps/hub/src/codex-desktop.ts at main 8590332f): the Codex
// home, an absolute normalized path, which may lie on a Windows mount, and the neutral host and source IDs of the Codex
// Desktop producer whose sessions the marker speaks for.
import {isAbsolute, normalize} from 'node:path';
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import type {Configured} from '@jimmie-potts/sdk';

export type CodexDesktopConfig = {
  /** The Codex home that holds Desktop's read marker, such as `/mnt/c/Users/<user>/.codex`. Never leaves the module. */
  readonly home: string;
  /** The Codex Desktop producer's host and source IDs: only its sessions get read evidence. */
  readonly hostId: string;
  readonly sourceId: string;
};

const MAX_HOME = 1024;
const ID = /^[A-Za-z0-9_.-]{1,128}$/;
/** The members a section may have: the Hub's three, and the runtime's `secrets`, which this module never reads. */
const MEMBERS = new Set(['home', 'hostId', 'sourceId', 'secrets']);
const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);
const refused = (detail: string): ErrorBody => errorBody('invalid-request', {detail});

/**
 * Checks the module's section: exactly `home`, an absolute normalized path of at most 1024 characters without a NUL,
 * and `hostId` and `sourceId`, each 1 to 128 letters, digits, underscores, dots or hyphens. A refusal's detail is fixed
 * text that repeats no value, since health shows it.
 */
export function configureCodexDesktop(section: unknown): Configured<CodexDesktopConfig> | ErrorBody {
  if (!isObject(section) || Object.keys(section).some(key => !MEMBERS.has(key))) return refused('the section has only home, hostId and sourceId');
  const {home, hostId, sourceId} = section;
  if (typeof home !== 'string' || home.length === 0 || home.length > MAX_HOME || home.includes('\0') || !isAbsolute(home) || normalize(home) !== home) {
    return refused('home must be an absolute, normalized path of at most 1024 characters');
  }
  if (typeof hostId !== 'string' || !ID.test(hostId) || typeof sourceId !== 'string' || !ID.test(sourceId)) {
    return refused('hostId and sourceId must each be 1 to 128 letters, digits, underscores, dots or hyphens');
  }
  return {config: {home, hostId, sourceId}};
}

/**
 * Converts the old Hub's host configuration (its `host.json`) into this module's section: its `codexDesktop` member as
 * it is, or undefined when the Hub reads no Codex Desktop marker, so the runtime then refuses the module with
 * `not-found` and runs on. The result is checked with the module's own `configure`, so a section the runtime would
 * refuse is refused here, with fixed text.
 */
export function convertHubCodexDesktop(hostConfiguration: unknown): {section: CodexDesktopConfig} | undefined | ErrorBody {
  if (!isObject(hostConfiguration)) return refused('the Hub\'s configuration is not an object');
  const setting = hostConfiguration.codexDesktop;
  if (setting === undefined) return undefined;
  if (!isObject(setting) || Object.hasOwn(setting, 'secrets')) return refused('the Hub\'s codexDesktop has only home, hostId and sourceId');
  const checked = configureCodexDesktop(setting);
  return 'error' in checked ? checked : {section: checked.config};
}
