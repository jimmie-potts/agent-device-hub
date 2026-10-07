// The two-device harness: record.DeviceCase's steps on the control harness, with the 15 straight Lines and NL22 Panels
// registered as two devices, each with its own fake at its own address (recorded/devices.json).
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import type {TestContext} from 'node:test';
import type {Json} from '../src/compat.js';
import {loadConfig, registeredDevices} from '../src/configuration.js';
import {DEFAULT, lockFile, metaKey, sceneFile} from '../src/devices.js';
import * as edits from '../src/edits.js';
import {ANIMATION, journal} from '../src/journal.js';
import {setMode as commandMode, modeStatus} from '../src/modes.js';
import {requestPatch, type Patch} from '../src/project-map.js';
import {first, transaction} from '../src/sqlite.js';
import {markDirty} from '../src/store.js';
import type {LightRequest} from '../src/transport.js';
import {recordFailure} from '../src/worker.js';
import {compareOutcomes, compareSteps, ControlCase, type Summary} from './control-support.js';
import {fixtureJson} from './support.js';
import {outcomeOf, SceneDevice, type Call, type Outcome, type Step} from './worker-support.js';

export const LINES_IP = '192.0.2.1';
export const PANELS_IP = '192.0.2.2';
export const MOVED_IP = '192.0.2.4';

interface DeviceState {
  selected: string;
  brightness: number;
  on: boolean;
}

interface RecordedCase {
  name: string;
  panels?: number;
  steps: Step[];
  outcomes: Outcome[];
  hooks: Outcome[][];
  calls: Call[];
  panelsCalls: Call[];
  addresses: unknown[];
  rows: Record<string, unknown[][]>;
  scenes: Record<'wall' | 'panels', unknown>;
  devices: Record<'wall' | 'panels', DeviceState>;
  receipts: Record<string, Summary | null>;
  clock: number;
}

const RECORDED = fixtureJson('recorded/devices.json') as {setups: Record<string, Record<string, string>>; cases: RecordedCase[]};

const textOf = (value: Json | undefined): string => {
  if (typeof value !== 'string') throw new TypeError('A step names its device with text.');
  return value;
};

/** record.DeviceCase: DeviceWorkerTest on shared input, with commands through the port's admission. */
export class DeviceCase extends ControlCase {
  readonly lines: SceneDevice;
  readonly panels = new SceneDevice(this.clock);
  /** Each request's address, method and endpoint, and a mark where a step moved a device. */
  readonly addresses: unknown[] = [];
  readonly locks = new Map<string, DatabaseSync>();

  constructor(context: TestContext, panels = 18) {
    super(context);
    this.lines = this.device;
    this.panels.names = ['Forest', 'Sunset'];
    [this.panels.selected, this.panels.brightness] = ['Forest', 64];
    const setup = RECORDED.setups[String(panels)];
    assert.ok(setup !== undefined, `No recorded setup for ${String(panels)} Panels.`);
    for (const [name, text] of Object.entries(setup)) writeFileSync(join(this.directory, name), text.replaceAll('{directory}', this.directory));
    context.after(() => {
      for (const lock of this.locks.values()) lock.close();
    });
  }

  override transport(): LightRequest {
    return this.route;
  }

  /** Devices.request: each device answers only at its own configured address, the Panels also at their new one. */
  readonly route: LightRequest = (address, method, endpoint = '', payload) => {
    this.addresses.push([address.ip, method, endpoint]);
    const target = address.ip === LINES_IP ? this.lines : address.ip === PANELS_IP || address.ip === MOVED_IP ? this.panels : undefined;
    if (target === undefined) throw new Error(`No device at ${address.ip}.`);
    return target.request(address, method, endpoint, payload);
  };

  config(): Record<string, unknown> {
    return JSON.parse(readFileSync(join(this.directory, 'config.json'), 'utf8')) as Record<string, unknown>;
  }

  writeConfig(config: Record<string, unknown>): void {
    writeFileSync(join(this.directory, 'config.json'), JSON.stringify(config));
  }

  unregister(device: string): void {
    const config = this.config();
    const registry = {...config.devices as Record<string, unknown>};
    delete registry[device];
    this.writeConfig({...config, devices: registry});
    const db = this.database();
    transaction(db, () => markDirty(db));
  }

  override hookStep(step: Step): Outcome {
    if (step[0] !== 'unregister') return super.hookStep(step);
    this.unregister(textOf(step[1]));
    return {result: null};
  }

