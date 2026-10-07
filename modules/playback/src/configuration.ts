// The playback module's section of the runtime's configuration file (Hub #919, #929), and the conversion of the old
// Hub's `host.json` `playback` block into it, which the cutover's installer (#935) runs. The speaker addresses stay in
// the private configuration file: no refusal, message, record or health entry repeats one.
import {isIPv4} from 'node:net';
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import type {Configured} from '@jimmie-potts/sdk';
import {exact, object} from './common.js';
import {sonosConfiguration} from './sonos.js';
import {sonyConfiguration} from './sony.js';
import type {SourceConfiguration} from './sources.js';

/**
 * The module's configuration: the playback record's routing ID, which every client sees and which never changes with
 * the presented speaker, and one or two speakers in preference order, at most one of each kind.
 */
export type PlaybackConfig = {readonly id: string; readonly sources: readonly SourceConfiguration[]};
/** The module's section as the installer writes it, without the `secrets` member it does not need. */
export type PlaybackSection = {id: string; sources: {kind: SourceConfiguration['kind']; endpoint: string}[]};

const ROUTING_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID = 128;
/** The 1.x playback ID: 1 to 128 letters, digits, underscores, dots or hyphens. */
const HUB_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const SECTION_KEYS: readonly string[] = ['id', 'sources', 'secrets'];
const refuse = (detail: string): ErrorBody => errorBody('invalid-request', {detail});

/** The speakers, in order, or a refusal: one or two, each a valid Sony or Sonos entry, at most one of each kind. */
function speakers(value: unknown): SourceConfiguration[] | ErrorBody {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return refuse('sources must list one or two speakers');
  const sources: SourceConfiguration[] = [];
  for (const entry of value as unknown[]) {
    const kind = object(entry) ? entry.kind : undefined;
    const config = kind === 'sony' ? sonyConfiguration(entry) : kind === 'sonos' ? sonosConfiguration(entry) : undefined;
    if (config === undefined) {
      return refuse('each speaker must be {kind, endpoint}: a sony endpoint http://<private IPv4>:<port>/sony or a sonos endpoint http://<private IPv4>:<port>/MediaRenderer/AVTransport/Control');
    }
    if (sources.some(source => source.kind === config.kind)) return refuse('sources may list each kind of speaker once');
    sources.push(config);
  }
  return sources;
}

/**
 * The module's `configure`: `{id, sources}`, where `id` is a routing ID (lowercase letters and digits with single
 * hyphens, at most 128 characters) and `sources` lists one or two speakers in preference order. A `secrets` member,
 * which the runtime checks, is allowed and unused: the speakers take no credential. The module controls one device, the
 * playback record, so the runtime refuses another module that names the same ID.
 */
export function configurePlayback(section: unknown): Configured<PlaybackConfig> | ErrorBody {
  if (!object(section) || !Object.keys(section).every(key => SECTION_KEYS.includes(key))) {
    return refuse('the playback section has only id, sources and secrets');
  }
  const {id} = section;
  if (typeof id !== 'string' || id.length > MAX_ID || !ROUTING_ID.test(id)) {
    return refuse('id must be lowercase letters and digits with single hyphens, at most 128 characters');
  }
  const sources = speakers(section.sources);
  if (!Array.isArray(sources)) return sources;
  return {config: {id, sources}, devices: [id]};
}

/** The 1.x playback ID as a routing ID: lowercased, each run of other characters one hyphen, and `playback` if nothing is left. */
export function routingIdOf(id: string): string {
  const converted = id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return converted === '' ? 'playback' : converted;
}

/** What the conversion gives the installer: the module's section, and the 1.x ID when it had to be renamed. */
export type ConvertedPlayback = {section: PlaybackSection; renamedFrom?: string};

/**
 * Converts the old Hub's `host.json` `playback` block, `{id, sources}`, into the module's section, as the cutover's
 * installer (#935) writes it. It checks the block as the Hub did at its start, apart from the Hub's own aliases, and
 * keeps the speakers' addresses in their configured order. A 1.x ID outside the routing-ID form is renamed by
 * `routingIdOf`, and `renamedFrom` names it so the installer can report the rename (MAPPING.md, "Playback snapshot").
 * The Hub saves no playback preference beyond that order, so nothing else is carried: the configured order applies
 * from the first start (owner decision 10, 2026-10-06). A block the Hub would refuse is refused with fixed text.
 */
export function convertHostPlayback(block: unknown): ConvertedPlayback | ErrorBody {
  if (!object(block) || !exact(block, ['id', 'sources'])) return refuse('the playback block must be exactly {id, sources}');
  const {id} = block;
  if (typeof id !== 'string' || !HUB_ID.test(id) || isIPv4(id)) return refuse('the playback block\'s id must be a neutral ID');
  const sources = speakers(block.sources);
  if (!Array.isArray(sources)) return sources;
  // The Hub refused an ID that carries a speaker's address, which clients would see.
  if (sources.some(source => id.includes(new URL(source.endpoint).hostname))) return refuse('the playback block\'s id must not carry a speaker\'s address');
  const routed = routingIdOf(id);
  const section: PlaybackSection = {id: routed, sources: sources.map(({kind, endpoint}) => ({kind, endpoint}))};
  return routed === id ? {section} : {section, renamedFrom: id};
}
