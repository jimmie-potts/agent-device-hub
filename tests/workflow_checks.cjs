const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const wrapper = path.join(root, 'scripts', 'openspec.cjs');
const check = path.join(root, 'scripts', 'check-workflow.cjs');
const validSpec = `# Playlist command queue

## Purpose
Keep playlist commands stable when the same task event is received more than once.

## Requirements
### Requirement: Queue a player command once
The system SHALL queue at most one completion for the same player command.

#### Scenario: Duplicate completion
- **WHEN** the same command completion is received twice
- **THEN** the queue contains exactly one entry for that turn
`;

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-hub-workflow-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'openspec', 'specs'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'openspec', 'changes', 'archive'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
  return directory;
}

function writeSpec(directory, content) {
  const folder = path.join(directory, 'openspec', 'specs', 'playlist-command-queue');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'spec.md'), content);
}

function writeArchive(directory, completed) {
  const folder = path.join(directory, 'openspec', 'changes', 'archive', '2026-09-05-gh-1-queue');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, '.openspec.yaml'), 'schema: spec-driven\n');
  fs.writeFileSync(path.join(folder, 'tasks.md'), `## 1. Queue\n- [${completed ? 'x' : ' '}] 1.1 Deduplicate completion events; verify one queue entry.\n`);
}

