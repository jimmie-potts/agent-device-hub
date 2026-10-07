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

// Parse the GitHub Actions workflows so formatting changes do not alter scheduling checks.
const YAML = require('yaml');

const storyHeadings = [
  'Outcome and real setup',
  'Smallest useful implementation',
  'Behavior and protections to preserve',
  'Observable acceptance and planned evidence',
  'Meaningful deferrals',
  'Guide',
];

function checkStoryOpening(body) {
  const visible = body.replace(/<!--[\s\S]*?-->/g, '').trim();
  const headings = [...visible.matchAll(/^## (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(headings.slice(1), storyHeadings);
  assert.ok(visible.startsWith(`## ${headings[0]}\n\n`));
  assert.ok(!['Summary', 'Overview', 'In plain English'].includes(headings[0]));
  const opening = visible.split(`\n## ${storyHeadings[0]}`)[0].split('\n').slice(2);
  assert.equal(opening.filter(line => line.startsWith('- ')).length, 5);
  assert.ok(opening.every(line => !line.trim() || /^- \S/.test(line)), 'opening contains only five top-level bullets');
}

test('the GitHub Markdown template starts with an editable headline and five bullets', () => {
  const template = fs.readFileSync(path.join(root, '.github/ISSUE_TEMPLATE/feature.md'), 'utf8');
  const frontmatter = template.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(frontmatter, 'GitHub chooser metadata is present');
  assert.deepEqual(YAML.parse(frontmatter[1]), {
    name: 'Work item',
    about: 'Define a verifiable feature, investigation or maintenance increment.',
    labels: ['enhancement', 'status:backlog'],
  });
  checkStoryOpening(template.slice(frontmatter[0].length));
  assert.equal(fs.existsSync(path.join(root, '.github/ISSUE_TEMPLATE/feature.yml')), false,
    'the fixed-heading form must not remain as a competing authoring path');
});

for (const name of ['feature', 'investigation']) {
  test(`the local ${name} story sample keeps the opening before the detailed sections`, () => {
    const body = fs.readFileSync(path.join(root, `tests/fixtures/story-openings/${name}.md`), 'utf8');
    checkStoryOpening(body);
    assert.match(body, /Delivery target: source-only/);
    assert.match(body, /\*\*Topic:\*\* desktop-controls/);
  });
}

const guideTriggers = {
  push: { branches: ['main'], 'paths-ignore': ['docs/work-guide/**'] },
  pull_request: { 'paths-ignore': ['docs/work-guide/**'] },
};
// Hub #861: the heavy Checks workflow also skips Markdown-only changes.
const expectedTriggers = {
  push: { branches: ['main'], 'paths-ignore': ['docs/work-guide/**', '**/*.md'] },
  pull_request: { 'paths-ignore': ['docs/work-guide/**', '**/*.md'] },
};

test('every workflow skips guide-only changes and Checks also skips Markdown-only changes', () => {
  // [name, paths, skipped by the guide-only filter, skipped by the Checks filter]
  const cases = [
    ['guide addition', ['docs/work-guide/new.md'], true, true],
    ['generator and test edits', ['docs/work-guide/work/build_guide.py', 'docs/work-guide/work/test_maintenance.py'], true, true],
    ['output deletion', ['docs/work-guide/outputs/retired.html'], true, true],
    ['source', ['docs/work-guide/work/backlogs/snapshot.json', 'packages/mcp/src/server.ts'], false, false],
    ['root documentation', ['docs/work-guide/work/backlogs/snapshot.json', 'docs/development.md'], false, true],
    ['dependency', ['docs/work-guide/work/backlogs/snapshot.json', 'package-lock.json'], false, false],
    ['workflow', ['docs/work-guide/README.md', '.github/workflows/checks.yml'], false, false],
    ['rename out', ['docs/work-guide/work/build_guide.py', 'docs/build_guide.py'], false, false],
    ['similarly named folder', ['docs/work-guides/new.md'], false, true],
    ['Markdown only', ['README.md', 'AGENTS.md', 'docs/sdlc.md', 'apps/hub/README.md', 'openspec/specs/unified-dashboard/spec.md'], false, true],
    ['Markdown with source', ['docs/development.md', 'apps/hub/src/server.ts'], false, false],
    ['Markdown-like name', ['docs/notes.md.txt'], false, false],
  ];
  for (const [file, triggers, checks] of [['checks.yml', expectedTriggers, true], ['workflow.yml', guideTriggers, false], ['guide.yml', guideTriggers, false]]) {
    const workflow = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8'));
    assert.deepEqual(workflow.on, triggers, file);
    for (const event of ['push', 'pull_request']) {
      const patterns = workflow.on[event]['paths-ignore'];
      // Exercise the configured simple glob against bounded path sets, not
      // GitHub's hosted event scheduler or diff selection.
      for (const [name, paths, guideSkip, checksSkip] of cases) {
        assert.equal(paths.every(file => patterns.some(pattern => path.posix.matchesGlob(file, pattern))), checks ? checksSkip : guideSkip, `${file} ${event}: ${name}`);
      }
    }
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    assert.deepEqual(workflow.concurrency, {
      group: '${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.run_id }}',
      'cancel-in-progress': true,
    });
  }
});

test('CI runs six GitHub-hosted Linux jobs and retains every suite once', () => {
  const read = file => YAML.parse(fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8'));
  const checks = read('checks.yml'), guide = read('guide.yml'), workflowChecks = read('workflow.yml');
  // Hub #870: GitHub-hosted runners replaced Depot. The workflows use new paths, because GitHub keeps the
  // manually disabled state of the retired ci.yml and work-guide.yml copies.
  assert.deepEqual(fs.readdirSync(path.join(root, '.github/workflows')).sort(), ['checks.yml', 'guide.yml', 'workflow.yml']);
  assert.equal(fs.existsSync(path.join(root, '.depot')), false, 'Depot workflows would run twice');
  // Workflow checks run in their own workflow so Markdown-only changes still run them (Hub #861).
  assert.equal(workflowChecks.name, 'Workflow');
  assert.deepEqual(Object.keys(workflowChecks.jobs), ['workflow']);
  const ci = { ...checks, jobs: { ...checks.jobs, ...workflowChecks.jobs } };
  const coreJobs = Object.values(ci.jobs).reduce((count, job) => count
    + Object.values(job.strategy.matrix).reduce((n, values) => n * values.length, 1), 0);
  assert.equal(coreJobs + Object.keys(guide.jobs).length, 6, 'normal CI must run exactly six jobs');
  assert.deepEqual(checks.on, expectedTriggers);
  assert.deepEqual(ci.concurrency, {
    group: '${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.run_id }}',
    'cancel-in-progress': true,
  });
  const suites = {
    workflow: ['npm ci', 'npm run check:workflow', 'npm run test:workflow',
      'node --test docs/work-guide/contracts/records.test.mjs',
      'node --test docs/work-guide/contracts/epic-guide/contracts.test.mjs', 'npm run test:preflight'],
    core: ['npm ci', 'python -m pip install -r requirements-contracts.txt -r packages/observability/requirements-host.txt', 'npm run build', 'npm run typecheck', 'npm run lint:js', 'npm run test:maintenance:built', 'npm run test:maintenance:package:built', 'npm run test:observability:built', 'npm run test:observability:pilot', 'npm run test:observability:python', 'npm run test:observability:query', 'npm run test:observability:package:built', 'npm run test:contracts:built', 'npm run test:contracts:python', 'npm run test:performance', 'npm run test:package:built', 'npm run test:events:built', 'npm run test:events:python', 'npm run test:sdk:built', 'npm run test:runtime:built', 'npm run test:runtime:scenarios:built', 'npm run test:lifecycle:built', 'npm run test:lifecycle:python', 'npm run test:lifecycle:package:built', 'npm run test:hub:built', 'npm run test:hub:package:built', 'npm run test:agent-state:built', 'npm run test:agent-state:python', 'npm run test:agent-state:package:built', 'npm run test:agent-status:built', 'npm run test:lifx:built', 'npm run test:tidbyt:built', 'npm run test:local-controllers:built', 'npm run test:tidbyt:python', 'npm run test:wispr:built', 'npm run test:wispr:package:built', 'npm run test:chompi-bridge:built', 'npm run test:chompi-bridge:scenarios',
      'npm run test:mcp:built', 'npm run test:mcp:protocol:built', 'npm run test:mcp:package:built', 'npm run test:pixoo:built',
      'npm run test:nanoleaf:built'],
    dashboard: ['npm ci', 'npx playwright install --with-deps chromium', 'npm run build', 'npm run test:dashboard', 'npm run test:dashboard:browser', 'npm run test:observability:browser'],
    firmware: ['npm run test:firmware', 'npm run test:firmware:arm'],
    'app-verify': ['npm ci', 'npx playwright install --with-deps chromium', 'npm run build', 'npm run test:app-verify:built', 'npm run test:app-verify:package:built', 'npm run test:hub:verify:built', 'npm run test:verify-host', 'npm run test:chompi-bridge:verify:built', 'npm run test:chompi-bridge:browser', 'npm run test:runtime:verify:built'],
  };
  const names = {
    workflow: 'Workflow checks on ${{ matrix.os }}',
    core: 'Build, lint and core tests on ${{ matrix.os }}',
    dashboard: 'Dashboard browser and contracts on ${{ matrix.os }}',
    firmware: 'Firmware host tests and ARM build on ${{ matrix.os }}',
    'app-verify': 'App verification on ${{ matrix.os }}',
  };
  assert.deepEqual(checks.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(ci.jobs).sort(), Object.keys(suites).sort());
  // Each suite runs in exactly one job.
  const runs = Object.values(suites).flat().filter(run => run.startsWith('npm run test:'));
  assert.deepEqual(runs, [...new Set(runs)]);
  let builds = 0;
  for (const [id, runs] of Object.entries(suites)) {
    const job = ci.jobs[id];
    const setup = job.steps.filter(step => step.uses);
    const expectedSetup = [
      { uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1' },
      { uses: 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020', with: { 'node-version': '24', cache: 'npm' } },
    ];
    // One Python version: the installed Nanoleaf runtime's (Hub #861).
    if (id === 'core') expectedSetup.push({
      uses: 'actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97',
      with: { 'python-version': '3.14', cache: 'pip', 'cache-dependency-path': 'requirements-contracts.txt' },
    });
    assert.deepEqual(setup, expectedSetup);
    builds += Object.values(job.strategy.matrix).reduce((n, values) => n * values.length, 1)
      * job.steps.filter(step => step.run === 'npm run build').length;
    assert.equal(job.name, names[id]);
    assert.equal(job['runs-on'], '${{ matrix.os }}');
    // The core job runs every Node and Python suite once; it takes about 8.5 minutes. The dashboard job took
    // 523 s on GitHub-hosted runners (#870). App verification took 7-9.6 minutes and once timed out at 10, because
    // its Playwright install with system dependencies varies from 22 s to 227 s on hosted runners.
    assert.equal(job['timeout-minutes'], ['core', 'dashboard', 'app-verify'].includes(id) ? 15 : 10);
    assert.equal(job.strategy['fail-fast'], false);
    assert.deepEqual(job.strategy.matrix, { os: ['ubuntu-latest'] });
    assert.equal(job.if, undefined, 'all matrix jobs must run');
    assert.equal(job.concurrency, undefined, 'matrix siblings must not cancel each other');
    const linuxSteps = job.steps.filter(step => step.name === 'Check isolated Linux hook qualification');
    assert.deepEqual(linuxSteps, id === 'workflow' ? [{
      name: 'Check isolated Linux hook qualification',
      if: "runner.os == 'Linux'",
      run: 'sudo apt-get update\nsudo apt-get install -y bubblewrap apparmor-profiles\nsudo apparmor_parser -r /usr/share/apparmor/extra-profiles/bwrap-userns-restrict\nbwrap --unshare-all --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 /usr/bin/true\nnpm run test:performance:linux\nnpm run test:performance:standalone\n',
    }] : []);
    // Hub #494: no job may provide or require a systemd user manager. App verification hides the runner's manager
    // until app-verify works under its systemd 255 (#873), so lifecycle tests skip as they did on Depot.
    assert.deepEqual(job.env, id === 'app-verify' ? { XDG_RUNTIME_DIR: '', DBUS_SESSION_BUS_ADDRESS: '' } : undefined);
    assert.equal(job.steps.some(step => /loginctl|APP_VERIFY_REQUIRE_SYSTEMD/.test(step.run ?? '')), false);
    const originalSteps = job.steps.filter(step => !linuxSteps.includes(step));
    assert.deepEqual(originalSteps.filter(step => step.run).map(step => step.run), runs);
    assert(originalSteps.every(step => step.if === undefined && !step['continue-on-error']));
  }
  assert.equal(builds, 3);
});

// Hub #861: Checks skips Markdown-only changes, so the Workflow job guards the Markdown that Checks jobs depend on.
const packagedMarkdown = [
  'apps/hub/README.md', 'apps/hub/SETUP.md', 'apps/maintenance/README.md', 'apps/wispr-collector/README.md',
  'docs/agent-lifecycle-contract.md', 'docs/app-verification.md', 'docs/controller-contract.md',
  'docs/decisions/0009-app-verification-runs.md', 'docs/install-contract.md', 'docs/observability-contract.md',
  'docs/provider-qualification.md', 'packages/agent-state/README.md', 'packages/app-verify/README.md',
  'packages/mcp/README.md', 'packages/observability/README.md', 'packages/wispr-contracts/README.md',
];
const packagedNames = new Set(['README.md', 'SETUP.md', 'CONTRACT.md', 'install-contract.md', 'provider-qualification.md',
  'app-verification.md', 'adr-0009-app-verification-runs.md']);

test('Markdown that package checks copy exists, and the hash-checked vendor folders hold none', () => {
  for (const file of packagedMarkdown) assert.ok(fs.existsSync(path.join(root, file)), `${file} is copied by a package script; delete or rename it only with that script`);
  for (const script of fs.readdirSync(path.join(root, 'scripts')).filter(file => /^package-.*\.mjs$/.test(file))) {
    const text = fs.readFileSync(path.join(root, 'scripts', script), 'utf8');
    for (const [, name] of text.matchAll(/['"`]([^'"`\s]*\.md)['"`]/g)) {
      assert.ok(packagedMarkdown.includes(name) || packagedNames.has(name), `${script} copies ${name}; add it to packagedMarkdown`);
    }
  }
  // The performance admission checks reject any entry in a vendored source folder outside its hash list.
  for (const folder of ['nanoleaf', 'nanoleaf-linux']) {
    const entries = fs.readdirSync(path.join(root, 'scripts/performance/vendor', folder), { recursive: true }).map(String);
    assert.deepEqual(entries.filter(file => file.endsWith('.md')), [], `scripts/performance/vendor/${folder}`);
  }
});

const builtPayloads = {
  'test:maintenance': 'node --test apps/maintenance/tests/*.test.mjs',
  'test:maintenance:package': 'node scripts/package-maintenance.mjs --test',
  'test:observability': 'node --test packages/observability/tests/*.test.mjs',
  'test:observability:package': 'node scripts/package-observability.mjs --test',
  'test:contracts': 'node --test packages/contracts/tests/*.test.mjs',
  'test:package': 'node scripts/package-contracts.mjs --test',
  'test:mcp': 'node --test packages/mcp/tests/tools.test.mjs',
  'test:mcp:protocol': 'node --test packages/mcp/tests/protocol.test.mjs',
  'test:mcp:package': 'node scripts/package-mcp.mjs --test',
  'test:lifecycle': 'node --test packages/lifecycle-contracts/tests/*.test.mjs',
  'test:lifecycle:package': 'node scripts/package-lifecycle.mjs --test',
  'test:agent-state': 'node --test packages/agent-state/tests/*.test.mjs',
  'test:agent-state:package': 'node scripts/package-agent-state.mjs --test',
  'test:tidbyt': 'node --test controllers/tidbyt/tests/*.test.mjs',
  'test:lifx': 'node --test controllers/lifx/tests/*.test.mjs',
  'test:local-controllers': 'node --test apps/local-controllers/tests/*.test.mjs',
  'test:app-verify': 'node --test --test-concurrency=1 packages/app-verify/tests/*.test.mjs',
  'test:app-verify:package': 'node scripts/package-app-verify.mjs --test',
  'test:hub:verify': 'node --test --test-concurrency=1 apps/hub/verify/tests/*.test.mjs',
  'test:chompi-bridge': 'node --test apps/chompi-bridge/tests/*.test.mjs',
  // Pixoo's moved tests keep their Vitest runner and resolve built packages from modules/pixoo (Hub #25).
  'test:pixoo': 'cd modules/pixoo && vitest run --config tests/vitest.config.ts',
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
  const workflow = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/guide.yml'), 'utf8'));
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
          { name: 'Check system design documents',
            run: 'python3 docs/system-design/check.py' },
          { name: 'Prepare the pinned browser checker',
            run:
             'npm install --prefix "$RUNNER_TEMP/guide-browser" --no-save --no-package-lock playwright@1.63.0\nnode "$RUNNER_TEMP/guide-browser/node_modules/playwright/cli.js" install --with-deps chromium\n' },
          { name: 'Check epic browser adapters and generated fixtures',
            run: 'npm ci\nnode --test docs/work-guide/browser/tests/*.test.mjs\nGUIDE_BROWSER_EVIDENCE="$RUNNER_TEMP/epic-browser-review" node docs/work-guide/browser/tests/browser.mjs\nnode docs/work-guide/browser/build.mjs --check\nGUIDE_BROWSER_EVIDENCE="$RUNNER_TEMP/epic-browser-review" node docs/work-guide/browser/tests/live.mjs\n' },
          { name: 'Check the guide and capture review evidence',
            run:
             'GUIDE_PLAYWRIGHT_MODULE="$RUNNER_TEMP/guide-browser/node_modules/playwright" node docs/work-guide/work/check_guide.cjs' },
          { name: 'Check system design navigation and print output',
            run:
             'GUIDE_PLAYWRIGHT_MODULE="$RUNNER_TEMP/guide-browser/node_modules/playwright" BUNNY_DESIGN_RECEIPTS="$RUNNER_TEMP/bunny-design-review" node docs/system-design/check.cjs' },
          { name: 'Check shared Places on mobile',
            run:
             'GUIDE_PLAYWRIGHT_MODULE="$RUNNER_TEMP/guide-browser/node_modules/playwright" BUNNY_PLACES_RECEIPTS="$RUNNER_TEMP/bunny-places-review" node docs/skins/check_places.cjs' },
          { uses: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
            with:
             { name: 'work-guide-review',
               path:
                'docs/work-guide/work/guide-*.png\ndocs/work-guide/work/guide-print-check.pdf\ndocs/work-guide/work/guide-verification.json\n${{ runner.temp }}/bunny-places-review/\n${{ runner.temp }}/bunny-design-review\n${{ runner.temp }}/epic-browser-review/\n',
               'if-no-files-found': 'error',
               'retention-days': 14 } } ] } });
});
