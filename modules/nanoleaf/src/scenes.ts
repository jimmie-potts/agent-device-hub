// Remembering the device's saved scene before the indicators take over, and restoring it after the last one
// (bridge.py SceneRestorer). The scene state is a private JSON file per device in the state directory.
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {isObject, sameValue} from './compat.js';
import {deviceOf, sceneFile} from './devices.js';
import type {Rgb} from './effects.js';
import {ValueError} from './errors.js';
import {readJson, writeJson} from './jsonfile.js';
import type {Indication} from './line-projection.js';
import {PALETTE, render, type RenderConfig} from './renderer.js';
import {lightRequest, type LightRequest} from './transport.js';

/** The blue the fallback shows while no saved scene is known, distinct from the indicators' base. */
export const FALLBACK: Rgb = [25, 60, 255];

export interface Scene {
  name: string;
  brightness: number;
}

export interface SceneState {
  version: 1;
  scene: Scene | null;
  /** Whether the indicators hold the lights, so an idle pass restores the scene. */
  owned: boolean;
  /** The playing scene whose brightness the port changed while idle (Quiet's 10% or a native override). */
  quiet_scene: string | null;
  /** The level it wrote there. */
  quiet_brightness: number | null;
}

/** Sends one rendered state to the device; the worker's sender, or a test's. */
export type Sender = (config: RenderConfig, snapshot: readonly Indication[], instant: number, loop: boolean) => unknown;

const isScene = (value: unknown): value is Scene => isObject(value) && typeof value.name === 'string' && value.name !== ''
  && typeof value.brightness === 'number' && Number.isInteger(value.brightness) && value.brightness >= 0 && value.brightness <= 100;

const address = (config: RenderConfig): {ip: string; token: string} => ({ip: config.ip ?? '', token: config.token ?? ''});

export class SceneRestorer {
  readonly path: string;
  state: SceneState = {version: 1, scene: null, owned: false, quiet_scene: null, quiet_brightness: null};
  /** The device's playing selection at the last observation, or what this restorer last chose. */
  selected: string | null = null;
  available = new Set<string>();
  names: string[] = [];
  request: LightRequest;
  readonly draw: Sender;

  /** Reads the saved state; a damaged file is a ValueError. */
  constructor(directory: string, readonly config: RenderConfig, request: LightRequest = lightRequest, draw?: Sender) {
    this.path = join(directory, sceneFile(deviceOf(config)));
    this.request = request;
    this.draw = draw ?? ((value, snapshot, instant, loop) => this.render(value, snapshot, instant, loop));
    if (!existsSync(this.path)) return;
    const saved = readJson(this.path, true);
    if (!isObject(saved)) throw new ValueError('Invalid saved scene state.');
    const level = saved.quiet_brightness;
    if (saved.version !== 1 || typeof saved.owned !== 'boolean' || (saved.scene !== undefined && saved.scene !== null && !isScene(saved.scene))
        || (level !== undefined && level !== null && (typeof level !== 'number' || !Number.isInteger(level) || level < 0 || level > 100))) {
      throw new ValueError('Invalid saved scene state.');
    }
    // The only level earlier versions wrote.
    if (!Object.hasOwn(saved, 'quiet_brightness') && saved.quiet_scene !== undefined && saved.quiet_scene !== null) saved.quiet_brightness = 10;
    const state: Record<string, unknown> = {...this.state};
    for (const key of Object.keys(this.state)) if (Object.hasOwn(saved, key)) state[key] = saved[key];
    this.state = state as unknown as SceneState;
  }

  /** Draw through this restorer's transport unless the worker pass supplies its own. */
  render(config: RenderConfig, snapshot: readonly Indication[], instant: number, loop: boolean): Promise<unknown> {
    return render(config._controller_request === undefined ? {...config, _controller_request: this.request} : config, snapshot, instant, loop);
  }

  save(changes: Partial<SceneState>): void {
    const updated = {...this.state, ...changes};
    if (!sameValue(updated, this.state)) {
      writeJson(this.path, updated);
      this.state = updated;
    }
  }

