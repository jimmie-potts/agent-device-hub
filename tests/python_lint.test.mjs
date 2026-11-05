import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

function lint(args, input) {
  const result = spawnSync('npm', ['run', '--silent', 'lint:python', '--', ...args], {
    cwd: root, encoding: 'utf8', input, timeout: 30000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
}

test('the configured lint command rejects undefined names and shared mutable defaults', () => {
  const args = ['--stdin-filename', 'tests/performance/ruff_probe.py', '-'];
  for (const [source, code] of [
    ['print(missing_name)\n', 'F821'],
    ['def append(value, values=[]):\n    values.append(value)\n    return values\n', 'B006'],
  ]) {
    const result = lint(args, source);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, new RegExp(`\\b${code}\\b`));
  }
  const clean = lint(args, 'def append(value, values=None):\n    if values is None:\n        values = []\n    values.append(value)\n    return values\n');
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
});

test('lint discovery includes surviving tooling and omits retained consumers and source copies', () => {
  const result = lint(['--show-files']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const files = result.stdout.trim().split('\n').map(file => file.slice(root.length));
  for (const expected of [
    'apps/maintenance/recommendations/recommendations.py', 'docs/system-design/check.py',
    'docs/skins/skin.py', 'scripts/performance/standalone.py', 'tests/performance/test_validators.py',
    'modules/nanoleaf/tests/fixtures/record.py',
  ]) assert.ok(files.includes(expected), expected);
  assert.ok(files.every(file => file.endsWith('.py')), result.stdout);
  for (const excluded of ['modules/onn/', 'packages/', 'controllers/', 'docs/diagrams/legacy/', 'scripts/performance/vendor/', '.local/']) {
    assert.ok(files.every(file => !file.startsWith(excluded)), excluded);
  }
});
