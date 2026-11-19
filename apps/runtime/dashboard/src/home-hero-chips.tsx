import React from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {RuntimeData} from './runtime-feeds.ts';
import {lightingDevices} from './lighting.ts';
import {lightsChip, observedPower, plugsChip} from './home-hero.ts';

/** A Wemo plug's card calls an observation older than this stale (wemo.ts); the chip agrees with it. */
const PLUG_STALE_MS = 15_000;

/**
 * The hero's light and plug chips (#1930). Each links to the Devices page, where every light and plug has its card.
 * A device whose copy is stale, that is unavailable or whose power is not observed counts as unknown, never as off.
 */
export function HeroStatusChips({runtime, connected, now}: {runtime: RuntimeData; connected: boolean; now: number}): React.JSX.Element {
  const lights = lightsChip(lightingDevices(runtime.copies, connected).map(device => observedPower(device.record, device.live)));
  const plugs = plugsChip(runtime.copies.filter(copy => copy.family === 'device' && copy.owner === 'bunny/modules/wemo').flatMap(copy =>
    (copy.records as readonly DeviceRecord[]).filter(record => record.kind === 'wemo').map(record => ({name: record.label ?? record.id,
      power: observedPower(record, connected && copy.synced, now, PLUG_STALE_MS)}))));
  return <>
    {lights !== undefined && <a className="home-hero-chip" data-glass-veil href="#/devices" data-hero-chip="lights">{lights}</a>}
    {plugs !== undefined && <a className="home-hero-chip" data-glass-veil href="#/devices" data-hero-chip="plugs">{plugs}</a>}
  </>;
}
