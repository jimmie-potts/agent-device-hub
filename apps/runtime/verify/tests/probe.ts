// A probe for the network guard's tests (Hub #920): `node probe.js <tcp port> <udp port>` under the guard tries every way
// a runtime could reach out, from its main thread, a worker thread and a child Node process, and prints one JSON line
// naming what each attempt did. Run without the guard, the same attempts connect.
import {spawn} from 'node:child_process';
import dgram from 'node:dgram';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads';

type Outcome = 'blocked' | 'connected' | 'sent';
const [tcpArg = '0', udpArg = '0'] = isMainThread ? process.argv.slice(2) : workerData as string[];
const tcp = Number(tcpArg), udp = Number(udpArg);
const settle = (start: (done: (outcome: Outcome) => void) => void): Promise<Outcome> => new Promise(resolve => {
  let settled = false;
  const done = (outcome: Outcome): void => { if (!settled) { settled = true; resolve(outcome); } };
  start(done);
  setTimeout(() => { done('blocked'); }, 1500);
});
const viaNet = (): Promise<Outcome> => settle(done => {
  const socket = net.connect(tcp, '127.0.0.1');
  socket.on('connect', () => { socket.destroy(); done('connected'); }).on('error', () => { done('blocked'); });
});
const viaHttp = (call: 'request' | 'get'): Promise<Outcome> => settle(done => {
  const request = http[call](`http://127.0.0.1:${tcp}/`, response => { response.resume(); done('connected'); });
  request.on('socket', socket => { socket.on('connect', () => { done('connected'); }); }).on('error', () => { done('blocked'); });
  if (call === 'request') request.end();
});
const viaHttps = (): Promise<Outcome> => settle(done => {
  const request = https.request({host: '127.0.0.1', port: tcp, rejectUnauthorized: false}, () => { done('connected'); });
  request.on('socket', socket => { socket.on('connect', () => { done('connected'); }); }).on('error', () => { done('blocked'); }).end();
});
const viaFetch = (): Promise<Outcome> => fetch(`http://127.0.0.1:${tcp}/`).then(() => 'connected' as const, () => 'blocked' as const);
const viaUdpSend = (): Promise<Outcome> => settle(done => {
  const socket = dgram.createSocket('udp4');
  socket.on('error', () => { socket.close(); done('blocked'); });
  socket.send('probe', udp, '127.0.0.1', error => { socket.close(); done(error === null ? 'sent' : 'blocked'); });
});
const viaUdpConnect = (): Promise<Outcome> => settle(done => {
  const socket = dgram.createSocket('udp4');
  socket.on('error', () => { socket.close(); done('blocked'); });
  // As in Node's own dgram, a refused connect hands its callback the error.
  socket.connect(udp, '127.0.0.1', (error?: Error) => { socket.close(); done(error === undefined ? 'connected' : 'blocked'); });
});

async function attempts(): Promise<Record<string, Outcome>> {
  return {
    net: await viaNet(), 'http.request': await viaHttp('request'), 'http.get': await viaHttp('get'), 'https.request': await viaHttps(),
    fetch: await viaFetch(), 'dgram.send': await viaUdpSend(), 'dgram.connect': await viaUdpConnect(),
  };
}

if (isMainThread) {
  const main = await attempts();
  const worker = await new Promise<Record<string, Outcome>>((resolve, reject) => {
    const thread = new Worker(new URL(import.meta.url), {workerData: [tcpArg, udpArg]});
    thread.once('message', resolve).once('error', reject);
  });
  const child = await new Promise<string>(resolve => {
    const script = `require('node:http').get('http://127.0.0.1:${tcp}/', r => { r.resume(); console.log('connected'); }).on('error', () => console.log('blocked'))`;
    const spawned = spawn(process.execPath, ['-e', script], {stdio: ['ignore', 'pipe', 'inherit']});
    let text = '';
    spawned.stdout.setEncoding('utf8').on('data', (chunk: string) => { text += chunk; });
    spawned.on('close', () => { resolve(text.trim()); });
  });
  process.stdout.write(`${JSON.stringify({main, worker, child})}\n`);
  process.exit(0);
} else {
  parentPort?.postMessage(await attempts());
}
