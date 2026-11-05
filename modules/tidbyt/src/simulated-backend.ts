import {API, type CloudFetch} from './cloud.js';
import {SIMULATED_DEVICE, SimulatedCloud, type CloudState} from './simulated.js';
import {SimulatedTronbyt, TRONBYT_ORIGIN, type TronbytState} from './simulated-tronbyt.js';

/** The existing backend selection with synthetic endpoints; the harness supplies its synthetic token file. */
export const TRONBYT_SIMULATED_SECTION = Object.freeze({
  id: 'tidbyt', backend: 'tronbyt', tronbyt: Object.freeze({url: TRONBYT_ORIGIN, deviceId: SIMULATED_DEVICE}),
  statusInstallation: 'agentdevicehub', nowPlaying: Object.freeze({playback: 'living-room', installation: 'nowplaying'}),
});

const CLOUD_ORIGIN = new URL(API).origin;
const refused = (): TypeError => new TypeError('fetch failed', {cause: Object.assign(new Error('synthetic endpoint refused'), {code: 'ECONNREFUSED'})});

/** Both registered backends stay in process. An unknown destination never falls through to fetch or another backend. */
export class SimulatedTidbyt {
  readonly #cloud: SimulatedCloud;
  readonly #tronbyt: SimulatedTronbyt;
  #selected: 'cloud' | 'tronbyt' = 'cloud';

  constructor({now = Date.now}: {now?: () => number} = {}) {
    this.#cloud = new SimulatedCloud({now});
    this.#tronbyt = new SimulatedTronbyt({now});
  }

  readonly fetch: CloudFetch = async (value, init) => {
    let url: URL;
    try {url = new URL(value);} catch {throw refused();}
    if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || !url.pathname.startsWith('/v0/devices/') || value !== `${url.origin}${url.pathname}`) throw refused();
    if (url.origin === CLOUD_ORIGIN) {
      this.#selected = 'cloud';
      return await this.#cloud.fetch(value, init);
    }
    if (url.origin === TRONBYT_ORIGIN) {
      this.#selected = 'tronbyt';
      return await this.#tronbyt.fetch(value, init);
    }
    throw refused();
  };

  offline(): void {this.#cloud.offline(); this.#tronbyt.offline();}
  online(): void {this.#cloud.online(); this.#tronbyt.online();}
  state(): CloudState | TronbytState {return this.#selected === 'cloud' ? this.#cloud.state() : this.#tronbyt.state();}
}
