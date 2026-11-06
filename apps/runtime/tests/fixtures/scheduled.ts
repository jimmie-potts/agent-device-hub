import type {BunnyModule, DeviceLink} from '@jimmie-potts/sdk';
import {createWeatherModule} from '@jimmie-potts/weather';
import {createPixooModule, SimulatedPixoo, frameDigest, type PixooTransport, type SimulatedPixooState} from '@jimmie-potts/pixoo';
import sharp from 'sharp';
import type {FixtureCoreOptions} from './core.js';

/** A two-hour slot excludes 60 s at its start and 32 s at its end; this choice adds 60,001 ms to the lower bound. */
export const artScheduleChoice = (): number => 60_001 / (2 * 60 * 60_000 - 92_000);
export const SCHEDULE_FIXTURE = 'art-schedule-fixture';
export const RAIN_SECTION = {latitude: 12.3456, longitude: -65.4321, contact: 'operator@example.invalid'};

/** Only an explicitly named disposable fixture selects this real owner with invented provider responses. */
export function createScheduleWeather(): BunnyModule {
  return createWeatherModule({fetch: clock => url => {
    const at = clock.now(), hour = 3_600_000, start = Math.floor(at / hour) * hour;
    const iso = (value: number): string => new Date(value).toISOString().replace(/\.\d{3}Z$/, '-00:00');
    let body: object;
    if (url.startsWith('https://api.weather.gov/points/')) body = {properties: {
      forecastHourly: 'https://api.weather.gov/gridpoints/XXX/12,34/forecast/hourly', timeZone: 'Etc/UTC',
    }};
    else if (url.startsWith('https://api.weather.gov/alerts/')) body = {features: []};
    else if (url === 'https://api.weather.gov/gridpoints/XXX/12,34/forecast/hourly?units=us') body = {properties: {
      updateTime: iso(at - hour), periods: Array.from({length: 14}, (_, index) => ({
        startTime: iso(start + index * hour), endTime: iso(start + (index + 1) * hour), temperature: 48,
        temperatureUnit: 'F', isDaytime: true, probabilityOfPrecipitation: {value: 80}, shortForecast: 'Rain',
      })),
    }};
    else throw new Error('unexpected synthetic weather route');
    return Promise.resolve(new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}}));
  }});
}

export type SubmittedPixooFrames = {frames: {digest: string; delayMs: number; png: string}[]};

/** Observes successful synthetic uploads; the underlying adapter remains responsible for every guard and effect. */
export class ScheduledFixture {
  #frames: {rgb: Uint8Array; delayMs: number}[] = [];
  coreOptions(modules: readonly string[]): FixtureCoreOptions {
    return modules.includes(SCHEDULE_FIXTURE) ? {artScheduleChoice} : {};
  }
  local(name: string, modules: readonly string[], device: unknown): BunnyModule | undefined {
    if (!modules.includes(SCHEDULE_FIXTURE)) return undefined;
    if (name === SCHEDULE_FIXTURE) return this.module();
    if (name === 'weather') return createScheduleWeather();
    return name === 'pixoo' && device instanceof SimulatedPixoo ? this.pixoo(device) : undefined;
  }
  remote(name: string, modules: readonly string[], link: () => DeviceLink): BunnyModule | undefined {
    if (!modules.includes(SCHEDULE_FIXTURE)) return undefined;
    if (name === 'weather') return createScheduleWeather();
    return name === 'pixoo' ? this.remotePixoo(link()) : undefined;
  }
  module(): BunnyModule {
    return {manifest: {name: SCHEDULE_FIXTURE, apiVersion: '1.3', content: async ref => {
      if (ref !== 'pixoo') return undefined;
      const frames = await Promise.all(this.#frames.map(async frame => ({digest: frameDigest(frame.rgb), delayMs: frame.delayMs,
        png: (await sharp(frame.rgb, {raw: {width: 64, height: 64, channels: 3}}).png().toBuffer()).toString('base64')})));
      return {type: 'application/json', bytes: Buffer.from(JSON.stringify({frames} satisfies SubmittedPixooFrames))};
    }}, start: () => {}, stop: () => {this.#frames = [];}};
  }
  pixoo(pixoo: SimulatedPixoo): BunnyModule {
    const transport: PixooTransport = {simulated: true, open: async options => {
      const opened = await pixoo.open(options), adapter = opened.adapter;
      return {close: () => opened.close(), adapter: {
        get generation() {return adapter.generation;}, invalidateGeneration: () => adapter.invalidateGeneration(),
        probe: options => adapter.probe(options), setBrightness: (value, options) => adapter.setBrightness(value, options),
        setScreen: (value, options) => adapter.setScreen(value, options),
        uploadAnimation: async (animation, options) => {
          const answer = await adapter.uploadAnimation(animation, options);
          if (answer.ok && animation.frames.length > 1 && animation.frames.length <= 20
              && animation.frames.every(frame => frame.rgb.length === 64 * 64 * 3)) {
            this.#frames = animation.frames.map(frame => ({rgb: frame.rgb.slice(), delayMs: frame.delayMs}));
          }
          return answer;
        },
      }};
    }};
    return createPixooModule({transport});
  }
  remotePixoo(link: DeviceLink): BunnyModule {
    const previous = link.handover as Partial<SimulatedPixooState> | null;
    if (previous === null || typeof previous !== 'object' || !['online', 'offline', 'silent'].includes(String(previous.mode)))
      throw new Error('missing synthetic Pixoo handover');
    const {mode, ...panel} = previous as SimulatedPixooState;
    const pixoo = new SimulatedPixoo({mode, panel});
    pixoo.onChange(state => {void link.call('report', state);});
    link.onPush(({action}) => {if (action === 'online' || action === 'offline' || action === 'silent') pixoo.set(action);});
    return this.pixoo(pixoo);
  }
}