  /**
   * Read the device's scene list and selection. A saved scene playing now becomes the restore target, unless it is
   * playing at the level the port itself wrote onto it. True when a saved scene is playing.
   */
  async observe(): Promise<boolean> {
    const listing = await this.request(address(this.config), 'GET', '/effects');
    const names = isObject(listing) ? listing.effectsList : undefined;
    const selected = isObject(listing) ? listing.select : undefined;
    if (!Array.isArray(names) || names.some(name => typeof name !== 'string') || typeof selected !== 'string') {
      throw new ValueError('Invalid scene list from controller.');
    }
    this.names = names as string[];
    this.available = new Set(this.names);
    this.selected = selected;
    if (!this.available.has(selected)) return false;
    const state = await this.request(address(this.config), 'GET', '/state');
    const brightness = isObject(state) && isObject(state.brightness) ? state.brightness.value : undefined;
    const scene = {name: selected, brightness};
    if (!isScene(scene)) throw new ValueError('Invalid scene brightness from controller.');
    // Save before taking over. Temporary *Dynamic* task effects are absent from the saved scene list and can never
    // replace this target. A level the port itself wrote onto this scene is not a new preference.
    if (!(selected === this.state.quiet_scene && scene.brightness === this.state.quiet_brightness)) {
      this.save({scene, quiet_scene: null, quiet_brightness: null});
    }
    return true;
  }

  /** Record a one-shot native brightness written onto the playing saved scene. */
  wrote(name: string | null, level: number): void {
    if (name !== null && this.available.has(name)) this.save({quiet_scene: name, quiet_brightness: level});
  }

  /** Show the indicators, or with none, leave or restore the scene as the mode asks. */
  async send(config: RenderConfig, snapshot: readonly Indication[], instant: number, loop: boolean): Promise<unknown> {
    if (snapshot.some(item => item !== null) || (config._comet ?? null) !== null || (config._locate ?? null) !== null) {
      this.save({owned: true});
      const output = await this.draw(config, snapshot, instant, loop);
      this.save({quiet_scene: null, quiet_brightness: null});
      this.selected = '*Dynamic*';
      return output;
    }
    const quiet = config._mode === 'quiet';
    const override = config._brightness ?? null;
    if (this.selected === '*ExtControl*' && config._mode === 'free') {
      this.save({owned: false, quiet_scene: null, quiet_brightness: null});
      return undefined;
    }
    if (this.selected !== null && this.available.has(this.selected)) {
      // A manually chosen scene is already playing. Leave its animation running instead of restarting it on every pass.
      if (quiet) {
        const level = override ?? 10;
        if (this.state.quiet_scene !== this.selected || this.state.quiet_brightness !== level) {
          this.save({quiet_scene: this.selected, quiet_brightness: level, owned: true});
          await this.request(address(config), 'PUT', '/state', {brightness: {value: level, duration: 0}});
        }
      } else if (this.state.quiet_scene === this.selected) {
        if (override === null) {
          // The mode policy applies again: the remembered brightness returns.
          await this.request(address(config), 'PUT', '/state', {brightness: {value: this.state.scene?.brightness ?? null, duration: 0}});
          this.save({quiet_scene: null, quiet_brightness: null});
        } else if (this.state.quiet_brightness !== override) {
          await this.request(address(config), 'PUT', '/state', {brightness: {value: override, duration: 0}});
          this.save({quiet_brightness: override});
        }
      }
      this.save({owned: quiet});
      return undefined;
    }
    if (!this.state.owned && !quiet) return undefined;
    const scene = this.state.scene;
    if (scene !== null && this.available.has(scene.name)) {
      // Restore brightness first. If selection succeeds but its response is lost, the next observation still sees the
      // correct saved values.
      const level = override ?? (quiet ? 10 : scene.brightness);
      const changed = quiet || override !== null;
      this.save({quiet_scene: changed ? scene.name : null, quiet_brightness: changed ? level : null});
      await this.request(address(config), 'PUT', '/state', {on: {value: true}, brightness: {value: level, duration: 0}});
      await this.request(address(config), 'PUT', '/effects', {select: scene.name});
      this.selected = scene.name;
    } else {
      // The first scene has not been chosen yet, or it was deleted. This fallback keeps its own blue.
      const output = await this.draw({...config, _palette: {...(config._palette ?? PALETTE), base: FALLBACK}}, snapshot, instant, loop);
      this.selected = '*Static*';
      this.save({owned: quiet});
      return output;
    }
    this.save({owned: quiet});
    return undefined;
  }
}
