import assert from 'node:assert/strict';
import {createServer, request} from 'node:http';
import {mkdir, rename, symlink, unlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {createProofHandler, proofLinks} from '@jimmie-potts/app-verify';
import {png, proofFixture} from './proof-fixture.mjs';

async function serving(t) {
  const proof = await proofFixture();
  const handler = createProofHandler(proof);
  const server = createServer((req, res) => void handler.handle(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const path = `/__app-verify/proof/${proof.runId}/capture-1/after.png`;
  const get = (target = path, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const req = request({hostname: '127.0.0.1', port, path: target, headers, method}, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks)}));
    }); req.on('error', reject); req.end();
  });
  t.after(async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await proof.close();});
  return {...proof, path, get, port};
}

test('proof reads require a committed frozen set, preserve bytes, support media ranges and never expose later captures', async t => {
  const p = await serving(t);
  assert.equal((await p.get()).status, 404);
  await p.freeze();
  assert.deepEqual((await p.get()).bytes, png);
  const head = await p.get(p.path, {}, 'HEAD');
  assert.equal(head.status, 200); assert.equal(head.bytes.length, 0); assert.equal(Number(head.headers['content-length']), png.length);
  const range = await p.get(p.path, {range: 'bytes=0-7'});
  assert.equal(range.status, 206); assert.deepEqual(range.bytes, png.subarray(0, 8));
  assert.equal((await p.get(p.path, {range: 'bytes=99999-'})).status, 416);
  assert.equal((await p.get(p.path, {range: 'bytes=0-1,3-4'})).status, 416);
  const links = proofLinks(p.receipt);
  assert.equal(links.length, 4);
  p.receipt.captures.push({...p.receipt.captures[0], n: 2, set: 'after-handoff', screenshot: 'after-handoff/capture-2/after.png', video: 'after-handoff/capture-2/interaction.webm', log: 'after-handoff/capture-2/assertions.json', attachments: []});
  await p.live();
  assert.deepEqual(proofLinks(p.receipt), links);
  await mkdir(join(p.proofDir, 'verified/capture-2'));
  await writeFile(join(p.proofDir, 'verified/capture-2/after.png'), png);
  assert.equal((await p.get(p.path.replace('capture-1', 'capture-2'))).status, 404);
  p.receipt.preview.expiresAt = '2020-01-01T00:00:00Z'; await p.live();
  assert.equal((await p.get()).status, 404, 'an expired receipt cannot serve proof even before shutdown finishes');
});

test('proof transport rejects path, method and origin attacks, while permitting owner link navigation', async t => {
  const p = await serving(t); await p.freeze();
  for (const path of [p.path + '?x=1', p.path.replace('after.png', '../receipt.json'), p.path.replace('after.png', '%2e%2e%2freceipt.json'), p.path.replace('capture-1/', 'capture-1%2f'), p.path.replace(p.runId, 'another-run'), '/receipt.json', '/__app-verify/proof/' + p.runId + '/verified/receipt.json']) {
    assert.equal((await p.get(path)).status, 404, path);
  }
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) assert.equal((await p.get(p.path, {}, method)).status, 405, method);
  for (const headers of [{host: 'evil.test'}, {origin: 'https://evil.test'}, {'sec-fetch-site': 'cross-site'}, {'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image'}]) assert.equal((await p.get(p.path, headers)).status, 403);
  assert.equal((await p.get(p.path, {'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document'})).status, 200);
  assert.equal((await p.get(p.path, {origin: `http://127.0.0.1:${p.port}`})).status, 200);
  const html = await p.get(p.path.replace('after.png', 'note.html'));
  assert.equal(html.status, 200); assert.equal(html.headers['content-type'], 'application/octet-stream');
  assert.match(html.headers['content-disposition'], /^attachment;/); assert.equal(html.headers['x-content-type-options'], 'nosniff');
  assert.match(html.headers['content-security-policy'], /sandbox/);
});

test('proof transport refuses symlinks at every level and tampered commitments or files', async t => {
  const p = await serving(t); await p.freeze();
  const file = join(p.proofDir, 'verified/capture-1/after.png');
  for (const relative of ['receipt.json', 'events.jsonl', 'verified/SHA256SUMS', 'verified/receipt.json', 'verified/capture-1/after.png', 'verified/capture-1', 'verified']) {
    const target = join(p.proofDir, relative), saved = target + '.saved';
    await rename(target, saved); await symlink(saved, target);
    assert.equal((await p.get()).status, 404, relative);
    await unlink(target); await rename(saved, target);
    assert.equal((await p.get()).status, 200, 'restored ' + relative);
  }
  await writeFile(file, 'changed'); assert.equal((await p.get()).status, 404);
  await writeFile(file, png);
  await writeFile(join(p.proofDir, 'verified/SHA256SUMS'), 'changed'); assert.equal((await p.get()).status, 404);
  await p.freeze();
  await writeFile(join(p.proofDir, 'events.jsonl'), JSON.stringify({event: 'frozen', frozenAt: p.receipt.proof.frozenAt, manifest: 'sha256:' + '0'.repeat(64)}));
  assert.equal((await p.get()).status, 404);
  await p.freeze(); p.receipt.proof.frozenAt = null; await p.live(); assert.equal((await p.get()).status, 404);
});

test('failed captures never become served or linked proof', async t => {
  const p = await serving(t); p.receipt.captures[0].outcome = 'failed'; p.receipt.captures[0].reason = 'assertion failed'; await p.freeze();
  assert.equal((await p.get()).status, 404); assert.deepEqual(proofLinks(p.receipt), []);
});
