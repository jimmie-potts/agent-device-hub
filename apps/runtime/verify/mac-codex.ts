// Synthetic shared-Mac source only. Never consult an installed client or personal configuration.
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {createServer, request} from 'node:http';
import {once} from 'node:events';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {CaptureContext} from '@jimmie-potts/app-verify';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {Page} from 'playwright';
import {SdkError, connectRemote} from '@jimmie-potts/sdk';
import {producerCredentialId, producerSource} from '../src/hook/index.js';
import {tokenDigest, REQUEST_HEADER, type EdgeCredential} from '../src/index.js';
import {configDirOf, credentialsOf, partTokensOf} from './paths.js';
import {HARNESS_PATH} from './protocol.js';

const SOURCE = {provider: 'codex', client: 'local', hostId: 'mac-mini', sourceId: 'codex-local-hooks'} as const;
const hook = fileURLToPath(new URL('../../bin/mac-codex-hook.mjs', import.meta.url));
const tokenFile = (data: string) => join(configDirOf(data), 'mac-producer-token');
export async function prepareMacCodex(data: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const file = credentialsOf(data);
  const grants = JSON.parse(await readFile(file, 'utf8')) as {credentials: EdgeCredential[]};
  grants.credentials.push({id: producerCredentialId(SOURCE), source: producerSource(SOURCE), digest: tokenDigest(token), scopes: ['ingest']});
  await writeFile(file, JSON.stringify(grants), {mode: 0o600});
  await writeFile(tokenFile(data), token, {mode: 0o600});
}
async function invoke(file: string, payload: object): Promise<{quiet: boolean; elapsed: number}> {
  const started = performance.now();
  const child = spawn(process.execPath, [hook, file], {stdio: ['pipe', 'pipe', 'pipe']});
  const finished = new Promise<{quiet: boolean; elapsed: number}>(resolve => {
    let output = false;
    child.stdout.on('data', () => {output = true;}); child.stderr.on('data', () => {output = true;});
    const timer = setTimeout(() => child.kill('SIGKILL'), 4500);
    child.once('error', () => {clearTimeout(timer); resolve({quiet: false, elapsed: performance.now() - started});});
    child.once('exit', (code, signal) => {clearTimeout(timer); resolve({quiet: !output && code === 0 && signal === null, elapsed: performance.now() - started});});
  });
  child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(payload));
  return finished;
}
async function status(url: string, path: string, headers: Record<string, string> = {}, method = 'GET'): Promise<number> {
  return new Promise((resolve, reject) => {
    const call = request(new URL(path, url), {method, headers, timeout: 2000}, answer => {answer.resume(); answer.once('end', () => resolve(answer.statusCode ?? 0));});
    call.once('timeout', () => call.destroy(new Error('deadline'))); call.once('error', reject); call.end();
  });
}
async function until(test: () => Promise<boolean>, ms = 5000): Promise<boolean> {
  const end = performance.now() + ms;
  while (performance.now() < end) {if (await test()) return true; await new Promise(r => setTimeout(r, 25));}
  return false;
}
export async function captureMacCodex(t: CaptureContext): Promise<void> {
  const page = t.page as Page;
  const origin = new URL(t.url).origin, token = await readFile(tokenFile(t.dataDir), 'utf8');
  const tokens = JSON.parse(await readFile(partTokensOf(t.dataDir), 'utf8')) as Record<string, string>;
  const producer = join(configDirOf(t.dataDir), 'mac-producer.json');
  const write = (port?: number) => writeFile(producer, JSON.stringify({enabled: true, qualified: true, source: SOURCE,
    endpoint: `${port === undefined ? origin : `http://127.0.0.1:${port}`}/api/monitor/v1/events`, token}), {mode: 0o600});
  await write();
  const records = async (): Promise<SessionRecord[]> => {
    const answer = await fetch(new URL('/api/v2/families/session', origin), {headers: {authorization: `Bearer ${tokens.reader}`}, signal: AbortSignal.timeout(2000)});
    if (answer.status !== 200) throw new Error('synthetic reader refused');
    return (await answer.json() as {records: SessionRecord[]}).records;
  };
  const raw = {session_id: 'portable-root', turn_id: 'portable-turn', source: 'startup', prompt: 'PRIVATE_CANARY',
    last_assistant_message: 'PRIVATE_CANARY', cwd: '/DO_NOT_OPEN', transcript_path: '/DO_NOT_OPEN/transcript.jsonl'};
  const errors: string[] = []; page.on('pageerror', () => errors.push('page-error'));
  await page.goto(new URL('/', origin).href);
  await page.locator('main#main[data-feed="connected"]').waitFor();
  for (const hook_event_name of ['SessionStart', 'UserPromptSubmit']) {
    const result = await invoke(producer, {...raw, hook_event_name});
    await t.expect(`${hook_event_name} hook exits silently within its budget`, () => result.quiet && result.elapsed < 4000);
  }
  await t.expect('real core records the shared local known active turn', () => until(async () => (await records()).some(r => r.identity.client === 'local' && r.identity.sessionId === raw.session_id && r.activity === 'active' && r.turn.status === 'known' && r.turn.id === raw.turn_id)));
  await page.getByText('Mac Codex', {exact: false}).first().waitFor();
  const ended = await invoke(producer, {...raw, hook_event_name: 'Stop'});
  await t.expect('Stop publishes silently', () => ended.quiet);
  await t.expect('real core retains the completed unread notice', () => until(async () => (await records()).some(r => r.activity === 'idle' && r.notices.some(n => n.kind === 'turn-ended'))));
  await page.getByText('Finished · unread', {exact: true}).first().waitFor();
  for (const payload of [{...raw, hook_event_name: 'Stop', agent_id: 'child'}, {...raw, hook_event_name: 'SessionStart', source: 'compact'}, {...raw, hook_event_name: 'PermissionRequest'}]) {
    const result = await invoke(producer, payload); await t.expect('excluded input is silent', () => result.quiet);
  }
  await t.expect('excluded events and private content do not enter retained core records', async () => {
    const found = await records(), text = JSON.stringify(found);
    return found.length === 1 && !/PRIVATE_CANARY|DO_NOT_OPEN/.test(text) && !text.includes(token);
  });
  for (const scope of ['read', 'control', 'admin']) await t.expect(`ingest credential cannot acquire ${scope}`, async () =>
    await status(origin, `/api/v2/authority?scope=${scope}`, {authorization: `Bearer ${token}`}) === 403);
  await t.expect('bad bearer is unauthenticated', async () => await status(origin, '/api/v2/authority?scope=read', {authorization: 'Bearer invalid-synthetic'}) === 401);
  await t.expect('credential cannot connect as another SDK source', async () => {
    try {const remote = await connectRemote({url: origin, source: 'bunny/parts/foreign-source', token}); await remote.close(); return false;}
    catch (error) {return error instanceof SdkError && error.body.error.code === 'forbidden';}
  });
  await t.expect('raw unwanted Host is refused', async () => await status(origin, '/', {host: 'invalid.example'}) === 403);
  await t.expect('unwanted browser Origin is refused', async () => await status(origin, '/api/v2/browser/session',
    {origin: 'http://invalid.example', [REQUEST_HEADER]: '1', 'sec-fetch-site': 'same-origin'}, 'POST') === 403);
  let attempts = 0;
  const stalled = createServer(req => {attempts += 1; req.resume();});
  stalled.listen(0, '127.0.0.1'); await once(stalled, 'listening');
  try {
    await write((stalled.address() as {port: number}).port);
    const result = await invoke(producer, {...raw, hook_event_name: 'Stop'});
    await t.expect('stalled receiver sees one attempt and hook fails open within its budget', () => result.quiet && result.elapsed < 4000 && attempts === 1);
  } finally {stalled.closeAllConnections(); await new Promise<void>(resolve => stalled.close(() => resolve())); await write();}
  const harness = t.endpoints.harness;
  if (harness === undefined) throw new Error('synthetic harness unavailable');
  const restarting = fetch(new URL(`${HARNESS_PATH}/restart`, harness), {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({holdMs: 4000})});
  await t.expect('selected synthetic receiver is actually unavailable', () => until(async () => {
    try {await fetch(new URL('/api/v2/health', origin), {signal: AbortSignal.timeout(200)}); return false;} catch {return true;}
  }));
  const offline = await invoke(producer, {...raw, session_id: 'offline-root', hook_event_name: 'UserPromptSubmit'});
  await t.expect('unavailable receiver leaves hook silent and bounded', () => offline.quiet && offline.elapsed < 4000);
  await t.expect('same synthetic core restarts', async () => (await restarting).ok);
  await page.getByRole('button', {name: 'Sign in again', exact: true}).waitFor();
  await page.getByRole('button', {name: 'Sign in again', exact: true}).click();
  await page.locator('main#main[data-feed="connected"]').waitFor();
  await page.getByText('Mac Codex', {exact: false}).first().waitFor();
  await t.expect('retained record survives and lost observation is not invented', async () => {
    const found = await records(); return found.length === 1 && found[0]?.identity.sessionId === raw.session_id && found[0].notices.some(n => n.kind === 'turn-ended');
  });
  await t.expect('rendered page has no private input, token or JavaScript failure', async () => {
    const text = await page.locator('body').innerText(); return !/PRIVATE_CANARY|DO_NOT_OPEN/.test(text) && !text.includes(token) && errors.length === 0;
  });
  await t.attach('checks.json', JSON.stringify({synthetic: true, physical: false, metadataOnly: true, scopesRefused: ['read', 'control', 'admin'],
    excludedInputs: ['child', 'compact', 'permission'], sourceBinding: true, rawHostRefused: true, originRefused: true,
    stalledAttempts: attempts, offlineFailOpen: true, browserRecovery: true, retainedNotice: true}));
}
