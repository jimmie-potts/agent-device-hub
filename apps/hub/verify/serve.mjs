// The Hub verification run's application process (Hub #494). It starts the real
// hub and B.U.N.N.Y. dashboard with the fake loopback controllers from
// apps/dashboard/tests/fixture.mjs, using the scenario and run-generated tokens
// the plug-in seeded into --data, binds 127.0.0.1:--port and prints the hub's
// own `{"ready":true,"url":…}` line. A small control listener, also on
// 127.0.0.1 and guarded by the run's API token, lets capture steps observe what
// reached the fakes and toggle their availability; it never reaches a device.
//
// A scenario seed may name a `fault`, a known-broken behavior the tests use to
// prove that the reference steps fail on it (apps/hub/verify/tests/steps.test.mjs).
// Only a seed file selects one, never the environment:
// - `write-on-read`: an unsolicited brightness command goes through the hub
//   shortly after the Pixoo fake is first read.
// - `duplicate-forward`: a loopback relay in front of the Pixoo fake forwards
//   every command twice.
// - `replay-on-recovery`: clearing an offline or uncertain Pixoo re-sends a
//   brightness command through the hub. After an uncertain result it re-sends
//   the value the controller already holds (60), so the reloaded value is
//   unchanged and only the command count can catch the replay.
import {createServer, request as httpRequest} from 'node:http';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture} from '../../dashboard/tests/fixture.mjs';
import {startupFailureCode} from '../dist/startup-failure.js';

const argument = name => {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
};
const data = argument('--data'), port = Number(argument('--port'));
const scenario = JSON.parse(await readFile(join(data, 'scenario.json'), 'utf8'));
const token = (await readFile(join(data, 'api-token'), 'utf8')).trim();
const reader = (await readFile(join(data, 'reader-token'), 'utf8')).trim();
const FAULTS = new Set(['write-on-read', 'duplicate-forward', 'replay-on-recovery']);
if (scenario.fault !== undefined && !FAULTS.has(scenario.fault)) {
  process.stderr.write('hub-start-failed: unknown-fault\n');
  process.exit(1);
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// The hub's private directory sits at <data>/h, so its launch socket path stays under the 108-byte
// Unix limit with the default state root; a longer root fails here with a stable cause.
const directory = join(data, 'h');
if (Buffer.byteLength(join(directory, 'bunny-launch.sock')) > 107) {
  process.stderr.write('hub-start-failed: socket-path-too-long\n');
  process.exit(1);
}
await mkdir(directory, {mode: 0o700});

/** A command through the hub, as a buggy client or component would send it: current guards, a new request id. */
async function sendThroughHub(percent) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (!f) {
      await pause(200);
      continue;
    }
    const pixel = f.states.pixel;
    const body = {apiVersion: '1.0', controllerId: 'pixel-controller', deviceId: 'pixel', requestId: structuredClone(pixel.nextRequestId), expectedConfigurationRevision: pixel.configurationRevision, expectedGeneration: structuredClone(pixel.generation), command: {kind: 'brightness.set', percent}};
    const response = await fetch(`${f.hub.url}/api/controllers/v1/pixel/commands`, {method: 'POST', headers: f.headers, body: JSON.stringify(body)}).catch(() => undefined);
    // The hub runs one request per device at a time; a capacity answer while it polls is retried.
    if (response && response.status !== 429 && response.status !== 503) return;
    await pause(200);
  }
}

/** A relay that forwards reads once and every command twice to the fake behind it. */
async function duplicatingRelay(target) {
  const upstream = new URL(target);
  const forward = (request, body) => new Promise(resolve => {
    const outgoing = httpRequest({host: '127.0.0.1', port: upstream.port, method: request.method, path: request.url, headers: {...request.headers, host: `127.0.0.1:${upstream.port}`}}, reply => {
      let text = '';
      reply.on('data', chunk => (text += chunk));
      reply.on('end', () => resolve({status: reply.statusCode, type: reply.headers['content-type'], text}));
    });
    outgoing.on('error', () => resolve(undefined));
    outgoing.end(body);
  });
  const relay = createServer(async (request, response) => {
    try {
      let body = '';
      for await (const chunk of request) body += chunk;
      const first = await forward(request, body);
      if (request.method !== 'GET') await forward(request, body);
      if (!first) return request.socket.destroy();
      response.writeHead(first.status, {'content-type': first.type ?? 'application/json'});
      response.end(first.text);
    } catch {
      // A broken exchange looks like a lost response to the hub; it never ends the run.
      request.socket.destroy();
    }
  });
  await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
  relays.push(relay);
  return `http://127.0.0.1:${relay.address().port}${upstream.pathname}`;
}

