import {recordLog, type Logger} from '@jimmie-potts/sdk';
import type {WrittenChange} from './history.js';

const HOUR_MS = 3_600_000;
const ROW_THRESHOLD = 120;
const NEUTRAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ROUTING_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DIGEST_ID = /^[0-9a-f]{64}$/;
const UUID_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export type HistoryDevice = {owner: string; id: string};

type AdmittedModule = {name: string; admitted: boolean; devices: readonly string[]; config: unknown};

/** The host's admitted machine IDs. Volcano declares no controllable device, but its read-only device record uses its configured ID. */
export function historyDevices(modules: readonly AdmittedModule[]): HistoryDevice[] {
  return modules.flatMap(({name, admitted, devices, config}) => {
    if (!admitted) return [];
    const owner = `bunny/modules/${name}`;
    const readOnlyId: unknown = name === 'volcano' && config !== null && typeof config === 'object'
      ? Object.getOwnPropertyDescriptor(config, 'id')?.value : undefined;
    return [...devices, readOnlyId]
      .filter((id): id is string => typeof id === 'string' && id.length <= 128 && ROUTING_ID.test(id))
      .map(id => ({owner, id}));
  });
}

const SINGLETONS: Readonly<Record<string, string>> = {
  'bunny/core:mode': 'hub',
  'bunny/core:art-schedule': 'art',
  'bunny/core:music-capture-state': 'music',
  'bunny/core:lighting-layout': 'lighting',
  'bunny/core:playback-layout': 'playback',
  'bunny/core:home-layout': 'home',
  'bunny/modules/art:art': 'art',
  'bunny/modules/companions:assistant-state': 'assistant',
  'bunny/modules/companions:coding-state': 'coding',
  'bunny/modules/companions:companion-state': 'reachy',
  'bunny/modules/companions:companion-speech-state': 'reachy',
  'bunny/modules/companions:preference-state': 'preferences',
  'bunny/modules/nanoleaf:nanoleaf-reactive-presets': 'reactive-presets',
  'bunny/modules/nanoleaf:nanoleaf-shows': 'shows',
  'bunny/modules/weather:weather-state': 'local',
};

const GENERATED: Readonly<Record<string, RegExp>> = {
  'bunny/core:session': DIGEST_ID,
  'bunny/core:operation': DIGEST_ID,
  'bunny/core:inbox-item': DIGEST_ID,
  'bunny/modules/pixoo:pixoo-rendition': DIGEST_ID,
  'bunny/modules/pixoo:pixoo-playlist': UUID_ID,
};

const DEVICE_VIEW_OWNERS: Readonly<Record<string, string>> = {
  'lifx-light': 'bunny/modules/lifx',
  'microduck-state': 'bunny/modules/microduck',
  'music-lighting-device': 'bunny/modules/nanoleaf',
  'nanoleaf-animations': 'bunny/modules/nanoleaf',
  'nanoleaf-wall': 'bunny/modules/nanoleaf',
  'pixoo-display': 'bunny/modules/pixoo',
  'playback': 'bunny/modules/playback',
  'playback-position': 'bunny/modules/playback',
  'reachy-state': 'bunny/modules/reachy-mini',
  'roborock-vacuum': 'bunny/modules/roborock',
};

/** The core's in-memory counter for committed history changes. Its keys are approved machine identities only. */
export class HistoryAlarm {
  readonly #counts = new Map<number, Map<string, number>>();
  readonly #devices: ReadonlySet<string>;
  readonly #deviceIds: ReadonlySet<string>;
  #latestHour: number | undefined;

  constructor(readonly log: Logger, devices: readonly HistoryDevice[]) {
    this.#devices = new Set(devices.map(({id, owner}) => JSON.stringify([owner, id])));
    this.#deviceIds = new Set(devices.map(({id}) => id));
  }

  #approved({source, family, id}: WrittenChange): boolean {
    if (!NEUTRAL_ID.test(id)) return false;
    const key = `${source}:${family}`;
    if (Object.hasOwn(SINGLETONS, key)) return id === SINGLETONS[key];
    if (Object.hasOwn(GENERATED, key)) return GENERATED[key]?.test(id) === true;
    if (source === 'bunny/core') {
      return family === 'power-limit' ? this.#deviceIds.has(id)
        : family === 'music-lighting-state' && this.#devices.has(JSON.stringify(['bunny/modules/nanoleaf', id]));
    }
    return (family === 'device' || DEVICE_VIEW_OWNERS[family] === source) && this.#devices.has(JSON.stringify([source, id]));
  }

  committed(changes: readonly WrittenChange[], atMs: number): void {
    if (changes.length === 0) return;
    const hour = Math.floor(atMs / HOUR_MS);
    const latest = this.#latestHour;
    if (latest === undefined || hour > latest || hour < latest - 1) {
      if (latest !== undefined && hour === latest + 1) this.#counts.delete(latest - 1);
      else this.#counts.clear();
      this.#latestHour = hour;
    }
    const counts = this.#counts.get(hour) ?? new Map<string, number>();
    this.#counts.set(hour, counts);
    for (const change of changes) {
      if (!this.#approved(change)) continue;
      const {source, family, id, trace} = change;
      const key = JSON.stringify([source, family, id]);
      const count = counts.get(key) ?? 0;
      if (count > ROW_THRESHOLD) continue;
      counts.set(key, count + 1);
      if (count !== ROW_THRESHOLD) continue;
      try {
        recordLog(this.log, 'history.entity.noisy', {
          'bunny.participant': source, 'bunny.history.family': family, 'bunny.history.entity_id': id,
          'bunny.history.row_count': count + 1, 'bunny.history.row_threshold': ROW_THRESHOLD,
          'bunny.history.hour_start_at_ms': hour * HOUR_MS,
        }, trace);
      } catch {
        // A logger failure cannot affect the committed row or publication.
      }
    }
  }
}
