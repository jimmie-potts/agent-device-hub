// A stand-in consumer adapter for the composition tests (Hub #495). It follows
// the shared pairing convention of the real Nanoleaf and Pixoo `hub-paired`
// scenarios closely enough for the orchestrator to compose it with the real
// Hub: token files read from the runtime directory at seed, a `hub-feed` input,
// a `controller` endpoint serving controller v1 snapshots and commands, a feed
// poller and the consumer's verification state route. It is not either real
// consumer and proves nothing about them.
//
// A test creates a disposable Git checkout whose wrapper calls
// `createPlugin({root, kind, app, fault})`, so the orchestrator starts it
// through a wrapper in its own pinned checkout, exactly as a real consumer.
import {lstat, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {definePlugin} from '@jimmie-potts/app-verify';

const serve = fileURLToPath(new URL('fixture-consumer-serve.mjs', import.meta.url));
/** Stand-in faults a test selects in the wrapper, never through the environment. */
export const FAULTS = ['start-fails', 'no-controller', 'no-feed', 'installed-endpoint'];

async function token(runtimeDir, name) {
  const path = join(runtimeDir, name);
  const info = await lstat(path).catch(() => undefined);
  if (!info?.isFile() || (info.mode & 0o077) !== 0) throw new Error(`pairing file ${name} is missing or not private`);
  const value = (await readFile(path, 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error(`pairing file ${name} is not one token`);
  return value;
}

/** @param {{root: string, kind: 'nanoleaf' | 'pixoo', app: string, fault?: string}} options */
export function createPlugin({root, kind, app, fault}) {
  if (fault !== undefined && !FAULTS.includes(fault)) throw new Error(`unknown stand-in fault ${fault}`);
  const seed = paired => async ({runtimeDir, dataDir, scenario, inputs}) => {
    const control = await readFile(join(runtimeDir, 'fixture-reset.json'), 'utf8').then(JSON.parse, () => ({}));
    const request = await readFile(join(runtimeDir, 'feed-pause.request'), 'utf8').then(JSON.parse, () => null);
    if (request) {
      const release = JSON.parse(await readFile(join(runtimeDir, 'feed-pause.release'), 'utf8'));
      if (JSON.stringify(release) !== JSON.stringify(request)) throw new Error('release does not match pause');
      if (control.mode === 'fail') throw new Error('requested consumer seed failure');
      for (const name of ['request', 'ack', 'release']) await rm(join(runtimeDir, `feed-pause.${name}`));
    }
    const value = {name: scenario, kind, fault: control.mode === 'no-feed' ? 'no-feed' : fault ?? null};
    if (paired) {
      const feed = new URL(inputs['hub-feed']);
      if (feed.protocol !== 'http:' || feed.hostname !== '127.0.0.1' || feed.pathname !== '/') throw new Error('hub-feed must be http://127.0.0.1:<port>/');
      Object.assign(value, {hubFeed: feed.href, feedToken: await token(runtimeDir, 'hub-feed-token'), controllerToken: await token(runtimeDir, 'hub-controller-token')});
    }
    await writeFile(join(dataDir, 'scenario.json'), JSON.stringify(value), {mode: 0o600});
  };
  return definePlugin({
    app,
    repository: `stand-in/${kind}`,
    command: 'node scripts/verify.mjs',
    root,
    defaultScenario: 'standalone',
    inputs: {'hub-feed': {description: 'The paired Hub run origin'}},
    scenarios: {
      standalone: {description: 'A consumer with no Hub', seed: seed(false)},
      'hub-paired': {description: 'A consumer of the paired Hub feed with a controller endpoint', requiredInputs: ['hub-feed'], seed: seed(true)},
    },
    build: {version: '0.0.0', artifact: {file: 'served.txt'}},
    launch: ({node, dataDir, runtimeDir, runId, port, endpointPorts}) => ({argv: [node, serve, '--data', dataDir, '--runtime', runtimeDir, '--run-id', runId, '--port', String(port), '--controller-port', String(endpointPorts.controller ?? 0)], cwd: fileURLToPath(new URL('../../../..', import.meta.url))}),
    readiness: {
      line: line => {
        try {
          const value = JSON.parse(line);
          return typeof value?.url === 'string' ? {url: value.url, ...(value.endpoints ? {endpoints: value.endpoints} : {})} : undefined;
        } catch {
          return undefined;
        }
      },
      probe: async ({url, signal}) => ((await fetch(new URL('health', url), {signal})).ok ? {ok: true} : {ok: false, reason: 'health failed'}),
      timeoutMs: 10000,
    },
    components: [{id: `${kind}-stand-in`, kind: 'simulated', note: 'apps/hub/verify/tests/fixture-consumer.mjs'}],
    captureSteps: {
      shown: {description: 'The stand-in page loads', run: async t => {
        await t.page.goto(t.url);
        await t.expect('the page names the stand-in', () => t.page.getByText(`Stand-in ${kind} consumer`).waitFor());
      }},
    },
  });
}
