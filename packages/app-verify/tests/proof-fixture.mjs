import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateReceipt} from '@jimmie-potts/app-verify';
import assert from 'node:assert/strict';

export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64');
export async function proofFixture() {
  const proofDir = await mkdtemp(join(tmpdir(), 'av-proof-'));
  const runId = 'hub-20260929T060000Z-aabbcc', at = '2026-09-29T06:00:00Z';
  const receipt = {
    receiptVersion: 'app-verification/1', runId, app: 'hub', repository: 'jimmie-potts/agent-device-hub',
    roots: {proof: tmpdir(), runtime: tmpdir()}, state: 'running', startedAt: at,
    build: {sourceRevision: 'a'.repeat(40), dirty: false, artifactDigest: null, version: 'test'},
    scenario: {name: 'test', version: 'a'.repeat(40), seededAt: at}, components: [{id: 'hub', kind: 'actual'}], checks: [],
    captures: [{n: 1, step: 'proof', scenario: 'test', set: 'verified', outcome: 'passed', screenshot: 'verified/capture-1/after.png', video: 'verified/capture-1/interaction.webm', log: 'verified/capture-1/assertions.json', attachments: ['verified/capture-1/note.html'], startedAt: at, finishedAt: at}],
    preview: {url: 'http://127.0.0.1:41705/', expiresAt: '2099-01-01T00:00:00Z', leaseMinutes: 120},
    owned: {unit: `app-verify-${runId}.service`, leaseTimer: `app-verify-${runId}-lease.timer`, port: 41705, runtimeDir: runId, proofDir: runId, mainPid: process.pid, mainStartMonotonic: 1},
    proof: {frozenAt: at}, failure: null, cleanup: {result: null}, secrets: 'none recorded',
  };
  const files = new Map([['capture-1/after.png', png], ['capture-1/interaction.webm', Buffer.from('fixture-video')], ['capture-1/assertions.json', Buffer.from('{}\n')], ['capture-1/note.html', Buffer.from('<script>throw new Error("must not execute")</script>')]]);
  const live = () => writeFile(join(proofDir, 'receipt.json'), JSON.stringify(receipt));
  async function freeze() {
    assert.deepEqual(validateReceipt(receipt), {ok: true});
    files.set('receipt.json', Buffer.from(JSON.stringify(receipt)));
    for (const [path, bytes] of files) {
      await mkdir(join(proofDir, 'verified', path, '..'), {recursive: true});
      await writeFile(join(proofDir, 'verified', path), bytes);
    }
    const manifest = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => `${sha(bytes)}  ${path}\n`).join('');
    await writeFile(join(proofDir, 'verified/SHA256SUMS'), manifest);
    await writeFile(join(proofDir, 'events.jsonl'), JSON.stringify({event: 'frozen', frozenAt: receipt.proof.frozenAt, manifest: `sha256:${sha(manifest)}`}) + '\n');
    await live();
    return manifest;
  }
  return {proofDir, runId, receipt, files, live, freeze, read: path => readFile(join(proofDir, path)), close: () => rm(proofDir, {recursive: true, force: true})};
}
