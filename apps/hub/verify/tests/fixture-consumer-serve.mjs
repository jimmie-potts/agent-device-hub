// The stand-in consumer's process (see fixture-consumer.mjs). Standalone it
// serves a page, health and its verification state. Paired, it also serves a
// controller v1 endpoint the Hub calls with the paired controller token, and
// polls the Hub's shared session feed with the paired feed token.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {validate} from '@jimmie-potts/device-contracts';

const argument = name => process.argv[process.argv.indexOf(name) + 1];
const data = argument('--data'), port = Number(argument('--port')), controllerPort = Number(argument('--controller-port'));
const scenario = JSON.parse(await readFile(join(data, 'scenario.json'), 'utf8'));
if (scenario.fault === 'start-fails') {
  process.stderr.write('stand-in-start-failed: requested\n');
  process.exit(1);
}
const paired = scenario.name === 'hub-paired';
const identity = scenario.kind === 'nanoleaf' ? {controllerId: 'wall-controller', deviceId: 'wall', sourceId: 'wall'} : {controllerId: 'pixoo-controller', deviceId: 'pixoo-local', sourceId: 'pixoo'};
const corpus = JSON.parse(await readFile('packages/contracts/fixtures/controller-v1.json', 'utf8'));
const snapshot = structuredClone(corpus.schemaCases.find(c => c.definition === 'snapshot' && c.valid).value);
Object.assign(snapshot, {identity: {...identity, controllerEpoch: 'stand-in'}});
Object.assign(snapshot.state, {pending: [], desired: {power: {status: 'known', value: true}, brightness: {status: 'known', value: 60}, mode: {status: 'unknown'}}, externalControl: {status: 'unknown'}, observation: {status: 'unknown'}, lastSuccessfulSend: {status: 'unknown'}, lastOutcome: {status: 'unknown'}});
snapshot.capabilities = {power: {supported: true}, brightness: {supported: true, minimum: 0, maximum: 100}, media: {supported: false}, zones: {supported: false}, scenes: {supported: false}, preview: {supported: false}, modes: {supported: false}};
const pixooIntegration = JSON.parse(await readFile('apps/hub/fixtures/pixoo-integration.json', 'utf8')).snapshot;
pixooIntegration.identity = identity;
const writer = {};
const feed = {connection: 'unavailable', revision: null, ownerId: null, error: null, receivedAt: 0};

const send = (res, status, value) => {
  res.writeHead(status, {'content-type': 'application/json'});
  res.end(JSON.stringify(value));
};
const state = () => {
  const connection = !paired ? 'unavailable' : feed.receivedAt && Date.now() - feed.receivedAt <= 4000 ? 'current' : feed.receivedAt ? 'stale' : 'unavailable';
  const view = {connection, revision: feed.revision, ownerId: feed.ownerId, error: feed.error, receivedAt: feed.receivedAt ? Math.floor(feed.receivedAt / 1000) : null};
  return scenario.kind === 'nanoleaf'
    ? {apiVersion: 'wall-verify/1', scenario: scenario.name, feed: {source: 'shared', ...view}, integration: {applied: writer['integration.applied'] ?? 0, queued: 0, failed: 0}}
    : {apiVersion: 'pixoo-verify/1', scenario: scenario.name, feed: view, writer};
};

const main = createServer((req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  if (path === '/health') return send(res, 200, {ok: true});
  if (path === (scenario.kind === 'nanoleaf' ? '/verify/state' : '/api/verify/state')) return send(res, 200, state());
  if (path === '/') {
    res.writeHead(200, {'content-type': 'text/html'});
    return res.end(`<!doctype html><title>Stand-in</title><h1>Stand-in ${scenario.kind} consumer</h1>`);
  }
  send(res, 404, {error: 'not-found'});
});

const controller = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${scenario.controllerToken}`) return send(res, 401, {failure: {code: 'unauthenticated'}});
  let body = '';
  for await (const chunk of req) body += chunk;
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  if (req.method === 'GET' && path === '/controller/v1/snapshot') return send(res, 200, snapshot);
  if (req.method === 'GET' && path === '/controller/pixoo-integration/v1/snapshot' && scenario.kind === 'pixoo') return send(res, 200, pixooIntegration);
  if (req.method === 'POST' && path === '/controller/v1/commands') {
    const command = JSON.parse(body);
    if (!validate('request', command)) return send(res, 400, {failure: {code: 'invalid-request'}});
    const receipt = {apiVersion: '1.0', controllerId: identity.controllerId, deviceId: identity.deviceId, requestId: command.requestId, configurationRevision: snapshot.configurationRevision, generation: snapshot.generation, outcome: 'queued', priorEffects: 'none', completedOperations: [], uncertainOperations: []};
    if (command.expectedConfigurationRevision !== snapshot.configurationRevision || JSON.stringify(command.expectedGeneration) !== JSON.stringify(snapshot.generation)) return send(res, 409, {...receipt, outcome: 'failed', failure: {code: 'revision-conflict'}});
    writer[command.command.kind] = (writer[command.command.kind] ?? 0) + 1;
    snapshot.configurationRevision++;
    snapshot.nextRequestId = {...snapshot.nextRequestId, sequence: snapshot.nextRequestId.sequence + 1};
    if (command.command.kind === 'brightness.set') snapshot.state.desired.brightness = {status: 'known', value: command.command.percent};
    return send(res, 200, {...receipt, configurationRevision: snapshot.configurationRevision});
  }
  send(res, 404, {failure: {code: 'invalid-request'}});
});

async function poll() {
  if (!paired || scenario.fault === 'no-feed') return;
  try {
    const response = await fetch(new URL('api/monitor/v1/sessions?snapshotVersion=1.2', scenario.hubFeed), {headers: {authorization: `Bearer ${scenario.feedToken}`, 'x-pixoo-request': '1'}, signal: AbortSignal.timeout(2000)});
    if (!response.ok) {
      feed.error = response.status === 401 ? 'unauthenticated' : 'unavailable';
      return;
    }
    const value = await response.json();
    if (value.ownerId !== 'verify-owner') {
      feed.error = 'owner-mismatch';
      return;
    }
    Object.assign(feed, {revision: value.snapshot.revision, ownerId: value.ownerId, error: null, receivedAt: Date.now()});
  } catch {
    feed.error = 'unreachable';
  }
}

await new Promise(resolve => main.listen(port, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${main.address().port}/`;
let endpoints;
if (paired && scenario.fault !== 'no-controller') {
  await new Promise(resolve => controller.listen(controllerPort, '127.0.0.1', resolve));
  endpoints = {controller: scenario.fault === 'installed-endpoint' ? 'http://127.0.0.1:8765/' : `http://127.0.0.1:${controller.address().port}/`};
}
const timer = setInterval(() => void poll(), 1000);
void poll();
const stop = () => {
  clearInterval(timer);
  main.close();
  main.closeAllConnections();
  controller.close();
  controller.closeAllConnections();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.stdout.write(JSON.stringify({url, ...(endpoints ? {endpoints} : {})}) + '\n');
