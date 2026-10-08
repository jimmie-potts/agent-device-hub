// A browser page as a remote part (Hub #922): the dashboard bundles the remote client from `@jimmie-potts/sdk/remote`
// and acts as its browser session. Its calls carry no token and are marked with `bunny-request: 1`, and the client says
// once that a reconnect is refused, so the page can offer to sign in again.
import assert from 'node:assert/strict';
import type {IncomingHttpHeaders} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {REQUEST_HEADER, SOURCE_HEADER, connectRemote, type Diagnostic, type Participant} from '../src/index.js';
import {SESSION_FAMILY, it, session, setMode, until, type Mode, type Session} from './support.js';
import {startEdge} from './transports.js';

/** Bundles one built entry for a browser, as the dashboard's build does, and lists the modules it took in. */
async function browserBundle(entry: string): Promise<{inputs: string[]; text: string}> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))], bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true,
    logLevel: 'silent',
  });
  return {inputs: Object.keys(result.metafile.inputs), text: result.outputFiles.map(file => file.text).join('')};
}

it('the remote entry bundles for a browser with no Node built-in and no file read, while the main entry cannot', async () => {
  const remote = await browserBundle('../src/remote.js');
  assert.ok(remote.inputs.some(input => input.endsWith('remote-client.js')), 'the client is in the bundle');
  assert.deepEqual(remote.inputs.filter(input => input.startsWith('node:') || input.includes('/v2/index.js') || input.includes('ajv')), [], 'no built-in, validator or file read');
  assert.equal(/\bfrom\s*["']node:|\brequire\(["']node:/.test(remote.text), false, 'no built-in is left for the browser to load');
  // The negative control: the package's main entry holds the bus, the edge and the outbox, which need Node.
  await assert.rejects(browserBundle('../src/index.js'), (error: unknown) => error instanceof Error, 'the main entry is not for a browser');
});

it('a browser session sends no token, marks every call with bunny-request, and syncs and requests as any part', async () => {
  const seen: IncomingHttpHeaders[] = [];
  const edge = await startEdge({
    authenticate: request => {
      seen.push(request.headers);
      // The page's cookie stands for the session; this edge admits a call that carries no token and the page's mark.
      return request.headers.authorization === undefined && request.headers[REQUEST_HEADER] === '1' ? {source: 'bunny/wall', id: 'browser-1'} : undefined;
    },
  });
  let page: Participant | undefined;
  try {
    const core = edge.bus.connect('bunny/core');
    await core.serveSync([SESSION_FAMILY], () => ({revision: 3, states: [{type: 'org.bunny.session.updated', subject: 's1', dataschema: session('s1', 2).dataschema, data: {id: 's1', revision: 2}}]}));
    await core.respond<Mode>('bunny.cmd.mode.*', () => ({status: 'accepted'}));
    page = await connectRemote({url: edge.url, source: 'bunny/wall', browser: true, reconnectDelayMs: 20});
    const synced = await page.sync<Session>([SESSION_FAMILY], () => {}, {timeoutMs: 2000});
    assert.equal(synced.status, 'synced');
    if (synced.status === 'synced') assert.deepEqual(synced.copy.states().map(state => state.data), [{id: 's1', revision: 2}]);
    const result = await page.request('bunny.cmd.mode.wall', setMode('quiet'), {timeoutMs: 2000});
    assert.equal(result.status, 'accepted');
    assert.ok(seen.length >= 4, 'the stream, the subscriptions, the sync and the request');
    for (const headers of seen) {
      assert.equal(headers.authorization, undefined, 'no token');
      assert.equal(headers[REQUEST_HEADER], '1', 'every call is marked as the page\'s own');
      assert.equal(headers[SOURCE_HEADER], 'bunny/wall');
    }
  } finally {
    await page?.close();
    await edge.close();
  }
});

it('a reconnect the edge refuses is reported once as remote.refused, and the part reconnects once it is granted again', async () => {
  let granted = true;
  let refusedAttempts = 0;
  const edge = await startEdge({
    authenticate: () => {
      if (granted) return {source: 'bunny/wall', id: 'browser-1'};
      refusedAttempts += 1;
      return undefined;
    },
  });
  const heard: Diagnostic[] = [];
  let page: Participant | undefined;
  try {
    page = await connectRemote({url: edge.url, source: 'bunny/wall', browser: true, reconnectDelayMs: 10, onDiagnostic: diagnostic => { heard.push(diagnostic); }});
    await page.subscribe(`bunny.state.${SESSION_FAMILY}.*`, () => {});
    // The session ends: the edge refuses it from now on and ends its stream, as the runtime's gateway does.
    granted = false;
    edge.edge.disconnectPrincipal('browser-1');
    await until(() => refusedAttempts >= 3, 'several refused reconnects');
    const refusals = heard.filter(diagnostic => diagnostic.event === 'remote.refused');
    assert.deepEqual(refusals.map(({level, source, code}) => ({level, source, code})), [{level: 'warn', source: 'bunny/wall', code: 'unauthenticated'}], 'said once');
    assert.equal(heard.filter(diagnostic => diagnostic.event === 'remote.disconnected').length, 1);
    granted = true;
    await until(() => heard.some(diagnostic => diagnostic.event === 'remote.reconnected'), 'the reconnect');
    assert.deepEqual(heard.map(diagnostic => diagnostic.event), ['remote.disconnected', 'remote.refused', 'remote.reconnected']);
  } finally {
    await page?.close();
    await edge.close();
  }
});

it('a reconnect refused, then unreachable, then refused again is reported refused once', async () => {
  let attempt = 0;
  // Stream attempts after the first connection: refused, unreachable (the runtime restarting), refused, then admitted.
  const plan = ['refused', 'unreachable', 'refused', 'admitted'];
  const step = (): string => plan[Math.min(attempt, plan.length - 1)] ?? 'admitted';
  let connected = false;
  const edge = await startEdge({
    refuse: route => route === 'stream' && connected && step() === 'unreachable' && (attempt += 1) > 0,
    authenticate: request => {
      if (!connected || request.url?.endsWith('/stream') !== true) return {source: 'bunny/wall', id: 'browser-1'};
      const now = step();
      if (now === 'admitted') return {source: 'bunny/wall', id: 'browser-1'};
      attempt += 1;
      return undefined;
    },
  });
  const heard: Diagnostic[] = [];
  let page: Participant | undefined;
  try {
    page = await connectRemote({url: edge.url, source: 'bunny/wall', browser: true, reconnectDelayMs: 10, onDiagnostic: diagnostic => { heard.push(diagnostic); }});
    await page.subscribe(`bunny.state.${SESSION_FAMILY}.*`, () => {});
    connected = true;
    edge.edge.disconnectPrincipal('browser-1');
    await until(() => heard.some(diagnostic => diagnostic.event === 'remote.reconnected'), 'the reconnect');
    assert.equal(attempt, 3, 'refused, unreachable and refused before it was admitted');
    assert.deepEqual(heard.map(diagnostic => diagnostic.event), ['remote.disconnected', 'remote.refused', 'remote.reconnected'], 'refused once');
  } finally {
    await page?.close();
    await edge.close();
  }
});
