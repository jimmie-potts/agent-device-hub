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

function hasLocalFullDiskCheck(source) {
  return /\bSQLITE_FULL\s*=\s*13\b|===?\s*SQLITE_FULL\b|\bSQLITE_FULL\s*===?|errcode[^\n]{0,100}===?\s*13\b|===?\s*13\b[^\n]{0,100}errcode/.test(source);
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
  });
}

const reusableTrigger = {inputs: {qualification: {type: 'boolean', default: false}}};
const allTriggers = {workflow_call: reusableTrigger, push: {branches: ['main']}, pull_request: {}};
// Hub #862: hosted runners sometimes stall in apt until a job's limit. scripts/apt-retry.sh runs a command that uses apt
// in up to three attempts, each under the limit its first argument gives, and each step's limit sits above three
// attempts and their cleanups: 20 minutes for 300 s browser installs, 14 for the hook step's 180 s apt commands.
const aptRetry = (seconds, command) => `bash scripts/apt-retry.sh ${seconds} ${command}`;
const browserInstallMinutes = 20;
const playwrightInstall = aptRetry(300, 'npx playwright install --with-deps chromium');
const hookAptScript = 'sudo apt-get update && sudo apt-get install -y bubblewrap apparmor-profiles';
const hookAptMinutes = 14;
// Markdown-only main pushes retain #861's filter; PRs must emit the required core check.
// Hub #1080: affected selection limits product suites and a manual run selects every group.
const expectedTriggers = {
  workflow_call: reusableTrigger,
  push: { branches: ['main'], 'paths-ignore': ['**/*.md'] },
  pull_request: {},
  workflow_dispatch: {},
};

test('every PR enters Checks while only Markdown-only main pushes filter it', () => {
  for (const [file, triggers, checks] of [['checks.yml', expectedTriggers, true], ['workflow.yml', allTriggers, false]]) {
    const workflow = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8'));
    assert.deepEqual(workflow.on, triggers);
    for (const event of ['push', 'pull_request']) {
      const patterns = workflow.on[event]['paths-ignore'] ?? [];
      for (const [files, skipped] of [
        [['README.md', 'docs/development.md'], checks && event === 'push'],
        [['docs/diagrams/check.py'], false],
        [['docs/notes.md.txt'], false],
        [['docs/work-guide/retired.html'], false],
        [['README.md', 'apps/runtime/src/main.ts'], false],
      ]) assert.equal(files.every(file => patterns.some(pattern => path.posix.matchesGlob(file, pattern))), skipped);
    }
    assert.deepEqual(workflow.permissions, {contents: 'read'});
    assert.deepEqual(workflow.concurrency, {
      group: (checks ? 'checks' : 'workflow') + '-${{ github.event_name }}-${{ github.event.pull_request.number || github.run_id }}',
      'cancel-in-progress': true,
    });
  }
});