function run(file, directory, args = [], env = {}) {
  const result = spawnSync(process.execPath, [file, ...args], {
    cwd: directory,
    env: { ...process.env, CODEX_HOME: path.join(directory, 'fixture-codex'), ...env },
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
}

test('an empty bootstrap reports zero items without claiming a behavior baseline', (t) => {
  const result = run(check, fixture(t));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"items": 0/);
});

test('a valid capability is checked from the caller fixture rather than the source repository', (t) => {
  const directory = fixture(t);
  writeSpec(directory, validSpec);
  const result = run(wrapper, directory, ['validate', '--all', '--strict', '--json', '--no-interactive']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.summary.totals.items, 1);
  assert.equal(report.summary.totals.passed, 1);
  assert.equal(report.items[0].id, 'playlist-command-queue');
});

test('a requirement without a scenario makes the combined command fail', (t) => {
  const directory = fixture(t);
  writeSpec(directory, validSpec.split('#### Scenario:')[0]);
  const result = run(check, directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /scenario/i);
});

test('an unfinished archived task prevents success', (t) => {
  const directory = fixture(t);
  writeArchive(directory, false);
  const result = run(check, directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /incomplete|unchecked|unfinished/i);
});

test('a completed archive and valid capability pass together', (t) => {
  const directory = fixture(t);
  writeSpec(directory, validSpec);
  writeArchive(directory, true);
  const result = run(check, directory);
  assert.equal(result.status, 0, result.stderr + result.stdout);
});

test('archive validation still runs when current specification validation fails', (t) => {
  const directory = fixture(t);
  writeSpec(directory, validSpec.split('#### Scenario:')[0]);
  writeArchive(directory, false);
  const result = run(check, directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /scenario/i);
  assert.match(result.stdout, /incomplete|unchecked|unfinished/i);
});

test('CLI argument errors propagate through the wrapper', (t) => {
  const result = run(wrapper, fixture(t), ['--unknown-pixoo-option']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown.*option/i);
});

test('legacy integration regeneration in an isolated fixture preserves user configuration and domain skills', (t) => {
  for (const initial of [null, '{"profile":"custom","delivery":"commands","workflows":["explore"]}\n']) {
    const directory = fixture(t);
    const userConfig = path.join(directory, 'user-config');
    const settings = path.join(userConfig, 'openspec', 'config.json');
    if (initial !== null) {
      fs.mkdirSync(path.dirname(settings), { recursive: true });
      fs.writeFileSync(settings, initial);
    }
    const skills = path.join(directory, '.agents', 'skills');
    fs.mkdirSync(path.join(skills, 'openspec-explore'), { recursive: true });
    fs.writeFileSync(path.join(skills, 'openspec-explore', 'SKILL.md'), 'Legacy integration fixture.\n');
    fs.mkdirSync(path.join(skills, 'sample-domain'), { recursive: true });
    const domainSkill = 'Domain-owned fixture; regeneration must preserve it.\n';
    fs.writeFileSync(path.join(skills, 'sample-domain', 'SKILL.md'), domainSkill);
    const result = run(wrapper, directory, ['init', '--tools', 'codex', '--profile', 'core', '--no-animation'], {
      XDG_CONFIG_HOME: userConfig,
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const after = fs.existsSync(settings) ? fs.readFileSync(settings, 'utf8') : null;
    assert.equal(after, initial, 'regeneration must not create or change user OpenSpec configuration');
    assert.equal(fs.readFileSync(path.join(skills, 'sample-domain', 'SKILL.md'), 'utf8'), domainSkill);
    assert.equal(fs.readdirSync(skills).filter((name) => name.startsWith('openspec-')).length, 6);
  }
});

test('specification-only initialization creates no repository skill integrations', (t) => {
  const directory = fixture(t);
  const result = run(wrapper, directory, ['init', '--tools', 'none', '--profile', 'core', '--no-animation']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  for (const name of ['.agents', '.codex', '.claude']) {
    assert.equal(fs.existsSync(path.join(directory, name)), false, `${name} must not be generated`);
  }
});

test('initialization preserves personal Codex prompts with current integrations present', (t) => {
  const directory = fixture(t);
  const personalHome = path.join(directory, 'personal-codex');
  const prompt = path.join(personalHome, 'prompts', 'opsx-apply.md');
  fs.mkdirSync(path.dirname(prompt), { recursive: true });
  const original = 'Personal OpenSpec prompt; preserve this content.\n';
  for (const integration of ['codex', 'none']) {
    fs.writeFileSync(prompt, original);
    const result = run(wrapper, directory, ['init', '--tools', integration, '--profile', 'core', '--no-animation'], {
      CODEX_HOME: personalHome,
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(fs.existsSync(prompt), true, `${integration} initialization must preserve the personal prompt`);
    assert.equal(fs.readFileSync(prompt, 'utf8'), original);
  }
});

// Parse the workflow so formatting changes do not alter the scheduling checks.
const YAML = require('yaml');

test('CI validates PRs once and retains every platform and suite', () => {
  const ci = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
  assert.deepEqual(ci.on, { push: { branches: ['main'] }, pull_request: null });
  assert.deepEqual(ci.concurrency, {
    group: '${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.run_id }}',
    'cancel-in-progress': true,
  });
  const suites = {
    workflow: ['npm ci', 'npm run check:workflow', 'npm run test:workflow'],
    contracts: ['npm ci', 'python -m pip install -r requirements-contracts.txt', 'npm run build', 'npm run typecheck', 'npm run test:contracts:built', 'npm run test:contracts:python', 'npm run test:package:built'],
    mcp: ['npm ci', 'npm run build', 'npm run typecheck', 'npm run test:mcp:built', 'npm run test:mcp:protocol:built', 'npm run test:mcp:package:built'],
    lifecycle: ['npm ci', 'python -m pip install -r requirements-contracts.txt', 'npm run build', 'npm run typecheck', 'npm run test:lifecycle:built', 'npm run test:lifecycle:python', 'npm run test:lifecycle:package:built'],
  };
  const names = {
    workflow: 'Workflow checks on ${{ matrix.os }}',
    contracts: 'Contracts Python ${{ matrix.python }} on ${{ matrix.os }}',
    mcp: 'MCP on ${{ matrix.os }}',
    lifecycle: 'Lifecycle Python ${{ matrix.python }} on ${{ matrix.os }}',
  };
  assert.deepEqual(ci.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(ci.jobs), Object.keys(suites));
  let builds = 0;
  for (const [id, runs] of Object.entries(suites)) {
    const job = ci.jobs[id];
    const setup = job.steps.filter(step => step.uses);
    const expectedSetup = [
      { uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1' },
      { uses: 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020', with: { 'node-version': '24', cache: 'npm' } },
    ];
    if (['contracts', 'lifecycle'].includes(id)) expectedSetup.push({
      uses: 'actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97',
      with: { 'python-version': '${{ matrix.python }}', cache: 'pip', 'cache-dependency-path': 'requirements-contracts.txt' },
    });
    assert.deepEqual(setup, expectedSetup);
    builds += Object.values(job.strategy.matrix).reduce((n, values) => n * values.length, 1)
      * job.steps.filter(step => step.run === 'npm run build').length;
    assert.equal(job.name, names[id]);
    assert.equal(job['runs-on'], '${{ matrix.os }}');
    assert.equal(job['timeout-minutes'], 10);
    assert.equal(job.strategy['fail-fast'], false);
    assert.deepEqual(job.strategy.matrix, {
      os: ['ubuntu-latest', 'windows-latest'],
      ...(['contracts', 'lifecycle'].includes(id) ? { python: ['3.12', '3.14'] } : {}),
    });
    assert.equal(job.if, undefined, 'all matrix jobs must run');
    assert.equal(job.concurrency, undefined, 'matrix siblings must not cancel each other');
    assert.deepEqual(job.steps.filter(step => step.run).map(step => step.run), runs);
    assert(job.steps.every(step => step.if === undefined && !step['continue-on-error']));
  }
  assert.equal(builds, 10);
});

const builtPayloads = {
  'test:contracts': 'node --test packages/contracts/tests/*.test.mjs',
  'test:package': 'node scripts/package-contracts.mjs --test',
  'test:mcp': 'node --test packages/mcp/tests/tools.test.mjs',
  'test:mcp:protocol': 'node --test packages/mcp/tests/protocol.test.mjs',
  'test:mcp:package': 'node scripts/package-mcp.mjs --test',
  'test:lifecycle': 'node --test packages/lifecycle-contracts/tests/*.test.mjs',
  'test:lifecycle:package': 'node scripts/package-lifecycle.mjs --test',
};

test('built variants retain every original test payload and standalone build', () => {
  const { scripts } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const [name, payload] of Object.entries(builtPayloads)) {
    assert.equal(scripts[`${name}:built`], payload);
    assert.equal(scripts[name], `npm run build && npm run ${name}:built`);
  }
});

test('the standalone wrapper runs its payload only after a successful build', (t) => {
  const directory = fixture(t);
  const { scripts } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ private: true, scripts: {
    build: 'node build.cjs',
    'test:contracts': scripts['test:contracts'],
    'test:contracts:built': 'node payload.cjs',
  } }));
  fs.writeFileSync(path.join(directory, 'build.cjs'), `
    const fs = require('node:fs');
    if (fs.existsSync('fail-build')) process.exit(9);
    fs.writeFileSync('built', 'yes');
  `);
  fs.writeFileSync(path.join(directory, 'payload.cjs'), `
    const fs = require('node:fs');
    require('node:assert/strict').equal(fs.readFileSync('built', 'utf8'), 'yes');
    fs.writeFileSync('payload-ran', 'yes');
  `);
  const invoke = () => {
    assert(process.env.npm_execpath, 'run through npm run test:workflow');
    const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'test:contracts'], {
      cwd: directory, env: process.env, encoding: 'utf8', timeout: 30000,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    return result;
  };
  const good = invoke();
  assert.equal(good.status, 0, good.stderr);
  assert.equal(fs.readFileSync(path.join(directory, 'payload-ran'), 'utf8'), 'yes');
  fs.unlinkSync(path.join(directory, 'payload-ran'));
  fs.writeFileSync(path.join(directory, 'fail-build'), 'yes');
  // Retain the prior build marker: stale output must not allow the payload to run.
  const bad = invoke();
  assert.notEqual(bad.status, 0);
  assert.equal(fs.existsSync(path.join(directory, 'payload-ran')), false);
});
