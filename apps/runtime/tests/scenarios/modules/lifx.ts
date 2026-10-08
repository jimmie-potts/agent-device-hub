// The LIFX module's scenarios (Hub #928, #999). The catalog collects this file.
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {LIFX_SIMULATED_SECTION, PACKET, type LifxDeviceState} from '@jimmie-potts/lifx';
import type {CommandDraft} from '@jimmie-potts/sdk';
import {approvalPrompt, approvalResolved, sessionStarted, turnStarted} from '../../fixtures/agents.js';
import {
  CORE_FAMILIES, act, answered, bodyOf, deviceState, dispatchOnce, expect, holds, inboxOf, keep, outcomesOf, publish, rawCommand, rawRequest, recorded,
  refusedWith, running, show, waiting, type GatewayAnswer, type Harness, type Outcome, type Scenario,
} from '../framework.js';

/** What the simulated bulbs show. */
const bulbState = (h: Harness): LifxDeviceState => deviceState<LifxDeviceState>(h, 'lifx');

/** The LIFX module's section (Hub #919, #928): its factory's simulated section, `pendant-1` and the unqualified Beam. */
export const LIFX_SECTION = LIFX_SIMULATED_SECTION;
const PENDANT_AT = '192.0.2.40';
const BEAM_AT = '192.0.2.41';
/** The documentation network every simulated bulb's address is in, so a leak of any bulb's address shows. */
const BULB_NETWORK = '192.0.2.';
/** The hue in degrees each agent status paints, from the shared status colors. */
const STATUS_HUE = {attention: 38, working: 218, done: 135} as const;
/** A command the operator sends one bulb, as the dashboard would. */
const bulbCommand = (family: string, type: string, id: string, data: object, dataschema = `https://bunny.invalid/events/${family}/2.0`): {key: string; draft: CommandDraft<object>} =>
  ({key: `bunny.cmd.${family}.${id}`, draft: {type, subject: id, dataschema, data}});
const lifxMode = (mode: string): {key: string; draft: CommandDraft<object>} => bulbCommand('device-mode-set', 'org.bunny.device-mode.set.requested', 'pendant-1', {mode});
/** How many writes, paints and commands alike, the simulated bulb at `address` got. */
const lifxWrites = (h: Harness, address = PENDANT_AT): number =>
  bulbState(h).packets.filter(packet => packet.address === address && (packet.type === PACKET.setColor || packet.type === PACKET.setPower)).length;
/** Whether pendant-1 shows `expected`, each value in degrees, percent or kelvin, within one unit. */
const pendantShows = (h: Harness, expected: {hue?: number; saturation?: number; brightness?: number; kelvin?: number}): Outcome => {
  const color = bulbState(h).bulbs[PENDANT_AT]?.color;
  if (color === undefined) return 'pendant-1 is not simulated yet';
  const shown = {
    hue: Math.round((color.hue * 360) / 65535), saturation: Math.round((color.saturation * 100) / 65535),
    brightness: Math.round((color.brightness * 100) / 65535), kelvin: color.kelvin,
  };
  const close = Object.entries(expected).every(([key, value]) => Math.abs(shown[key as keyof typeof shown] - value) <= 1);
  return close || `pendant-1 shows ${show(shown)}`;
};
/** The LIFX module's source: `device` is a shared family, so its reader names the owner it syncs from (Hub #967). */
const LIFX_OWNER = 'bunny/modules/lifx';
const lifxDevice = (h: Harness, id: string): DeviceRecord | undefined =>
  h.reader.states<DeviceRecord>('device', LIFX_OWNER).find(state => state.data.id === id)?.data;

/**
 * The LIFX module (Hub #928) with a simulated pendant-1 and Beam: in Work the bulb follows the core's sessions, painting
 * only when the shown status changes; a restart writes nothing; in Free nothing paints it; a color command reaches it;
 * switched off at the wall, it is reported unavailable and a command to it ends uncertain, in the inbox. The Beam is
 * listed with no controls and never reached, and no address leaves the module.
 */
