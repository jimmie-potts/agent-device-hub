import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeStorageExec, storageSnapshot } from '../storage-measurement.mjs';
const output = '8192\t/data\n4096\t/data\nFilesystem 1B-blocks Used Available Use% Mounted on\n/dev/example 1000000 100000 900000 10% /data\noverlay 2000000 500000 1500000 25% /\n';
function frame(text, stream = 1) {
  const body = Buffer.from(text), header = Buffer.alloc(8);
  header[0] = stream; header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

test('storage accounts for larger volume measure, writable layer and host run files without retaining device names', () => {
  const result = storageSnapshot({ stdout: output, writableLayerBytes: 1024, hostRunBytes: 512 });
  assert.equal(result.volumeAllocatedBytes, 8192);
  assert.equal(result.volumeApparentBytes, 4096);
  assert.equal(result.runDataBytes, 9728);
  assert.equal(result.minimumAvailableBytes, 900000);
  assert.equal(JSON.stringify(result).includes('/dev/example'), false);
});

test('missing fields, unexpected mounts, arithmetic overflow and malformed probe output fail closed', () => {
  for (const stdout of [output.replace('/data\n', '/private\n'), output.replace('8192', '-1'),
    output.replace('900000', '9000000'), output + 'SYNTHETIC_SECRET', '', output.replace('8192', '9007199254740991')]) {
    assert.throws(() => storageSnapshot({ stdout, writableLayerBytes: 1024, hostRunBytes: 512 }));
  }
  assert.throws(() => storageSnapshot({ stdout: output, writableLayerBytes: 1024 }));
});

test('Docker exec decoding accepts bounded complete stdout frames and never exposes stderr content', () => {
  assert.equal(decodeStorageExec(Buffer.concat([frame(output.slice(0, 20)), frame(output.slice(20))])), output);
  for (const bytes of [frame('SYNTHETIC_SECRET', 2), frame(output).subarray(0, 10),
    frame(output, 0), frame('x'.repeat(16385))]) {
    assert.throws(() => decodeStorageExec(bytes), error => !error.message.includes('SYNTHETIC_SECRET'));
  }
});

test('POSIX df -P uses 1-blocks and Capacity headings with the same byte units', () => {
  const stdout = output.replace('Filesystem 1B-blocks Used Available Use% Mounted on',
    'Filesystem 1-blocks Used Available Capacity Mounted on');
  assert.equal(storageSnapshot({ stdout, writableLayerBytes: 1024, hostRunBytes: 512 }).runDataBytes, 9728);
});
