import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {run} from '../src/cli.js';

void test('import does nothing and invalid CLI input reveals no argument or exception content', async () => {
  await assert.rejects(run([]));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/cli.js', import.meta.url)), '--secret-private-marker'],
    {stdio: ['ignore', 'pipe', 'pipe']});
  const output: Buffer[] = [], errors: Buffer[] = [];
  child.stdout.on('data', (bytes: Buffer) => output.push(bytes));
  child.stderr.on('data', (bytes: Buffer) => errors.push(bytes));
  const code = await new Promise<number | null>((resolve, reject) => {child.once('close', resolve); child.once('error', reject);});
  assert.equal(code, 1); assert.equal(Buffer.concat(output).length, 0);
  assert.equal(Buffer.concat(errors).toString(), 'Music producer could not start or continue. Use --config with a private configuration file.\n');
});