const lifxBulbs: Scenario = {
  id: 'lifx-bulbs',
  title: 'the LIFX bulbs follow agent status in Work, rest in Free, take a color, and report an unreachable bulb',
  seed: {modules: ['core', 'lifx'], follows: [CORE_FAMILIES, {owner: LIFX_OWNER, families: ['device', 'lifx-light']}], config: {lifx: LIFX_SECTION}},
  steps: [
    expect('the core and the LIFX module are running', h => running(h, ['core', 'lifx'])),
    expect('the reader holds pendant-1 available, in free, with its controls, and the Beam with none', h => {
      const pendant = lifxDevice(h, 'pendant-1'), beam = lifxDevice(h, 'beam');
      const ready = pendant?.availability === 'available' && pendant.desired.mode.status === 'known' && pendant.desired.mode.value === 'free' && pendant.capabilities.power.supported;
      return (ready && beam !== undefined && Object.values(beam.capabilities).every(capability => !capability.supported)) ||
        `pendant-1 ${String(pendant?.availability)}, beam ${show(beam?.capabilities)}`;
    }),
    // A part whose grant may only read may not command a bulb, and a command whose subject names another bulb than its
    // key's is refused before the module has it (Hub #835). No grant limits a part to some bulbs: every reader reads them.
    expect('the reader, whose grant may only read, may not command pendant-1', async h => refusedWith(keep(h, await h.gateway(rawRequest('reader',
      lifxMode('work').key, rawCommand(h, 'bunny/parts/reader', lifxMode('work'), 'req-lifx-reader', 'msg-lifx-reader')))), 403, 'forbidden')),
    expect('the reader and the panel read both bulbs\' device records', async h => {
      const panel = keep(h, await h.gateway({as: 'panel', method: 'GET', path: '/api/v2/families/device'}));
      const reader = keep(h, await h.gateway({as: 'reader', method: 'GET', path: '/api/v2/families/device'}));
      const ids = (answer: GatewayAnswer): string => show(bodyOf<{records?: {id: string}[]}>(answer)?.records?.map(record => record.id).sort());
      return (ids(panel) === show(['beam', 'pendant-1']) && ids(reader) === show(['beam', 'pendant-1'])) || `panel ${ids(panel)}, reader ${ids(reader)}`;
    }),
    expect('nor may the operator request it directly: a bulb\'s command goes through the core\'s dispatcher (#782)', async h => refusedWith(keep(h, await h.gateway(rawRequest('operator',
      lifxMode('work').key, rawCommand(h, 'bunny/parts/operator', lifxMode('work'), 'req-lifx-direct', 'msg-lifx-direct')))), 403, 'forbidden')),
    act('the operator sets pendant-1 to work as req-work, through the core\'s dispatcher', h => dispatchOnce(h, 'operator', 'work', lifxMode('work'), 'req-work')),
    expect('history holds req-work succeeded, and the reader shows pendant-1 in work', h =>
      recorded(h, 'req-work', 'succeeded', 'transmitted') === true ? show(lifxDevice(h, 'pendant-1')?.desired.mode) === show({status: 'known', value: 'work'}) || 'not in work' :
        recorded(h, 'req-work', 'succeeded', 'transmitted')),
    expect('pendant-1 paints idle: warm white at half brightness', h => pendantShows(h, {saturation: 0, brightness: 50, kelvin: 2700})),
    act('the hook observes a session start and a turn', async h => {
      await publish(h, sessionStarted);
      await publish(h, turnStarted);
    }),
    expect('pendant-1 paints working blue', h => pendantShows(h, {hue: STATUS_HUE.working, brightness: 50})),
    act('the hook observes an approval prompt', h => publish(h, approvalPrompt('approval-1'))),
    expect('pendant-1 paints attention amber', h => pendantShows(h, {hue: STATUS_HUE.attention, brightness: 50})),
    holds('pendant-1 got one paint per change: idle, working and attention', h => lifxWrites(h) === 3 || `${lifxWrites(h)} writes`, 500),
    act('the runtime restarts cleanly while the approval still waits', h => h.restart()),
    expect('the core and the LIFX module are running again', h => running(h, ['core', 'lifx'])),
    holds('the restart wrote nothing to pendant-1, which still shows attention', h =>
      (lifxWrites(h) === 3 && pendantShows(h, {hue: STATUS_HUE.attention}) === true) || `${lifxWrites(h)} writes`, 1000),
    act('the operator sets pendant-1 to free as req-free', h => dispatchOnce(h, 'operator', 'free', lifxMode('free'), 'req-free')),
    expect('history holds req-free succeeded', h => recorded(h, 'req-free', 'succeeded', 'transmitted')),
    act('the hook observes the approval resolved', h => publish(h, approvalResolved('approval-1'))),
    expect('the reader\'s session no longer waits', h => waiting(h, [])),
    holds('in free nothing paints pendant-1, which keeps its amber', h =>
      (lifxWrites(h) === 3 && pendantShows(h, {hue: STATUS_HUE.attention}) === true) || `${lifxWrites(h)} writes`, 1000),
    act('the operator sets pendant-1 to hue 120 at full saturation as req-color', h =>
      dispatchOnce(h, 'operator', 'color', bulbCommand('lifx-color-set', 'org.bunny.lifx-color.set.requested', 'pendant-1', {hue: 120, saturation: 100}), 'req-color')),
    expect('pendant-1 shows green, and history holds req-color succeeded', h =>
      pendantShows(h, {hue: 120, saturation: 100}) === true ? recorded(h, 'req-color', 'succeeded', 'transmitted') : pendantShows(h, {hue: 120, saturation: 100})),
    act('pendant-1 is switched off at the wall', h => { h.simulate({device: 'lifx', action: 'offline', address: PENDANT_AT}); }),
    act('the operator switches pendant-1 off as req-off; the module accepts it', h =>
      dispatchOnce(h, 'operator', 'off', bulbCommand('power-set', 'org.bunny.power.set.requested', 'pendant-1', {on: false}), 'req-off')),
    expect('history holds req-off uncertain, with no evidence it reached the bulb, and the inbox holds it', h => {
      const rows = outcomesOf(h, 'req-off').map(entry => `${entry.result}/${entry.evidence}`);
      const items = inboxOf(h, 'req-off');
      return (show(rows) === show(['uncertain/none']) && items.length === 1) || `history ${show(rows)}, inbox ${show(items)}`;
    }, 5000),
    expect('the reader shows pendant-1 unavailable', h => lifxDevice(h, 'pendant-1')?.availability === 'unavailable' || String(lifxDevice(h, 'pendant-1')?.availability)),
    act('the operator asks the Beam to switch on', h => h.dispatch('operator', 'beam', bulbCommand('power-set', 'org.bunny.power.set.requested', 'beam', {on: true}), 'req-beam')),
    expect('the Beam refuses it: it offers no power control', h => answered(h, 'beam', 'unsupported-capability')),
    holds('the Beam got no packet, and no message or record carries a bulb\'s address', h => {
      const places = [h.logs(), h.published(), h.reader.heard(), ...h.reader.families().map(family => h.reader.states(family))];
      const leaked = places.some(value => JSON.stringify(value).includes(BULB_NETWORK));
      const packets = bulbState(h).packets.filter(packet => packet.address === BEAM_AT).length;
      return (packets === 0 && !leaked) || `${packets} packets to the Beam, address leaked: ${String(leaked)}`;
    }, 300),
  ],
};

export const scenarios: readonly Scenario[] = [lifxBulbs];
