import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import * as core from '@jimmie-potts/app-verify';
import {fixture} from '../../../dashboard/tests/fixture.mjs';
import {png, proofFixture} from '../../../../packages/app-verify/tests/proof-fixture.mjs';
import plugin from '../plugin.mjs';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
async function launched(spec) {
  const child = spawn(spec.argv[0], spec.argv.slice(1), {cwd: root, stdio: ['ignore', 'pipe', 'pipe']});
  const closed = new Promise(resolve => child.once('close', resolve));
  let text = '', stderr = '';
  child.stderr.on('data', chunk => {stderr += chunk;});
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ready timeout: ' + stderr)), 8000);
      child.on('error', error => {clearTimeout(timer); reject(error);});
      child.on('exit', code => {clearTimeout(timer); reject(new Error(`launch exited ${code}: ${stderr}`));});
      child.stdout.on('data', chunk => {
        text += chunk;
        for (const line of text.split('\n').slice(0, -1)) {
          try {const ready = JSON.parse(line); if (ready.ready) {clearTimeout(timer); resolve(ready.url);}} catch { /* wait for the ready line */ }
        }
      });
    });
    return {url, stop: async () => {child.kill('SIGTERM'); assert.equal(await closed, 0, stderr);}};
  } catch (error) {child.kill('SIGTERM'); await closed; throw error;}
}

test('the preview serves committed frozen proof on its own listener and closes it with the Hub', async () => {
  const proof = await proofFixture();
  let f;
  try {
    f = await fixture({previewProof: core.createProofHandler?.(proof)});
    const url = `${f.hub.url}/__app-verify/proof/${proof.runId}/capture-1/after.png`;
    const before = await fetch(url);
    assert.notEqual(before.status, 200);
    await before.arrayBuffer();
    const manifest = await proof.freeze();
    const response = await fetch(url);
    assert.equal(response.status, 200, 'a committed screenshot has a usable HTTP proof URL');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    assert.equal(await proof.read('verified/SHA256SUMS').then(x => x.toString()), manifest);
    await f.close(); f = undefined;
    await assert.rejects(fetch(url));
    assert.deepEqual(await proof.read('verified/capture-1/after.png'), png, 'stop retains local proof');
  } finally {await f?.close(); await proof.close();}
});

test('both verification launch paths mount proof, reuse the port, and the installed CLI has no proof route', {timeout: 30000}, async () => {
  const proof = await proofFixture();
  const dataDir = join(proof.proofDir, 'data');
  await mkdir(dataDir);
  const context = {root, dataDir, runtimeDir: proof.proofDir, runId: proof.runId, proofDir: proof.proofDir, inputs: {}, endpointPorts: {}, node: process.execPath, port: 0};
  let child;
  try {
    await proof.freeze();
    await plugin.scenarios['lifecycle-basic'].seed({...context, scenario: 'lifecycle-basic'});
    child = await launched(await plugin.launch({...context, scenario: 'lifecycle-basic'}));
    const path = `/__app-verify/proof/${proof.runId}/capture-1/after.png`;
    const url = new URL(path, child.url).href;
    assert.equal((await fetch(url)).status, 200);
    context.port = Number(new URL(child.url).port);
    await child.stop(); child = undefined;
    const config = {directory: join(dataDir, 'integrated'), ownerId: 'verify-owner', consumers: [{id: 'dashboard', clearOnNewTurn: false}], credentials: [{id: 'test', digest: createHash('sha256').update('d'.repeat(43)).digest('hex'), scopes: ['read'], devices: []}], controllers: [], port: context.port};
    await writeFile(join(dataDir, 'integrated.json'), JSON.stringify(config), {mode: 0o600});
    const spec = await plugin.launch({...context, scenario: 'integrated'});
    child = await launched(spec);
    assert.equal(Number(new URL(child.url).port), context.port);
    assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), png);
    assert.equal((await fetch(new URL('/dashboard.js', child.url))).status, 200);
    await child.stop(); child = undefined;
    child = await launched({argv: [process.execPath, join(root, 'apps/hub/dist/cli.js'), 'serve', join(dataDir, 'host.json')]});
    assert.equal((await fetch(url)).status, 401, 'installed CLI retains its authenticated route handling');
  } finally {await child?.stop(); await proof.close();}
});

test('a browser displays the frozen screenshot and recorded WebM through proof links', {timeout: 30000}, async () => {
  const proof = await proofFixture();
  const browser = await chromium.launch();
  let f;
  try {
    const recording = await browser.newContext({recordVideo: {dir: proof.proofDir}});
    const source = await recording.newPage();
    await source.setContent('<p>Frozen proof browser check</p>');
    await source.waitForTimeout(350);
    const video = source.video();
    await recording.close();
    proof.files.set('capture-1/interaction.webm', await readFile(await video.path()));
    await proof.freeze();
    f = await fixture({previewProof: core.createProofHandler(proof)});
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    const base = `${f.hub.url}/__app-verify/proof/${proof.runId}/capture-1/`;
    const image = await page.goto(base + 'after.png');
    assert.equal(image.status(), 200);
    await page.waitForFunction(() => document.querySelector('img')?.naturalWidth === 1);
    const media = await page.goto(base + 'interaction.webm');
    assert.ok([200, 206].includes(media.status()));
    await page.waitForFunction(() => {const video = document.querySelector('video'); return video?.readyState >= 2 && video.videoWidth > 0;});
    assert.ok(await page.locator('video').evaluate(video => video.duration > 0));
  } finally {await browser.close(); await f?.close(); await proof.close();}
});
