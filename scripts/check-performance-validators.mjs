// Exercise the released validator timing route in a disposable npm consumer.
import assert from 'node:assert/strict';
import {mkdtempSync, copyFileSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'hub-validator-check-'));
const archive = join(root, 'scripts/performance/vendor/jimmie-potts-agent-lifecycle-contracts-1.0.0.tgz');
assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'),
  '669c8e3d8b2bac5255ea613eae96134c324515b4e7a767887e86fa59b87fef85');
function run(command, args) {
  const result = spawnSync(command, args, {cwd: temporary, encoding: 'utf8', timeout: 120_000,
    maxBuffer: 2_000_000, env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}});
  assert.ifError(result.error);
  return result;
}
try {
  copyFileSync(archive, join(temporary, 'jimmie-potts-agent-lifecycle-contracts-1.0.0.tgz'));
  copyFileSync(join(root, 'docs/performance/receipts/validator-consumer-package.json'), join(temporary, 'package.json'));
  copyFileSync(join(root, 'docs/performance/receipts/validator-consumer-package-lock.json'), join(temporary, 'package-lock.json'));
  assert.ok(process.env.npm_execpath, 'Run through npm run test:performance');
  const installed = run(process.execPath, [process.env.npm_execpath, 'ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund']);
  assert.equal(installed.status, 0, installed.stderr);
  const command = [join(root, 'scripts/performance/validators.py'), '--archive', archive,
    '--consumer', temporary, '--node', process.execPath, '--cycles', '1', '--warmups', '0', '--repeats', '1'];
  const measured = run('python', ['-B', ...command, '--output', join(temporary, 'successful')]);
  assert.equal(measured.status, 0, 'Released validator smoke measurement must succeed');
  const receipt = JSON.parse(readFileSync(join(temporary, 'successful/validators.json')));
  assert.equal(receipt.status, 'complete');
  assert.equal(receipt.budgetStatus, 'not-frozen');
  assert.equal(receipt.runs.length, 2);
  for (const {result} of receipt.runs) {
    assert.equal(result.status, 'complete');
    assert.equal(result.records[1].durationNs.length, 33);
    assert.ok(result.parentRoundtripNs >= result.parentSpawnToReadyNs);
  }
  const shadow = join(temporary, 'node_modules/@jimmie-potts/agent-lifecycle-contracts/python/jsonschema.py');
  writeFileSync(shadow, 'class Draft202012Validator:\n def __init__(self, schema): pass\n def is_valid(self, value): return True\n');
  const shadowed = run('python', ['-B', ...command, '--output', join(temporary, 'shadowed')]);
  assert.equal(shadowed.status, 2, 'Unmanifested Python dependency shadow must be rejected before execution');
  rmSync(shadow);
  const fixture = join(temporary, 'node_modules/@jimmie-potts/agent-lifecycle-contracts/fixtures/lifecycle-v1.json');
  writeFileSync(fixture, '{}');
  const rejected = run('python', ['-B', ...command, '--output', join(temporary, 'tampered')]);
  assert.equal(rejected.status, 2, 'Changed installed corpus must be rejected before measurements');
  console.log('Released external consumer: Python and Node each measured 33 validated cases; tampered corpus rejected.');
} finally {
  rmSync(temporary, {recursive: true, force: true});
}
