// The hero's status chips (#1930): short, truthful summaries of the lights and plugs from the observed device records
// the shell already holds. They read nothing else and send nothing.
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';

export type Observed = 'on' | 'off' | 'unknown';
/**
 * A device's observed power: known only from a synced copy, an available device and an observation of its power, and
 * no older than `maxAgeMs` when the device's own card treats older readings as stale (a Wemo plug's 15 seconds).
 * Requested power is not observed power.
 */
export function observedPower(record: DeviceRecord, live: boolean, now?: number, maxAgeMs?: number): Observed {
  const observed = record.observed;
  if (!live || record.availability !== 'available' || observed.status !== 'known' || observed.power.status !== 'known') return 'unknown';
  if (now !== undefined && maxAgeMs !== undefined && now - observed.observedAtMs > maxAgeMs) return 'unknown';
  return observed.power.value ? 'on' : 'off';
}
const unknownPart = (count: number): string => count === 0 ? '' : ` · ${String(count)} unknown`;
/** "2 lights on", "No lights on", with how many are unknown; nothing without lights. */
export function lightsChip(lights: readonly Observed[]): string | undefined {
  if (lights.length === 0) return undefined;
  const on = lights.filter(power => power === 'on').length, unknown = lights.filter(power => power === 'unknown').length;
  if (unknown === lights.length) return lights.length === 1 ? 'Light unknown' : 'Lights unknown';
  return `${on === 0 ? 'No lights on' : `${String(on)} ${on === 1 ? 'light' : 'lights'} on`}${unknownPart(unknown)}`;
}
/** "Shelf lamp on", "Shelf lamp and Desk lamp on", "3 plugs on" or "Plugs off", with how many are unknown; nothing without plugs. */
export function plugsChip(plugs: readonly {name: string; power: Observed}[]): string | undefined {
  if (plugs.length === 0) return undefined;
  const on = plugs.filter(plug => plug.power === 'on').map(plug => plug.name), unknown = plugs.filter(plug => plug.power === 'unknown').length;
  if (unknown === plugs.length) return plugs.length === 1 ? `${plugs[0]?.name ?? 'Plug'} unknown` : 'Plugs unknown';
  const base = on.length === 0 ? plugs.length === 1 ? `${plugs[0]?.name ?? 'Plug'} off` : 'Plugs off' : on.length <= 2 ? `${on.join(' and ')} on` : `${String(on.length)} plugs on`;
  return `${base}${unknownPart(unknown)}`;
}
