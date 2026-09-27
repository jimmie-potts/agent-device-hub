// The Hub verification run's application process (Hub #494). It starts the real
// hub and B.U.N.N.Y. dashboard with the fake loopback controllers from
// apps/dashboard/tests/fixture.mjs, using the scenario and run-generated tokens
// the plug-in seeded into --data, binds 127.0.0.1:--port and prints the hub's
// own `{"ready":true,"url":…}` line. A small control listener, also on
// 127.0.0.1 and guarded by the run's API token, lets capture steps observe what
// reached the fakes and toggle their availability; it never reaches a device.
import {createServer} from 'node:http';
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

// The hub's private directory sits at <data>/h, so its launch socket path stays under the 108-byte
// Unix limit with the default state root; a longer root fails here with a stable cause.
const directory = join(data, 'h');
if (Buffer.byteLength(join(directory, 'bunny-launch.sock')) > 107) {
  process.stderr.write('hub-start-failed: socket-path-too-long\n');
  process.exit(1);
}
await mkdir(directory, {mode: 0o700});
let f;
try {
  // No editor links: a preview must never send the owner to an installed service's port.
  f = await fixture({empty: scenario.empty === true, browserAccess: scenario.browserAccess ?? 'trusted-loopback', token, reader, port, directory, editorLinks: scenario.editorLinks ?? {}});
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
  if (request.headers.authorization !== `Bearer ${token}`) return send(401, {error: 'unauthenticated'});
  let body = '';
  for await (const chunk of request) body += chunk;
  const input = body ? JSON.parse(body) : {};
  if (request.method === 'GET' && request.url === '/writes') return send(200, f.writes);
  if (request.method === 'GET' && request.url === '/ports') return send(200, {hub: Number(new URL(f.hub.url).port), control: control.address().port, controllers: f.endpoints});
  if (request.method === 'POST' && request.url === '/offline') {
    f.setOffline(input.on === true, input.device ?? 'pixel');
    return send(200, {offline: input.on === true ? input.device ?? 'pixel' : null});
  }
  if (request.method === 'POST' && request.url === '/uncertain') {
    f.setUncertain(input.on === true);
    return send(200, {uncertain: input.on === true});
  }
  if (request.method === 'POST' && request.url === '/event' && EVENTS.has(input.kind)) {
    const extra = input.kind === 'question.continuing' ? {event: {kind: input.kind, attention: {status: 'known', id: 'question'}}}
      : input.kind === 'attention.approval' ? {event: {kind: input.kind, attention: {status: 'known', id: 'approval'}}} : {};
    return send(200, await f.event(input.kind, extra));
  }
  send(404, {error: 'not-found'});
});
await new Promise(resolve => control.listen(0, '127.0.0.1', resolve));
await writeFile(join(data, 'control.json'), JSON.stringify({port: control.address().port}), {mode: 0o600});

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  control.close();
  control.closeAllConnections();
  await f.close().catch(() => undefined);
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.stdout.write(JSON.stringify({ready: true, url: f.hub.url}) + '\n');
