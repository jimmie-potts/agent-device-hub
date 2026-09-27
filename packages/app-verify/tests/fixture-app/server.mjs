// A tiny stateful application for the core's lifecycle tests: a counter page with
// one command route. It reads its scenario from `<data>/scenario.json`, binds
// 127.0.0.1:<port> and prints `{"ready":true,"url":…}` like the hub.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync, appendFileSync} from 'node:fs';
import {join} from 'node:path';

const argument = name => process.argv[process.argv.indexOf(name) + 1];
const data = argument('--data'), port = Number(argument('--port'));
const scenario = JSON.parse(readFileSync(join(data, 'scenario.json'), 'utf8'));

if (scenario.behavior === 'crash') {
  // Leave a detached grandchild behind and fail, like the E4 partial-start probe.
  const helper = spawn('/usr/bin/setsid', ['/usr/bin/sleep', '300'], {detached: true, stdio: 'ignore'});
  if (scenario.pidFile) writeFileSync(scenario.pidFile, String(helper.pid));
  helper.unref();
  setTimeout(() => process.exit(3), 200);
} else {
  let count = scenario.start ?? 0;
  const commands = [];
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Counter</title></head>
<body><main><h1>Counter</h1><p id="count" role="status">Count: ${count}</p>
<button type="button" id="add">Add one</button></main><script src="/app.js"></script></body></html>`;
  const script = `document.getElementById('add').addEventListener('click',async()=>{const r=await fetch('/api/add',{method:'POST'});const v=await r.json();document.getElementById('count').textContent='Count: '+v.count;});`;
  const server = createServer((request, response) => {
    const send = (status, type, body) => {
      response.writeHead(status, {'content-type': type});
      response.end(body);
    };
    if (request.method === 'GET' && request.url === '/') return send(200, 'text/html; charset=utf-8', page.replace(/Count: \d+/, `Count: ${count}`));
    if (request.method === 'GET' && request.url === '/app.js') return send(200, 'text/javascript', script);
    if (request.method === 'GET' && request.url === '/health') return send(200, 'application/json', JSON.stringify({ok: true, scenario: scenario.name}));
    if (request.method === 'GET' && request.url === '/api/commands') return send(200, 'application/json', JSON.stringify(commands));
    if (request.method === 'POST' && request.url === '/api/add') {
      // The broken variant is the known-incorrect result the negative controls must catch.
      count += scenario.behavior === 'broken' ? 2 : 1;
      commands.push({kind: 'add', at: Date.now()});
      if (scenario.commandLog) appendFileSync(scenario.commandLog, 'add\n');
      return send(200, 'application/json', JSON.stringify({count}));
    }
    send(404, 'application/json', '{"error":"not-found"}');
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    process.stderr.write(`fixture listening ${url}\n`);
    // `never-ready` listens but never announces readiness, like a broken build.
    if (scenario.behavior !== 'never-ready') process.stdout.write(JSON.stringify({ready: true, url}) + '\n');
  });
  const stop = () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
