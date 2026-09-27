// A tiny stateful application for the core's lifecycle tests: a counter page with
// one command route. It reads its scenario from `<data>/scenario.json`, binds
// 127.0.0.1:<port> and prints `{"ready":true,"url":…}` like the hub.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync, appendFileSync} from 'node:fs';
import {join} from 'node:path';

const argument = name => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const data = argument('--data'), port = Number(argument('--port'));
const scenario = JSON.parse(readFileSync(join(data, 'scenario.json'), 'utf8'));
// Run inputs as the plug-in passed them at launch (`--inputs`) and at seed (`scenario.json`).
const launchedInputs = argument('--inputs') === undefined ? null : JSON.parse(argument('--inputs'));

if (scenario.behavior === 'noisy-crash') {
  // A failed start whose stderr holds a stable cause line and a secret-looking line.
  process.stderr.write('fixture-start-failed: port-in-use\n');
  process.stderr.write(`fixture token=${scenario.secret}\n`);
  setTimeout(() => process.exit(2), 100);
} else if (scenario.behavior === 'crash') {
  // Leave a detached grandchild behind and fail, like the E4 partial-start probe.
  const helper = spawn('/usr/bin/setsid', ['/usr/bin/sleep', '300'], {detached: true, stdio: 'ignore'});
  if (scenario.pidFile) writeFileSync(scenario.pidFile, String(helper.pid));
  helper.unref();
  setTimeout(() => process.exit(3), 200);
} else {
  let count = scenario.start ?? 0;
  const commands = [];
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Counter</title></head>
<body><main><h1>Counter</h1><p id="count" role="status" data-applied="0">Count: ${count}</p>
<button type="button" id="add">Add one</button></main><script src="/app.js"></script></body></html>`;
  // `data-applied` counts applied responses, so a step can assert the settled count rather than a transient one.
  const script = `document.getElementById('add').addEventListener('click',async()=>{const r=await fetch('/api/add',{method:'POST'});const v=await r.json();const e=document.getElementById('count');e.textContent='Count: '+v.count;e.dataset.applied=String(Number(e.dataset.applied)+1);});`;
  const server = createServer((request, response) => {
    const send = (status, type, body) => {
      response.writeHead(status, {'content-type': type});
      response.end(body);
    };
    if (request.method === 'GET' && request.url === '/') return send(200, 'text/html; charset=utf-8', page.replace(/>Count: \d+</, `>Count: ${count}<`));
    if (request.method === 'GET' && request.url === '/app.js') return send(200, 'text/javascript', script);
    if (request.method === 'GET' && request.url === '/health') return send(200, 'application/json', JSON.stringify({ok: true, scenario: scenario.name}));
    if (request.method === 'GET' && request.url === '/api/commands') return send(200, 'application/json', JSON.stringify(commands));
    if (request.method === 'GET' && request.url === '/env') return send(200, 'application/json', JSON.stringify({home: process.env.HOME, tmpdir: process.env.TMPDIR}));
    if (request.method === 'GET' && request.url === '/inputs') return send(200, 'application/json', JSON.stringify({seeded: scenario.inputs ?? null, launched: launchedInputs}));
    if (request.method === 'POST' && request.url === '/api/add') {
      // The broken variant is the known-incorrect result the negative controls must catch.
      count += scenario.behavior === 'broken' ? 2 : 1;
      commands.push({kind: 'add', at: Date.now()});
      if (scenario.commandLog) appendFileSync(scenario.commandLog, 'add\n');
      return send(200, 'application/json', JSON.stringify({count}));
    }
    send(404, 'application/json', '{"error":"not-found"}');
  });
  // An extra listener, like a fake device controller, announced as the `controller` endpoint. `bind` keeps the
  // port the core recorded when it relaunches the app; `moves` ignores it; `announce` names a port it never binds.
  const controller = scenario.endpoint === 'bind' || scenario.endpoint === 'moves'
    ? createServer((request, response) => {
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(JSON.stringify({controller: true, scenario: scenario.name}));
    })
    : undefined;
  const listen = (target, bind) => new Promise(resolve => target.listen(bind, '127.0.0.1', () => resolve(`http://127.0.0.1:${target.address().port}/`)));
  const announce = async () => {
    const url = await listen(server, scenario.bindPort ?? port);
    process.stderr.write(`fixture listening ${url}\n`);
    let endpoints;
    if (controller) endpoints = {controller: await listen(controller, scenario.endpoint === 'bind' ? Number(argument('--endpoint-port') ?? 0) : 0)};
    else if (scenario.endpoint === 'announce') endpoints = {controller: `http://127.0.0.1:${scenario.announcePort}/`};
    // `raw` announces what the test chose, so the core's refusals of a malformed ready line can be exercised.
    const announced = scenario.endpoint === 'raw'
      ? {ready: true, url: (scenario.announce?.url ?? url).replace('{port}', String(server.address().port)), ...('endpoints' in (scenario.announce ?? {}) ? {endpoints: scenario.announce.endpoints} : {})}
      : {ready: true, url, ...(endpoints ? {endpoints} : {})};
    // `never-ready` listens but never announces readiness, like a broken build.
    if (scenario.behavior !== 'never-ready') process.stdout.write(JSON.stringify(announced) + '\n');
  };
  announce();
  const stop = () => {
    controller?.close();
    controller?.closeAllConnections();
    server.close(() => process.exit(0));
    server.closeAllConnections();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