const relays = [];
let f, unsolicited = false;
try {
  f = await fixture({
    empty: scenario.empty === true,
    browserAccess: scenario.browserAccess ?? 'trusted-loopback',
    token, reader, port, directory,
    // No editor links, and no Local Places destination but B.U.N.N.Y. itself: a preview must never send the owner to an installed service's port.
    editorLinks: scenario.editorLinks ?? {},
    placeLinks: scenario.placeLinks ?? {},
    ...(scenario.fault === 'write-on-read' ? {beforeRead: request => {
      if (request.id !== 'pixel' || unsolicited) return;
      unsolicited = true;
      setTimeout(() => void sendThroughHub(45), 1000);
    }} : {}),
    ...(scenario.fault === 'duplicate-forward' ? {endpointFor: (id, url) => (id === 'pixel' ? duplicatingRelay(url) : url)} : {}),
  });
} catch (error) {
  // Like the hub CLI: a stable, path-free cause from the hub's own helper, never a path or value.
  const code = startupFailureCode(error) ?? (typeof error?.code === 'string' && /^E[A-Z]+$/.test(error.code) ? error.code : undefined);
  process.stderr.write(`hub-start-failed${code ? `: ${code}` : ''}\n`);
  process.exit(1);
}
if (scenario.offline) f.setOffline(true, scenario.offline);

const EVENTS = new Set(['question.continuing', 'attention.approval', 'turn.ended', 'session.started']);
const control = createServer(async (request, response) => {
  const send = (status, value) => {
    response.writeHead(status, {'content-type': 'application/json'});
    response.end(JSON.stringify(value));
  };
  // A bad request answers an error; it never ends the run.
  try {
    if (request.headers.authorization !== `Bearer ${token}`) return send(401, {error: 'unauthenticated'});
    let body = '';
    for await (const chunk of request) body += chunk;
    let input;
    try {
      input = body ? JSON.parse(body) : {};
    } catch {
      return send(400, {error: 'invalid-json'});
    }
    if (request.method === 'GET' && request.url === '/writes') return send(200, f.writes);
    // Every command-shaped request a fake received, recorded before any offline or uncertain answer.
    if (request.method === 'GET' && request.url === '/commands') return send(200, f.requests.filter(r => r.method !== 'GET').map(({id, method, url}) => ({id, method, url})));
    if (request.method === 'GET' && request.url === '/ports') return send(200, {hub: Number(new URL(f.hub.url).port), control: control.address().port, controllers: f.endpoints, relays: relays.map(relay => relay.address().port)});
    if (request.method === 'POST' && request.url === '/offline') {
      f.setOffline(input.on === true, input.device ?? 'pixel');
      if (input.on !== true && scenario.fault === 'replay-on-recovery') await sendThroughHub(45);
      return send(200, {offline: input.on === true ? input.device ?? 'pixel' : null});
    }
    if (request.method === 'POST' && request.url === '/uncertain') {
      f.setUncertain(input.on === true);
      if (input.on !== true && scenario.fault === 'replay-on-recovery') await sendThroughHub(60);
      return send(200, {uncertain: input.on === true});
    }
    if (request.method === 'POST' && request.url === '/event' && EVENTS.has(input.kind)) {
      const extra = input.kind === 'question.continuing' ? {event: {kind: input.kind, attention: {status: 'known', id: 'question'}}}
        : input.kind === 'attention.approval' ? {event: {kind: input.kind, attention: {status: 'known', id: 'approval'}}} : {};
      return send(200, await f.event(input.kind, extra));
    }
    send(404, {error: 'not-found'});
  } catch {
    if (!response.headersSent) send(502, {error: 'control-failed'});
  }
});
await new Promise(resolve => control.listen(0, '127.0.0.1', resolve));
await writeFile(join(data, 'control.json'), JSON.stringify({port: control.address().port}), {mode: 0o600});

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  control.close();
  control.closeAllConnections();
  for (const relay of relays) {
    relay.close();
    relay.closeAllConnections();
  }
  await f.close().catch(() => undefined);
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.stdout.write(JSON.stringify({ready: true, url: f.hub.url}) + '\n');