  override async apply(step: Step): Promise<unknown> {
    const [first_, ...args] = step;
    const op = typeof first_ === 'string' ? first_ : '';
    const db = this.database();
    switch (op) {
      case 'on': {
        const previous = this.device;
        this.device = args[0] === 'panels' ? this.panels : this.lines;
        try {
          return await this.apply(args[1] as Step);
        } finally {
          this.device = previous;
        }
      }
      case 'devices':
        this.writeConfig({...this.config(), devices: args[0]});
        return null;
      case 'readdress': {
        const config = this.config();
        const registry = config.devices as Record<string, Record<string, unknown>>;
        registry[textOf(args[0])] = {...registry[textOf(args[0])], ip: textOf(args[1])};
        this.writeConfig(config);
        this.addresses.push('moved');
        return null;
      }
      case 'unregister':
        this.unregister(textOf(args[0]));
        return null;
      case 'configText':
        writeFileSync(join(this.directory, 'config.json'), textOf(args[0]));
        return null;
      case 'registered': return registeredDevices(this.directory);
      case 'lock': {
        const lock = new DatabaseSync(join(this.directory, lockFile(textOf(args[0]))), {timeout: 0});
        lock.exec('BEGIN EXCLUSIVE');
        this.locks.set(textOf(args[0]), lock);
        return null;
      }
      case 'unlock':
        this.locks.get(textOf(args[0]))?.close();
        this.locks.delete(textOf(args[0]));
        return null;
      case 'locks': return readdirSync(this.directory).filter(name => name.startsWith('notification-lock')).sort();
      case 'recordFailure': return recordFailure(db, textOf(args[0]));
      case 'dirty':
        transaction(db, () => markDirty(db));
        return null;
      case 'patch': {
        const config = await loadConfig(this.directory, textOf(args[0]), this.transport());
        return transaction(db, () => requestPatch(db, args[1] as unknown as Patch, config));
      }
      case 'assignAll': {
        const config = await loadConfig(this.directory, textOf(args[0]), this.transport());
        const lines = Object.fromEntries(config.elements.map(element => [element.id, {project: args[1]}]));
        return transaction(db, () => requestPatch(db, {settings: args[2], lines} as unknown as Patch, config));
      }
      case 'locate': {
        const target = await loadConfig(this.directory, textOf(args[0]), this.transport());
        const source = await loadConfig(this.directory, textOf(args[1]), this.transport());
        const element = source.elements[Number(args[2])]?.id;
        return transaction(db, () => edits.locate(db, target, element));
      }
      case 'matchRevision': {
        // Give a device the Lines' held revision, so a hold that ignored the device would match it.
        const device = textOf(args[0]);
        const held = Number(first(db, "SELECT value FROM meta WHERE key='controller_hold_revision'")?.[0]);
        const revision = (): number => Number(first(db, 'SELECT value FROM meta WHERE key=?', metaKey('mode_revision', device))?.[0] ?? 0);
        while (revision() < held) {
          const mode = modeStatus(db, device).mode === 'work' ? 'quiet' : 'work';
          transaction(db, () => commandMode(db, mode, this.clock.seconds(), this.report, device));
        }
        return revision();
      }
      case 'animationsPending': return journal(db, DEFAULT, 'AND kind=?', ANIMATION).map(row => row.phase);
      default: return super.apply(step);
    }
  }

  /** Each device's scene file, or null without one. */
  scenes(): Record<'wall' | 'panels', unknown> {
    const read = (device: string): unknown => {
      try {
        return JSON.parse(readFileSync(join(this.directory, sceneFile(device)), 'utf8')) as unknown;
      } catch {
        return null;
      }
    };
    return {wall: read(DEFAULT), panels: read('panels')};
  }
}

export interface DeviceReplay {
  run: DeviceCase;
  outcomes: Outcome[];
  recorded: RecordedCase;
}

/**
 * Replay a recorded device case in the port and check it against Python: every step's and hook's outcome, both fakes'
 * requests and every address, the rows, both scene files and devices, the clock, and each command's last outcome
 * through MAPPING.md's controller receipt rule.
 */
export async function replayDevices(context: TestContext, name: string): Promise<DeviceReplay> {
  const recorded = RECORDED.cases.find(item => item.name === name);
  assert.ok(recorded !== undefined, `No recorded device case ${name}.`);
  const run = new DeviceCase(context, recorded.panels);
  const outcomes: Outcome[] = [];
  for (const step of recorded.steps) outcomes.push(await outcomeOf(() => run.apply(step)));
  const admissions = compareSteps(name, run, recorded, outcomes);
  assert.deepEqual(run.lines.calls, recorded.calls, `${name}: Lines requests`);
  assert.deepEqual(run.panels.calls, recorded.panelsCalls, `${name}: Panels requests`);
  assert.deepEqual(run.addresses, recorded.addresses, `${name}: addresses`);
  assert.deepEqual(run.rows(), recorded.rows, `${name}: rows`);
  assert.deepEqual(run.scenes(), recorded.scenes, `${name}: scene files`);
  const state = (fake: SceneDevice): DeviceState => ({selected: fake.selected, brightness: fake.brightness, on: fake.on});
  assert.deepEqual({wall: state(run.lines), panels: state(run.panels)}, recorded.devices, `${name}: devices`);
  assert.equal(run.clock.seconds(), recorded.clock, `${name}: clock`);
  compareOutcomes(name, run, recorded.receipts, admissions);
  return {run, outcomes, recorded};
}