test('CI runs eight GitHub-hosted Linux jobs and retains every suite once', () => {
  const read = file => YAML.parse(fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8'));
  const checks = read('checks.yml'), workflowChecks = read('workflow.yml');
  // Hub #870: GitHub-hosted runners replaced Depot. The workflows use new paths, because GitHub keeps the
  // manually disabled state of the retired ci.yml and work-guide.yml copies.
  assert.deepEqual(fs.readdirSync(path.join(root, '.github/workflows')).sort(), ['checks.yml', 'release-qualification.yml', 'workflow.yml']);
  assert.equal(fs.existsSync(path.join(root, '.depot')), false, 'Depot workflows would run twice');
  // Workflow checks run in their own workflow so Markdown-only changes still run them (Hub #861).
  assert.equal(workflowChecks.name, 'Workflow');
  assert.deepEqual(Object.keys(workflowChecks.jobs), ['workflow', 'documents']);
  const ci = { ...checks, jobs: { ...checks.jobs, workflow: workflowChecks.jobs.workflow } };
  const instances = job => (job.strategy ? Object.values(job.strategy.matrix).reduce((n, values) => n * values.length, 1) : 1);
  const coreJobs = Object.values(ci.jobs).reduce((count, job) => count + instances(job), 0);
  // Hub #1080: a pull request runs only its affected work. The select job maps the changed paths to check groups,
  // firmware and App verification run only when selected, and the gate fails unless every selected job succeeded.
  // tests/ci_selection.test.mjs checks the selection conditions themselves.
  assert.equal(coreJobs + 1, 8, 'normal CI must run exactly eight jobs');
  assert.deepEqual(checks.on, expectedTriggers);
  assert.deepEqual(ci.concurrency, {
    group: 'checks-${{ github.event_name }}-${{ github.event.pull_request.number || github.run_id }}',
    'cancel-in-progress': true,
  });
  const suites = {
    select: ['node scripts/ci-selection/cli.mjs select'],
    gate: ['node scripts/ci-selection/cli.mjs gate'],
    workflow: ['npm ci', 'npm run check:workflow', 'npm run test:workflow',
      'npm run build', 'node --test apps/runtime/dist/tests/upgrade-procedure.workflow.js',
      'npm run test:preflight'],
    core: ['npm ci', 'python -m pip install -r requirements-contracts.txt -r packages/observability/requirements-host.txt', 'npm run build', 'npm run typecheck', 'node --test scripts/release/tests/*.test.mjs', 'npm run lint:js', 'npm run test:maintenance:built', 'npm run test:maintenance:package:built', 'npm run test:observability:built', 'npm run test:observability:pilot', 'npm run test:observability:python', 'npm run test:observability:query', 'npm run test:observability:package:built', 'npm run test:contracts:built', 'npm run test:events:built', 'npm run test:events:python', 'npm run test:sdk:built', 'npm run test:runtime:built', 'node --test scripts/tests/bunny.test.mjs scripts/tests/bunny-backup.test.mjs scripts/tests/bunny-operations.test.mjs scripts/tests/bunny-deployment.test.mjs deploy/container/tests/context.test.mjs deploy/container/tests/entrypoint.test.mjs deploy/container/tests/runtime.test.mjs deploy/container/tests/provision-local.test.mjs deploy/container/tests/production-acceptance.test.mjs apps/runtime/tests/mac-codex-hook.test.mjs', 'npm run test:runtime:scenarios:built', 'npm run test:lifecycle:built', 'npm run test:lifecycle:python', 'npm run test:lifecycle:package:built', 'npm run test:agent-state:built', 'npm run test:agent-state:python', 'npm run test:agent-state:package:built', 'npm run test:wispr:built', 'npm run test:wispr:package:built', 'npm run test:chompi-bridge:built', 'npm run test:chompi-bridge:scenarios',
      'npm run test:mcp:built', 'npm run test:mcp:protocol:built', 'npm run test:mcp:package:built', 'npm run test:pixoo:built',
      'npm run test:nanoleaf:built', 'npm run test:playback:built', 'npm run test:lifx-module:built', 'npm run test:tidbyt-module:built',
      'npm run test:codex-desktop:built', 'npm run test:wispr-module:built', 'npm run test:companions:built', 'npm run test:roborock-transport:built', 'npm run test:roborock-transport:consumer:built', 'npm run test:roborock:built', 'npm run test:onn:built', 'npm run test:wemo:built', 'npm run test:reachy:built', 'npm run test:onn:native', 'npm run test:roborock:consumer:built', 'npm run test:dashboard', 'npm run test:runtime-dashboard:built'],
    firmware: ['npm run test:firmware', 'npm run test:firmware:arm'],
    'app-verify': ['npm ci', playwrightInstall, 'npm run build', 'npm run test:app-verify:built', 'npm run test:app-verify:package:built', 'npm run test:verify-host', 'npm run test:chompi-bridge:verify:built', 'npm run test:chompi-bridge:browser',
      'npm run test:dashboard:smoke', 'npm run test:runtime-dashboard:smoke', 'node apps/runtime/dashboard/tests/timeline-card.browser.ts', 'node apps/runtime/dashboard/tests/playback-artwork.browser.ts',
    'node apps/runtime/dashboard/tests/room-models.browser.ts', 'node apps/runtime/dashboard/tests/music-card.browser.ts', 'node apps/runtime/dashboard/tests/tv.browser.ts', 'npm run test:roborock:browser', 'npm run test:onn:browser', 'npm run test:companions:browser', 'npm run test:wemo:browser', 'npm run test:reachy:browser', 'npm run test:observability:browser'],
    'runtime-verify': ['npm ci', playwrightInstall, 'npm run build', 'npm run test:runtime:verify:built'],
  };
  const names = {
    select: 'Select affected checks',
    gate: 'Selected checks gate',
    workflow: 'Workflow checks on ${{ matrix.os }}',
    core: 'Build, lint and core tests on ${{ matrix.os }}',
    // A job skipped before its matrix expands reports the unexpanded name, so the jobs the selection skips name their runner.
    firmware: 'Firmware host tests and ARM build on ubuntu-latest',
    'app-verify': 'App verification on ubuntu-latest',
    'runtime-verify': 'Runtime verification on ubuntu-latest',
  };
  const matrixJobs = ['workflow', 'core'];
  const conditions = { firmware: "needs.select.outputs.firmware == 'true'", 'app-verify': "needs.select.outputs.app-verify == 'true'", 'runtime-verify': "needs.select.outputs.runtime-verify == 'true'", gate: 'always()' };
  assert.deepEqual(checks.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(ci.jobs).sort(), Object.keys(suites).sort());
  // Each suite runs in exactly one job.
  const runs = Object.values(suites).flat().filter(run => run.startsWith('npm run test:'));
  assert.deepEqual(runs, [...new Set(runs)]);
  let builds = 0;
  for (const [id, runs] of Object.entries(suites)) {
    const job = ci.jobs[id];
    const setup = job.steps.filter(step => step.uses);
    // The select and gate jobs check out only the dependency-free selector and install nothing.
    const expectedSetup = ['select', 'gate'].includes(id) ? [
      { uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', with: { 'sparse-checkout': 'scripts/ci-selection' } },
      { uses: 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020', with: { 'node-version': '24' } },
    ] : [
      { uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1' },
      { uses: 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020', with: { 'node-version': '24', cache: 'npm' } },
    ];
    // One Python version: the installed Nanoleaf runtime's (Hub #861), set up only for the suites that use it.
    if (id === 'core') expectedSetup.push({
      if: "contains(fromJSON(needs.select.outputs.groups), 'shared')",
      uses: 'actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97',
      with: { 'python-version': '3.14', cache: 'pip', 'cache-dependency-path': 'requirements-contracts.txt' },
    });
    if (id === 'core') expectedSetup.push({
      if: "contains(fromJSON(needs.select.outputs.groups), 'modules')",
      uses: 'actions/setup-java@b6effb05e454b25005698d916606bdc6ffcbf961',
      with: { distribution: 'temurin', 'java-version': '21' },
    });
    assert.deepEqual(setup, expectedSetup);
    builds += instances(job) * job.steps.filter(step => step.run === 'npm run build').length;
    assert.equal(job.name, names[id]);
    assert.equal(job['runs-on'], matrixJobs.includes(id) ? '${{ matrix.os }}' : 'ubuntu-latest');
    // The core job runs every kept Node and Python suite once. The same source passed in 10m30s on PR #1078 but
    // hit 15 minutes twice on main; its 30 leave finite headroom for slower hosted runs (#1037).
    // Preserve App verification's 40-minute budget from #366 for browser journeys and setup/retry headroom.
    // The unchanged serial runtime catalog has its own required 30-minute job (#1183).
    // The Workflow job takes about 1 minute; its 15 leave room for two stalled attempts of the hook step's apt commands.
    // The select and gate jobs read one comparison or the needs context and take seconds.
    assert.equal(job['timeout-minutes'], id === 'app-verify' ? 40 : ['core', 'runtime-verify'].includes(id) ? 30 : id === 'workflow' ? 15 : ['select', 'gate'].includes(id) ? 5 : 10);
    for (const line of job.steps.flatMap(step => (step.run ?? '').split('\n')).filter(line => /apt-get|--with-deps/.test(line))) {
      assert.match(line, /^bash scripts\/apt-retry\.sh \d+ /, `${id}: every apt command runs through the retry wrapper`);
    }
    const installs = job.steps.filter(step => /playwright(\/cli\.js)? install/.test(step.run ?? ''));
    assert.deepEqual(installs, ['app-verify', 'runtime-verify'].includes(id) ? [{ name: 'Install Chromium with its system dependencies',
      'timeout-minutes': browserInstallMinutes, run: playwrightInstall }] : [], 'every browser install retries under a step limit');
    if (matrixJobs.includes(id)) {
      assert.equal(job.strategy['fail-fast'], false);
      assert.deepEqual(job.strategy.matrix, { os: ['ubuntu-latest'] });
    } else {
      assert.equal(job.strategy, undefined, `${id} has no matrix`);
    }
    assert.equal(job.if, conditions[id], `${id}: only the selection skips a job`);
    assert.equal(job.concurrency, undefined, 'jobs must not cancel each other');
    const linuxSteps = job.steps.filter(step => step.name === 'Check isolated Linux hook qualification');
    assert.deepEqual(linuxSteps, id === 'workflow' ? [{
      name: 'Check isolated Linux hook qualification',
      if: "runner.os == 'Linux'",
      'timeout-minutes': hookAptMinutes,
      run: `${aptRetry(180, `bash -c '${hookAptScript}'`)}\nsudo apparmor_parser -r /usr/share/apparmor/extra-profiles/bwrap-userns-restrict\nbwrap --unshare-all --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 /usr/bin/true\nnpm run test:performance:linux\nnpm run test:performance:standalone\n`,
    }] : []);
    // Hub #494: no job may provide or require a systemd user manager. App verification hides the runner's manager
    // until app-verify works under its systemd 255 (#873), so lifecycle tests skip as they did on Depot.
    assert.deepEqual(job.env, ['app-verify', 'runtime-verify'].includes(id) ? { XDG_RUNTIME_DIR: '', DBUS_SESSION_BUS_ADDRESS: '' } : undefined);
    assert.equal(job.steps.some(step => /loginctl|APP_VERIFY_REQUIRE_SYSTEMD/.test(step.run ?? '')), false);
    const originalSteps = job.steps.filter(step => !linuxSteps.includes(step));
    assert.deepEqual(originalSteps.filter(step => step.run).map(step => step.run), runs);
    // Steps are skipped only by the selection (Hub #1080); none may fail without failing its job.
    assert(originalSteps.every(step => !step['continue-on-error']));
    assert(originalSteps.every(step => step.if === undefined || (['core', 'app-verify'].includes(id)
      && /^contains\(fromJSON\(needs\.select\.outputs\.groups\), '[a-z-]+'\)$/.test(step.if))), id);
  }
  assert.equal(builds, 4);
  // Hub #827: the old system's checks and the full dashboard browser suite leave CI but keep their scripts, which run
  // locally until #839 deletes that code. CI runs the dashboard's smoke check instead. The runtime's dashboard (#922)
  // keeps its full browser suite local too.
  const { scripts } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const name of ['test:hub:built', 'test:hub:package:built', 'test:hub:verify:built', 'test:agent-status:built', 'test:lifx:built',
    'test:tidbyt:built', 'test:tidbyt:python', 'test:local-controllers:built', 'test:contracts:python', 'test:package:built',
    'test:performance', 'test:dashboard:browser', 'test:runtime-dashboard:browser']) {
    assert.ok(scripts[name], `${name} stays available for local runs`);
    assert.equal(runs.includes(`npm run ${name}`), false, `${name} runs locally, not in CI`);
  }
  assert.equal(scripts['test:dashboard:smoke'], 'node apps/dashboard/tests/smoke.mjs');
  // Hub #922: the runtime's dashboard follows the same pattern, a smoke check in CI and its full browser suite locally.
  assert.equal(scripts['test:runtime-dashboard:smoke'], 'node apps/runtime/dashboard/tests/smoke.ts');
});

// Hub #861: product suites remain unselected for Markdown-only PRs, so Workflow guards their copied Markdown files.
const packagedMarkdown = [
  'apps/bb8-windows/README.md', 'apps/bb8-windows/THIRD-PARTY-NOTICES.md', 'modules/bb8/README.md',
  'apps/hub/README.md', 'apps/hub/SETUP.md', 'apps/maintenance/README.md', 'apps/wispr-collector/README.md',
  'docs/agent-lifecycle-contract.md', 'docs/app-verification.md', 'docs/controller-contract.md',
  'docs/decisions/0009-app-verification-runs.md', 'docs/install-contract.md', 'docs/observability-contract.md',
  'docs/provider-qualification.md', 'packages/agent-state/README.md', 'packages/app-verify/README.md',
  'packages/app-verify/OPERATIONS.md', 'packages/app-verify/TESTING.md',
  'packages/mcp/README.md', 'packages/observability/README.md', 'packages/wispr-contracts/README.md',
];
const packagedNames = new Set(['OPERATIONS.md', 'TESTING.md', 'README.md', 'SETUP.md', 'CONTRACT.md', 'install-contract.md', 'provider-qualification.md',
  'app-verification.md', 'adr-0009-app-verification-runs.md', 'THIRD-PARTY-NOTICES.md']);

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
  // Pixoo's moved tests keep their Vitest runner and run from the module's compiled tests (Hub #25, #843); its module
  // tests run with node:test from the same build.
  'test:pixoo': 'cd modules/pixoo && vitest run --config vitest.config.mjs && node --test dist/tests/module/*.test.js',
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

test('retained documents keep static checks, browser checks and review artifacts', () => {
  const workflow = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/workflow.yml'), 'utf8'));
  const job = workflow.jobs.documents;
  assert.equal(job.name, 'Retained documentation checks');
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(job['timeout-minutes'], 25);
  const commands = job.steps.map(step => step.run ?? '').join('\n');
  for (const command of ['python3 docs/diagrams/check.py', 'python3 docs/diagrams/test_independence.py',
    'python3 docs/system-design/build.py --check', 'python3 docs/system-design/check.py',
    'python3 docs/skins/test_places.py', 'python3 docs/skins/check_tokens.py',
    'python3 apps/maintenance/tests/test_recommendations.py',
    'node docs/system-design/check.cjs', 'node docs/skins/check_places.cjs']) assert.ok(commands.includes(command), command);
  assert.ok(commands.includes('playwright@1.63.0'));
  assert.ok(commands.includes('bash scripts/apt-retry.sh 300'));
  assert.ok(!commands.includes('docs/work-guide/'));
  const upload = job.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(upload.with.name, 'retained-documents-review');
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.equal(upload.with['retention-days'], 14);
  for (const folder of ['bunny-places-review', 'bunny-design-review']) assert.ok(upload.with.path.includes(folder));
});

test('documentation drift has full local history and read-only summary reporting', () => {
  const workflow = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/workflow.yml'), 'utf8'));
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const steps = workflow.jobs.documents.steps;
  assert.equal(steps.find(step => step.uses?.startsWith('actions/checkout@')).with['fetch-depth'], 0);
  assert.ok(steps.some(step => step.run === 'python3 -m unittest discover -s docs -p test_docs_drift.py'));
  const report = steps.find(step => step.name === 'Report source pins and validate documented commands and paths');
  assert.ok(report.run.includes('python3 docs/check_docs_drift.py --report'));
  assert.ok(report.run.includes('>> "$GITHUB_STEP_SUMMARY"'));
  assert.ok(report.run.includes('exit "$result"'));
  assert.equal(report['continue-on-error'], undefined);
  assert.ok(steps.find(step => step.uses?.startsWith('actions/upload-artifact@')).with.path.includes('/docs-drift.md'));
});

// Each runtime module registers itself from its own folder, so the files every module story would otherwise edit name
// no device module (Hub #999). The core and the fixture modules live outside `modules/`, so their names are not module
// names. The negative control reintroduces one module's name, in each spelling, into a copy of a shared file.
const moduleNamesCheck = require('../scripts/check-module-names.cjs');

test('shared module names stay within the approved fixture exception, and other references fail', (t) => {
  assert.deepEqual(moduleNamesCheck.findModuleNames(root), []);
  const modules = moduleNamesCheck.moduleNames(root);
  assert.ok(modules.length > 0, 'the checkout has module folders');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-hub-module-names-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  for (const file of moduleNamesCheck.SHARED_FILES) {
    fs.mkdirSync(path.dirname(path.join(scratch, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(scratch, file));
  }
  for (const name of modules) {
    fs.mkdirSync(path.join(scratch, 'modules', name), { recursive: true });
    fs.writeFileSync(path.join(scratch, 'modules', name, 'package.json'), '{}\n');
  }
  assert.deepEqual(moduleNamesCheck.findModuleNames(scratch), [], 'the copy has no unapproved module reference');
  const [file] = moduleNamesCheck.SHARED_FILES;
  const original = fs.readFileSync(path.join(scratch, file), 'utf8');
  const lines = original.split('\n').length;
  // A hyphenated folder name is also written with a space or with nothing between its words.
  const hyphenated = 'desk-probe';
  fs.mkdirSync(path.join(scratch, 'modules', hyphenated), { recursive: true });
  fs.writeFileSync(path.join(scratch, 'modules', hyphenated, 'package.json'), '{}\n');
  const cases = [
    [modules[0], modules[0]], [modules[0], modules[0].toUpperCase()], [modules[0], `@jimmie-potts/${modules[0]}`],
    [hyphenated, 'desk-probe'], [hyphenated, 'Desk Probe'], [hyphenated, 'deskProbe'],
  ];
  for (const [name, spelling] of cases) {
    fs.writeFileSync(path.join(scratch, file), `${original}\n// ${spelling}\n`);
    assert.deepEqual(moduleNamesCheck.findModuleNames(scratch), [{ file, line: lines + 1, name }], spelling);
  }
  // #927 is an explicit four-file fixture exception, not permission for another module or production registration.
  fs.writeFileSync(path.join(scratch, file), original);
  for (const shared of moduleNamesCheck.SHARED_FILES) {
    const saved = fs.readFileSync(path.join(scratch, shared), 'utf8');
    const line = saved.split('\n').length + 1;
    fs.writeFileSync(path.join(scratch, shared), `${saved}\n// wispr\n`);
    assert.deepEqual(moduleNamesCheck.findModuleNames(scratch), moduleNamesCheck.FIXTURE_REFERENCES[shared]?.includes('wispr')
      ? [] : [{file: shared, line, name: 'wispr'}], shared);
    fs.writeFileSync(path.join(scratch, shared), `${saved}\n// desk-probe\n`);
    assert.deepEqual(moduleNamesCheck.findModuleNames(scratch), [{file: shared, line, name: 'desk-probe'}], shared);
    fs.writeFileSync(path.join(scratch, shared), saved);
  }
  const plugin = 'apps/runtime/verify/plugin.ts';
  const pluginSource = fs.readFileSync(path.join(scratch, plugin), 'utf8');
  const pluginLine = pluginSource.split('\n').length + 1;
  for (const text of ["'packages/wispr-contracts/dist'; // wispr", "'modules/wispr/dist/src'", "'packages/wispr-contracts/unapproved'"]) {
    fs.writeFileSync(path.join(scratch, plugin), `${pluginSource}\n${text}\n`);
    assert.deepEqual(moduleNamesCheck.findModuleNames(scratch), [{file: plugin, line: pluginLine, name: 'wispr'}], text);
  }
  fs.writeFileSync(path.join(scratch, plugin), pluginSource);
  fs.writeFileSync(path.join(scratch, file), `${original}\n'packages/wispr-contracts/dist'\n`);
  assert.deepEqual(moduleNamesCheck.findModuleNames(scratch), [{file, line: lines + 1, name: 'wispr'}], 'contract-path exception stays in build identity');
  // The core and a fixture module are not device modules, and a longer word that holds a name is not the name.
  fs.writeFileSync(path.join(scratch, file), `${original}\n// core lamp chime sign ${modules[0]}s x${modules[0]}\n`);
  assert.deepEqual(moduleNamesCheck.findModuleNames(scratch), []);
});

test('runtime storage consumers delegate full-disk classification to the SDK', () => {
  const consumers = ['apps/runtime/src', 'modules'].flatMap(directory =>
    fs.readdirSync(path.join(root, directory), {recursive: true}).map(String)
      .filter(file => file.endsWith('.ts') && (directory === 'apps/runtime/src' || file.includes(`${path.sep}src${path.sep}`)))
      .map(file => path.join(directory, file)));
  assert.ok(consumers.length > 0, 'runtime and module sources were inventoried');
  assert.equal(hasLocalFullDiskCheck('if (errcode(error) === SQLITE_FULL) return true;'), true, 'negative control detects a local SQLITE_FULL check');
  assert.equal(hasLocalFullDiskCheck("return code === SQLITE_FULL ? 'capacity' : 'internal';"), true, 'negative control detects a local full-disk comparison after code extraction');
  assert.equal(hasLocalFullDiskCheck('const code = error.errcode & 0xff;'), false, 'low-byte normalization alone is not a full-disk check');
  assert.equal(hasLocalFullDiskCheck('if (fullDisk(error)) return true;'), false, 'SDK helper use is allowed');
  for (const file of consumers) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal(hasLocalFullDiskCheck(source), false, `${file} must use the SDK helper`);
  }
});

test('a suppression key for a missing file fails and names that path', (t) => {
  const directory = fixture(t);
  fs.mkdirSync(path.join(directory, 'src'));
  fs.writeFileSync(path.join(directory, 'src', 'kept.ts'), '');
  fs.writeFileSync(path.join(directory, 'eslint-suppressions.json'), JSON.stringify({
    'src/kept.ts': { 'no-console': { count: 1 } },
    'src/renamed.ts': { 'no-console': { count: 1 } },
  }));
  const result = run(check, directory);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /stale key for missing file src\/renamed\.ts/);
  assert.doesNotMatch(result.stderr, /src\/kept\.ts/);
});

test('a stale suppression check stopped by a signal fails and says so', (t) => {
  const directory = fixture(t);
  const scripts = path.join(directory, 'scripts');
  fs.mkdirSync(scripts);
  fs.copyFileSync(check, path.join(scripts, 'check-workflow.cjs'));
  fs.writeFileSync(path.join(scripts, 'openspec.cjs'), '');
  fs.writeFileSync(path.join(scripts, 'check-stale-suppressions.cjs'), "process.kill(process.pid, 'SIGKILL');\n");
  const result = run(path.join(scripts, 'check-workflow.cjs'), directory);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Stale suppression check stopped by SIGKILL/);
});
