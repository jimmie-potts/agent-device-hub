// The Tidbyt module's registration (Hub #999): its factory, its place in the shipped list, after the playback module
// whose record its now-playing tile follows (Hub #930), and how the scenario harnesses simulate its cloud. A disposable
// run's supervisor holds the simulated cloud, and the runtime's module reaches it one request at a time over its link.
import type {DeviceSimulation, ModuleRegistration} from '@jimmie-potts/sdk';
import {createTidbytModule, tidbytFactory} from './module.js';
import {SimulatedCloud} from './simulated.js';

/** One request to the cloud as it crosses the link: its method, URL, bearer header with the synthetic token, and JSON body. */
type CloudCall = {method: 'GET' | 'POST' | 'DELETE'; url: string; authorization: string; body?: string};
/** The cloud's answer, or how it failed: a refused connection, before anything was sent, or no answer. */
type CloudAnswer = {status: number; headers: Record<string, string>; body: string} | {failed: 'refused' | 'lost'};

/** The cloud stops answering, or answers again. */
const act = (cloud: SimulatedCloud, action: string): void => {
  if (action === 'online') cloud.online();
  else cloud.offline();
};

export const tidbytSimulation: DeviceSimulation<SimulatedCloud, SimulatedCloud> = {
  actions: ['online', 'offline'],
  memory: {
    // It stamps each push with the harness's virtual time.
    create: ({now}) => new SimulatedCloud({now}),
    state: cloud => cloud.state(),
    act: (cloud, {action}) => { act(cloud, action); },
    // A render's worker answers in real time while virtual time runs ahead, so renders get a deadline no step reaches.
    build: cloud => createTidbytModule({transport: cloud.fetch, renderTimeoutMs: 3_600_000}),
  },
  run: {
    create: () => new SimulatedCloud(),
    state: cloud => cloud.state(),
    act: (cloud, {action}) => { act(cloud, action); },
    async serve(cloud, {args, signal}): Promise<CloudAnswer> {
      const {method, url, authorization, body} = args as CloudCall;
      const headers: Record<string, string> = {authorization, ...(body === undefined ? {} : {'content-type': 'application/json'})};
      try {
        const answer = await cloud.fetch(url, {method, redirect: 'error', signal, headers, ...(body === undefined ? {} : {body})});
        return {status: answer.status, headers: Object.fromEntries(answer.headers), body: await answer.text()};
      } catch (error) {
        return {failed: error instanceof TypeError ? 'refused' : 'lost'};
      }
    },
    // A cloud that does not answer never replies, so the module's own deadline aborts the call, which tells the supervisor too.
    remote: link => createTidbytModule({transport: async (url, init) => {
      const call: CloudCall = {method: init.method, url, authorization: init.headers.authorization ?? '', ...(init.body === undefined ? {} : {body: init.body})};
      const answer = await link.call('fetch', call, init.signal);
      const value = answer.status === 'answered' ? answer.value as CloudAnswer : {failed: 'lost' as const};
      if ('status' in value) return new Response(value.body, {status: value.status, headers: value.headers});
      // A refused connection fails as undici reports one, so the module knows nothing was sent.
      throw value.failed === 'refused' ? new TypeError('fetch failed', {cause: Object.assign(new Error('connect ECONNREFUSED'), {code: 'ECONNREFUSED'})}) :
        new DOMException('the cloud did not answer', 'AbortError');
    }}),
  },
};

export const registration: ModuleRegistration = {...tidbytFactory, shipped: true, order: 300, after: ['playback'], simulation: tidbytSimulation};
