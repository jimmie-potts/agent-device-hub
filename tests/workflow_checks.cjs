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

const expectedTriggers = {
  push: { branches: ['main'], 'paths-ignore': ['docs/work-guide/**'] },
  pull_request: { 'paths-ignore': ['docs/work-guide/**'] },
};

test('both workflows exclude only guide-only changes', () => {
  const cases = [
    ['guide addition', ['docs/work-guide/new.md'], true],
    ['generator and test edits', ['docs/work-guide/work/build_guide.py', 'docs/work-guide/work/test_maintenance.py'], true],
    ['output deletion', ['docs/work-guide/outputs/retired.html'], true],
    ['source', ['docs/work-guide/updates.md', 'packages/mcp/src/server.ts'], false],
    ['root documentation', ['docs/work-guide/updates.md', 'docs/development.md'], false],
    ['dependency', ['docs/work-guide/updates.md', 'package-lock.json'], false],
    ['workflow', ['docs/work-guide/README.md', '.github/workflows/ci.yml'], false],
    ['rename out', ['docs/work-guide/work/build_guide.py', 'docs/build_guide.py'], false],
    ['similarly named folder', ['docs/work-guides/new.md'], false],
  ];
  for (const file of ['ci.yml', 'work-guide.yml']) {
    const workflow = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8'));
    assert.deepEqual(workflow.on, expectedTriggers, file);
    for (const event of ['push', 'pull_request']) {
      const patterns = workflow.on[event]['paths-ignore'];
      // Exercise the configured simple glob against bounded path sets, not
      // GitHub's diff generation, truncation, or hosted event scheduler.
      for (const [name, paths, ignored] of cases) {
        assert.equal(paths.every(file => patterns.some(pattern => path.posix.matchesGlob(file, pattern))), ignored, `${file} ${event}: ${name}`);
      }
    }
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    assert.deepEqual(workflow.concurrency, {
      group: '${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.run_id }}',
      'cancel-in-progress': true,
    });
  }
});

test('CI runs five Ubuntu jobs and retains every suite', () => {
  const ci = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
  const guide = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/work-guide.yml'), 'utf8'));
  const coreJobs = Object.values(ci.jobs).reduce((count, job) => count
    + Object.values(job.strategy.matrix).reduce((n, values) => n * values.length, 1), 0);
  assert.equal(coreJobs + Object.keys(guide.jobs).length, 5, 'normal CI must run exactly five jobs');
  assert.deepEqual(ci.on, expectedTriggers);
  assert.deepEqual(ci.concurrency, {
    group: '${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.run_id }}',
    'cancel-in-progress': true,
  });
  const suites = {
    workflow: ['npm ci', 'npm run check:workflow', 'npm run test:workflow'],
    contracts: ['npm ci', 'python -m pip install -r requirements-contracts.txt', 'npm run build', 'npm run typecheck', 'npm run test:contracts:built', 'npm run test:contracts:python', 'npm run test:performance', 'npm run test:package:built', 'npm run test:lifecycle:built', 'npm run test:lifecycle:python', 'npm run test:lifecycle:package:built', 'npm run test:agent-state:built', 'npm run test:agent-state:python', 'npm run test:agent-state:package:built'],
    mcp: ['npm ci', 'npm run build', 'npm run typecheck', 'npm run test:mcp:built', 'npm run test:mcp:protocol:built', 'npm run test:mcp:package:built'],
  };
  const names = {
    workflow: 'Workflow checks on ${{ matrix.os }}',
    contracts: 'Contracts and state Python ${{ matrix.python }} on ${{ matrix.os }}',
    mcp: 'MCP on ${{ matrix.os }}',
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
    if (id === 'contracts') expectedSetup.push({
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
      os: ['ubuntu-latest'],
      ...(id === 'contracts' ? { python: ['3.12', '3.14'] } : {}),
    });
    assert.equal(job.if, undefined, 'all matrix jobs must run');
    assert.equal(job.concurrency, undefined, 'matrix siblings must not cancel each other');
    const linuxSteps = job.steps.filter(step => step.name === 'Check isolated Linux hook qualification');
    assert.deepEqual(linuxSteps, id === 'workflow' ? [{
      name: 'Check isolated Linux hook qualification',
      if: "runner.os == 'Linux'",
      run: 'sudo apt-get update\nsudo apt-get install -y bubblewrap apparmor-profiles\nsudo apparmor_parser -r /usr/share/apparmor/extra-profiles/bwrap-userns-restrict\nbwrap --unshare-all --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 /usr/bin/true\nnpm run test:performance:linux\n',
    }] : []);
    const originalSteps = job.steps.filter(step => !linuxSteps.includes(step));
    assert.deepEqual(originalSteps.filter(step => step.run).map(step => step.run), runs);
    assert(originalSteps.every(step => step.if === undefined && !step['continue-on-error']));
  }
  assert.equal(builds, 3);
});

const builtPayloads = {
  'test:contracts': 'node --test packages/contracts/tests/*.test.mjs',
  'test:package': 'node scripts/package-contracts.mjs --test',
  'test:mcp': 'node --test packages/mcp/tests/tools.test.mjs',
  'test:mcp:protocol': 'node --test packages/mcp/tests/protocol.test.mjs',
  'test:mcp:package': 'node scripts/package-mcp.mjs --test',
  'test:lifecycle': 'node --test packages/lifecycle-contracts/tests/*.test.mjs',
  'test:lifecycle:package': 'node scripts/package-lifecycle.mjs --test',
  'test:agent-state': 'node --test packages/agent-state/tests/*.test.mjs',
  'test:agent-state:package': 'node scripts/package-agent-state.mjs --test',
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

// Keep guide build, browser and retained review evidence under regression coverage.
test('guide CI retains its validation and review artifacts', () => {
  const workflow = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/work-guide.yml'), 'utf8'));
  assert.deepEqual(workflow.jobs, { guide:
     { name: 'Work guide build and browser checks',
       'runs-on': 'ubuntu-latest',
       'timeout-minutes': 10,
       steps:
        [ { uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1' },
          { uses: 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020', with: { 'node-version': '24' } },
          { uses: 'actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97',
            with: { 'python-version': '3.12' } },
          { run: 'python3 docs/work-guide/work/build_guide.py' },
          { run: 'git diff --exit-code -- docs/work-guide/outputs' },
          { run: 'python3 docs/work-guide/work/test_maintenance.py' },
          { name: 'Prepare the pinned browser checker',
            run:
             'npm install --prefix "$RUNNER_TEMP/guide-browser" --no-save --no-package-lock playwright@1.63.0\nnode "$RUNNER_TEMP/guide-browser/node_modules/playwright/cli.js" install --with-deps chromium\n' },
          { name: 'Check the guide and capture review evidence',
            run:
             'GUIDE_PLAYWRIGHT_MODULE="$RUNNER_TEMP/guide-browser/node_modules/playwright" node docs/work-guide/work/check_guide.cjs' },
          { uses: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
            with:
             { name: 'work-guide-review',
               path:
                'docs/work-guide/work/guide-*.png\ndocs/work-guide/work/guide-print-check.pdf\ndocs/work-guide/work/guide-verification.json\n',
               'if-no-files-found': 'error',
               'retention-days': 14 } } ] } });
});
