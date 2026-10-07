// Delivery preflight: deterministic GitHub and receipt fixtures. The clean
// candidate must pass; every other scenario is a negative control that must stay
// unresolved (or a read failure) for the reason it names.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { MAX_PAGES, QUERIES, createReadOnlyClient, fetchTransport, ReadOnlyViolation, assertQueryOnly } from '../scripts/delivery-preflight/github.mjs';
import { main } from '../scripts/delivery-preflight/cli.mjs';
import { runPreflight } from '../scripts/delivery-preflight/preflight.mjs';
import { renderText } from '../scripts/delivery-preflight/report.mjs';
import { parseReport, statedVerdict } from '../scripts/delivery-preflight/reviews.mjs';
import { expectedJobs, filterPattern, parseWorkflow } from '../scripts/delivery-preflight/workflows.mjs';
import {
  ACTIONS, BASE, DEPOT, EXPECTED_JOBS, GUIDE_HTML, HEAD, ISSUE, MERGE, NEWER_MAIN, OLD_HEAD, OWNER, POLICY, PR, REPO, WORKFLOW_FILES,
  checkRun, cleanWorld, comment, declaration, fakeTransport, guideRecordBody, job, mergeWorld, reviewReport, sha256, suite,
  writeGuideEvidence, writeProof,
} from './delivery-preflight/world.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'scripts', 'delivery-preflight.mjs');
const READ_AT = new Date('2026-09-27T08:00:00Z');

async function preflight(world, overrides = {}) {
  return runPreflight({
    github: createReadOnlyClient(fakeTransport(world)),
    declaration: declaration(overrides),
    now: () => READ_AT,
  });
}

const gate = (report, id) => {
  const found = report.gates.find(item => item.id === id);
  assert.ok(found, `missing gate ${id}`);
  return found;
};

function assertUnresolved(report, id, pattern) {
  const found = gate(report, id);
  assert.equal(found.status, 'unresolved', `${id}: ${JSON.stringify(found.reasons)}`);
  assert.ok(found.reasons.some(reason => pattern.test(reason)), `${id} reasons ${JSON.stringify(found.reasons)} do not match ${pattern}`);
  assert.equal(report.result, 'unresolved');
  assert.equal(report.exitCode, 1);
}

function scratch(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-preflight-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// ---- The clean candidate ----

test('a fully evidenced source candidate reports every applicable gate satisfied', async () => {
  const report = await preflight(cleanWorld());
  assert.equal(report.result, 'satisfied', JSON.stringify(report.gates.filter(g => g.status !== 'satisfied' && g.status !== 'not-applicable'), null, 2));
  assert.equal(report.exitCode, 0);
  assert.deepEqual(report.candidate, {
    repository: REPO, pr: PR, url: `https://github.com/${REPO}/pull/${PR}`, state: 'open', draft: false,
    head: HEAD, headRef: 'claude/gh-700-example', base: BASE, baseRef: 'main', mergeBase: BASE, mergeCommit: null,
  });
  const ci = gate(report, 'ci-pr');
  assert.equal(ci.status, 'satisfied');
  assert.deepEqual(ci.evidence.jobs.map(job => job.name).sort(), [...EXPECTED_JOBS].sort());
  assert.ok(ci.evidence.jobs.every(job => job.result === 'success' && job.checkRunId && job.detailsUrl));
  const review = gate(report, 'review');
  assert.equal(review.status, 'satisfied');
  assert.equal(review.evidence.round, 'final 1');
  assert.match(review.evidence.report, /#issuecomment-\d+$/);
  assert.deepEqual(review.evidence.returns.map(r => [r.label, r.axis, r.return]), [
    ['standards-reviewer-1', 'standards', 'complete'], ['specification-reviewer-1', 'specification', 'complete'],
  ]);
  assert.ok(review.evidence.returns.every(r => /^sha256:[0-9a-f]{64}$/.test(r.digest) && r.digestVerified));
  assert.equal(gate(report, 'ui-approval').status, 'not-applicable');
  assert.equal(gate(report, 'proof').status, 'not-applicable');
  assert.equal(gate(report, 'counterparts').status, 'satisfied');
  assert.equal(gate(report, 'live-acceptance').status, 'not-applicable');
  assert.equal(gate(report, 'ci-main').status, 'not-applicable');
  assert.equal(report.formats.reviewReports, 'jimmie-potts/agent-skills@3c418136f641caed4f785b0552fab05ae29b37de');
  assert.equal(report.formats.receipt, 'app-verification/1');
  assert.equal(report.readAt, READ_AT.toISOString());
  assert.match(report.notice, /not authorization/);
  assert.match(report.notice, new RegExp(HEAD));
});

test('the real GitHub Actions configuration enumerates the five expected jobs and filters guide-only and Markdown-only changes', () => {
  assert.deepEqual(Object.keys(WORKFLOW_FILES).sort(), ['checks.yml', 'guide.yml', 'workflow.yml']);
  assert.equal(fs.existsSync(path.join(root, DEPOT.directory)), false, 'Depot workflows are retired (#870)');
  const workflows = Object.entries(WORKFLOW_FILES).map(([file, text]) => parseWorkflow(file, text));
  const source = expectedJobs(workflows, { event: 'pull_request', branch: 'main', files: ['scripts/a.mjs'], filesComplete: true }, ACTIONS);
  // GitHub Actions names each check run after its job alone.
  assert.deepEqual(source.jobs.map(item => item.name).sort(), [
    'App verification on ubuntu-latest',
    'Build, lint and core tests on ubuntu-latest',
    'Firmware host tests and ARM build on ubuntu-latest',
    'Work guide build and browser checks',
    'Workflow checks on ubuntu-latest',
  ]);
  // The keys match the check names Depot reported, so coverage compares across the move.
  assert.deepEqual(source.jobs.map(item => item.key).sort(), [
    'Checks / App verification on ubuntu-latest',
    'Checks / Build, lint and core tests on ubuntu-latest',
    'Checks / Firmware host tests and ARM build on ubuntu-latest',
    'Work guide / Work guide build and browser checks',
    'Workflow / Workflow checks on ubuntu-latest',
  ]);
  assert.deepEqual(source.uncertain, []);
  const push = expectedJobs(workflows, { event: 'push', branch: 'main', files: ['docs/work-guide/a.md', 'README.md'], filesComplete: true }, ACTIONS);
  // Hub #861: a Markdown-only change skips Checks but still runs the workflow and Guide jobs.
  assert.deepEqual(push.jobs.map(item => item.name).sort(), ['Work guide build and browser checks', 'Workflow checks on ubuntu-latest']);
  const mixed = expectedJobs(workflows, { event: 'pull_request', branch: 'main', files: ['docs/sdlc.md', 'apps/hub/src/server.ts'], filesComplete: true }, ACTIONS);
  assert.equal(mixed.jobs.length, 5, 'one non-Markdown path keeps every job expected');
  const guide = expectedJobs(workflows, { event: 'pull_request', branch: 'main', files: ['docs/work-guide/outputs/agent-device-work-guides.html'], filesComplete: true }, ACTIONS);
  assert.deepEqual(guide.jobs, []);
  assert.equal(guide.filtered.length, 3);
  const incomplete = expectedJobs(workflows, { event: 'pull_request', branch: 'main', files: ['docs/work-guide/a.md'], filesComplete: false }, ACTIONS);
  assert.equal(incomplete.jobs.length, 5, 'an incomplete file list keeps every job expected');
  const branchPush = expectedJobs(workflows, { event: 'push', branch: 'feature', files: ['README.md'], filesComplete: true }, ACTIONS);
  assert.deepEqual(branchPush.jobs, []);
});

test('workflow shapes the preflight cannot evaluate are reported, not guessed', () => {
  const unnamed = parseWorkflow('x.yml', 'on: pull_request\njobs:\n  a:\n    runs-on: x\n    steps: [{run: "true"}]\n');
  assert.match(expectedJobs([unnamed], { event: 'pull_request', branch: 'main', files: ['a'], filesComplete: true }, ACTIONS).uncertain.join(), /no name/);
  const dynamic = parseWorkflow('y.yml', 'name: Y\non: pull_request\njobs:\n  a:\n    name: A ${{ github.ref }}\n    runs-on: x\n    steps: [{run: "true"}]\n');
  assert.match(expectedJobs([dynamic], { event: 'pull_request', branch: 'main', files: ['a'], filesComplete: true }, ACTIONS).uncertain.join(), /cannot expand/);
  const include = parseWorkflow('z.yml', 'name: Z\non: pull_request\njobs:\n  a:\n    strategy:\n      matrix:\n        os: [a]\n        include: [{os: b}]\n    runs-on: x\n    steps: [{run: "true"}]\n');
  assert.match(expectedJobs([include], { event: 'pull_request', branch: 'main', files: ['a'], filesComplete: true }, ACTIONS).uncertain.join(), /include/);
  const plain = parseWorkflow('p.yml', 'name: P\non: [push, pull_request]\njobs:\n  test:\n    strategy:\n      matrix:\n        os: [a, b]\n        exclude: [{os: b}]\n    runs-on: x\n    steps: [{run: "true"}]\n');
  assert.deepEqual(expectedJobs([plain], { event: 'pull_request', branch: 'main', files: ['a'], filesComplete: true }, ACTIONS).jobs.map(j => j.name), ['test (a)']);
  assert.deepEqual(expectedJobs([plain], { event: 'pull_request', branch: 'main', files: ['a'], filesComplete: true }, DEPOT).jobs.map(j => j.name), ['P / test (a)']);
  // GitHub Actions appends matrix values to a name that has none; that form is not evaluated.
  const suffixed = parseWorkflow('s.yml', 'name: S\non: pull_request\njobs:\n  a:\n    name: Tests\n    strategy:\n      matrix:\n        os: [a]\n    runs-on: x\n    steps: [{run: "true"}]\n');
  assert.match(expectedJobs([suffixed], { event: 'pull_request', branch: 'main', files: ['a'], filesComplete: true }, ACTIONS).uncertain.join(), /no matrix value/);
  // Job names alone cannot tell two workflows' jobs apart.
  const twin = name => parseWorkflow(`${name}.yml`, `name: ${name}\non: pull_request\njobs:\n  a:\n    name: Tests\n    runs-on: x\n    steps: [{run: "true"}]\n`);
  assert.match(expectedJobs([twin('One'), twin('Two')], { event: 'pull_request', branch: 'main', files: ['a'], filesComplete: true }, ACTIONS).uncertain.join(), /"Tests" belongs to 2 jobs/);
  assert.deepEqual(expectedJobs([twin('One'), twin('Two')], { event: 'pull_request', branch: 'main', files: ['a'], filesComplete: true }, DEPOT).uncertain, []);
});

// ---- CI evidence ----

const ciCases = [
  ['a missing expected job', world => { world.checkRuns[HEAD] = world.checkRuns[HEAD].filter(run => run.name !== job(/Firmware/)); }, /Firmware host tests and ARM build on ubuntu-latest: missing/],
  ['a pending job', world => { Object.assign(world.checkRuns[HEAD][0], { status: 'in_progress', conclusion: null }); }, /pending/],
  ['a failed job', world => { world.checkRuns[HEAD][1].conclusion = 'failure'; }, /failure/],
  ['a skipped job', world => { world.checkRuns[HEAD][2].conclusion = 'skipped'; }, /skipped/],
  ['a cancelled job', world => { world.checkRuns[HEAD][2].conclusion = 'cancelled'; }, /cancelled/],
  ['a job from another app', world => { world.checkRuns[HEAD][4].app = { slug: DEPOT.app }; }, /missing/],
  ['a job for another revision', world => { world.checkRuns[HEAD][4].head_sha = OLD_HEAD; }, /missing/],
  ['a job from the push event instead of the PR', world => {
    world.checkRuns[HEAD].at(-1).check_suite = { id: 9100 };
    world.checkSuites[HEAD].push(suite(9100, HEAD, 'main'));
  }, /missing/],
  ['a job from another repository', world => {
    world.checkRuns[HEAD].at(-1).check_suite = { id: 9101 };
    world.checkSuites[HEAD].push(suite(9101, HEAD, 'claude/gh-700-example', { repository: { full_name: `${OWNER}/fork` } }));
  }, /missing/],
  ['a successful job with a failure annotation', world => {
    const run = world.checkRuns[HEAD][0];
    run.output.annotations_count = 1;
    world.annotations[run.id] = [{ annotation_level: 'failure', title: 'Process completed with exit code 1' }];
  }, /failure annotation/],
];

for (const [name, change, reason] of ciCases) {
  test(`CI: ${name} is not success`, async () => {
    const world = cleanWorld();
    change(world);
    assertUnresolved(await preflight(world), 'ci-pr', reason);
  });
}

test('CI: a successful rerun is accepted and the superseded attempt stays visible', async () => {
  const world = cleanWorld();
  const first = world.checkRuns[HEAD][0];
  first.conclusion = 'failure';
  world.checkRuns[HEAD].push(checkRun(first.name, HEAD, first.check_suite.id, { started_at: '2026-09-27T07:40:00Z' }));
  const report = await preflight(world);
  const ci = gate(report, 'ci-pr');
  assert.equal(ci.status, 'satisfied');
  const job = ci.evidence.jobs.find(item => item.name === first.name);
  assert.deepEqual(job.superseded, [{ checkRunId: first.id, result: 'failure' }]);
});

test('CI: a superseded attempt that is still running keeps the job unresolved', async () => {
  const world = cleanWorld();
  const latest = world.checkRuns[HEAD][0];
  world.checkRuns[HEAD].push(checkRun(latest.name, HEAD, latest.check_suite.id, { status: 'in_progress', conclusion: null, started_at: '2026-09-27T06:50:00Z' }));
  assertUnresolved(await preflight(world), 'ci-pr', /an earlier attempt is still running/);
});

test('CI: a branch rule requiring a check adds it to the expected set', async () => {
  const world = cleanWorld();
  world.branchRules = [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'Security scan' }] } }];
  assertUnresolved(await preflight(world), 'ci-pr', /Security scan: missing/);
});

const withoutFirmware = text => text.replace(/\n {2}firmware:\n[\s\S]*?(?=\n {2}app-verify:)/, '');

test('CI: a candidate that edits its workflows cannot drop an expected job unnoticed', async () => {
  const world = cleanWorld();
  world.workflows[BASE] = { [ACTIONS.directory]: { ...WORKFLOW_FILES } };
  world.workflows[HEAD] = { [ACTIONS.directory]: { ...WORKFLOW_FILES, 'checks.yml': withoutFirmware(WORKFLOW_FILES['checks.yml']) } };
  world.files.push({ filename: '.github/workflows/checks.yml', status: 'modified' });
  world.checkRuns[HEAD] = world.checkRuns[HEAD].filter(run => run.name !== job(/Firmware/));
  assertUnresolved(await preflight(world), 'ci-pr', /Checks \/ Firmware host tests and ARM build on ubuntu-latest: expected at [0-9a-f]{12} but dropped/);

  const added = cleanWorld();
  added.workflows[BASE] = { [ACTIONS.directory]: { ...WORKFLOW_FILES } };
  const checks = WORKFLOW_FILES['workflow.yml'];
  assert.ok(checks.includes('      - run: npm run test:workflow\n'));
  added.workflows[HEAD] = { [ACTIONS.directory]: { ...WORKFLOW_FILES, 'workflow.yml': checks.replace('      - run: npm run test:workflow\n', '      - run: npm run test:workflow\n      - run: npm run test:preflight\n') } };
  added.files.push({ filename: '.github/workflows/workflow.yml', status: 'modified' });
  const report = await preflight(added);
  assert.equal(gate(report, 'ci-pr').status, 'satisfied');
  assert.match(gate(report, 'ci-pr').reasons.join(), /no job expected at [0-9a-f]{12} is dropped/);
});

// Hub #870: Depot-era revisions keep Depot's workflows and check names; the move compares coverage by job key.
const depotEra = { 'ci.yml': WORKFLOW_FILES['checks.yml'], 'work-guide.yml': WORKFLOW_FILES['guide.yml'], 'workflow.yml': WORKFLOW_FILES['workflow.yml'] };
const moveWorld = () => {
  const world = cleanWorld();
  // A Depot-era base also holds disabled copies under .github/workflows; Depot's directory decides.
  world.workflows[BASE] = { [DEPOT.directory]: { ...depotEra }, [ACTIONS.directory]: { 'ci.yml': 'name: Stale\non: pull_request\njobs: {}\n' } };
  world.files.push(
    ...Object.keys(depotEra).map(file => ({ filename: `${DEPOT.directory}/${file}`, status: 'removed' })),
    ...Object.keys(WORKFLOW_FILES).map(file => ({ filename: `${ACTIONS.directory}/${file}`, status: 'added' })),
  );
  return world;
};

test('CI: moving from Depot to GitHub Actions keeps every job and is gated on GitHub Actions runs', async () => {
  const report = await preflight(moveWorld());
  const ci = gate(report, 'ci-pr');
  assert.equal(ci.status, 'satisfied', ci.reasons.join('; '));
  assert.equal(ci.evidence.provider, 'github-actions');
  assert.match(ci.reasons.join(), /moves CI from Depot CI to GitHub Actions; no job expected at [0-9a-f]{12} is dropped/);

  const dropped = moveWorld();
  dropped.workflows[HEAD][ACTIONS.directory]['checks.yml'] = withoutFirmware(WORKFLOW_FILES['checks.yml']);
  dropped.checkRuns[HEAD] = dropped.checkRuns[HEAD].filter(run => run.name !== job(/Firmware/));
  assertUnresolved(await preflight(dropped), 'ci-pr', /Checks \/ Firmware host tests and ARM build on ubuntu-latest: expected at [0-9a-f]{12} but dropped/);

  // Depot runs on a GitHub Actions revision count for nothing, and the report says they exist.
  const duplicated = moveWorld();
  duplicated.checkRuns[HEAD].push(...EXPECTED_JOBS.map(name => checkRun(name, HEAD, 9300, { app: { slug: DEPOT.app } })));
  const noted = gate(await preflight(duplicated), 'ci-pr');
  assert.equal(noted.status, 'satisfied', noted.reasons.join('; '));
  assert.match(noted.reasons.join(), /5 Depot CI check runs also exist/);
});

test('CI: a Depot-era revision expects Depot check runs under "<workflow> / <job>" names', async () => {
  const world = cleanWorld();
  world.workflows[HEAD] = { [DEPOT.directory]: { ...depotEra }, [ACTIONS.directory]: { 'ci.yml': 'name: Stale\non: pull_request\njobs: {}\n' } };
  world.checkSuites[HEAD] = [suite(9400, HEAD, 'claude/gh-700-example', { app: { slug: DEPOT.app } })];
  const depotNames = EXPECTED_JOBS.map(name => (name.startsWith('Workflow checks') ? `Workflow / ${name}` : name.startsWith('Work guide') ? `Work guide / ${name}` : `Checks / ${name}`));
  world.checkRuns[HEAD] = depotNames.map(name => checkRun(name, HEAD, 9400, { app: { slug: DEPOT.app } }));
  const ci = gate(await preflight(world), 'ci-pr');
  assert.equal(ci.status, 'satisfied', ci.reasons.join('; '));
  assert.equal(ci.evidence.provider, 'depot');
  assert.deepEqual([...ci.evidence.expected].sort(), [...depotNames].sort());
  world.checkRuns[HEAD] = EXPECTED_JOBS.map(name => checkRun(name, HEAD, 9400));
  assertUnresolved(await preflight(world), 'ci-pr', /Checks \/ Build, lint and core tests on ubuntu-latest: missing/);
});

test('CI: a failed workflow read is a read failure, never a fall-through to the next provider', async () => {
  const world = cleanWorld();
  world.workflows[HEAD] = { [DEPOT.directory]: { ...depotEra }, [ACTIONS.directory]: { ...WORKFLOW_FILES } };
  world.failures.push({ match: /contents\/\.depot\/workflows\?/, status: 502 });
  const ci = gate(await preflight(world), 'ci-pr');
  assert.equal(ci.status, 'read-failure', ci.reasons.join('; '));
});

test('CI: a revision without any workflow directory is unresolved', async () => {
  const world = cleanWorld();
  world.workflows[HEAD] = {};
  assertUnresolved(await preflight(world), 'ci-pr', /has no workflow in \.depot\/workflows or \.github\/workflows/);
});

test('CI: filters that skip non-guide paths leave the change without CI, never under the guide exception', async t => {
  const world = cleanWorld();
  const files = world.workflows[HEAD][ACTIONS.directory];
  for (const file of Object.keys(files)) files[file] = files[file].replaceAll(/paths-ignore: \[[^\]]*\]/g, "paths-ignore: ['docs/**']");
  world.files = [{ filename: 'docs/sdlc.md', status: 'modified' }];
  world.compares[`${BASE}...${HEAD}`].files = world.files;
  world.checkRuns[HEAD] = [];
  const receipt = writeGuideEvidence(scratch(t));
  const record = comment(`Guide evidence for ${HEAD}, HTML sha256 ${sha256(GUIDE_HTML)}.`);
  world.comments.push(record);
  assertUnresolved(await preflight(world, { guideReceipts: [receipt], guideRecords: [record.html_url] }), 'ci-pr', /no configured job applies and no exception covers this change/);
});

test('CI: a Markdown-only change needs only the workflow and Guide jobs (Hub #861)', async () => {
  const world = cleanWorld();
  world.files = [{ filename: 'docs/development.md', status: 'modified' }, { filename: 'README.md', status: 'modified' }];
  world.compares[`${BASE}...${HEAD}`].files = world.files;
  world.checkRuns[HEAD] = world.checkRuns[HEAD].filter(run => /^(Workflow checks|Work guide build) /.test(run.name));
  assert.equal(world.checkRuns[HEAD].length, 2);
  const ci = gate(await preflight(world), 'ci-pr');
  assert.equal(ci.status, 'satisfied', ci.reasons.join('; '));
  world.files.push({ filename: 'apps/hub/src/server.ts', status: 'modified' });
  assertUnresolved(await preflight(world), 'ci-pr', /Build, lint and core tests on ubuntu-latest: missing/);
});

// ---- Identity ----

test('a changed head is unresolved and the live head is what the report describes', async () => {
  const report = await preflight(cleanWorld(), { head: OLD_HEAD });
  assertUnresolved(report, 'identity', /head changed: declared [0-9a-f]{12}, live [0-9a-f]{12}/);
  assert.equal(report.candidate.head, HEAD);
});

test('a changed base is unresolved and makes the retained review stale', async () => {
  const world = cleanWorld();
  world.refs.main = NEWER_MAIN;
  world.compares[`${NEWER_MAIN}...${HEAD}`] = { status: 'diverged', merge_base_commit: { sha: BASE }, files: world.files };
  world.compares[`${POLICY}...${NEWER_MAIN}`] = { status: 'ahead', merge_base_commit: { sha: POLICY }, files: [{ filename: 'README.md', status: 'modified' }] };
  const report = await preflight(world, { base: BASE });
  assertUnresolved(report, 'identity', /base changed: declared [0-9a-f]{12}, main is now [0-9a-f]{12}/);
  assertUnresolved(report, 'review', /stale: .*comparison/);
  const undeclared = await preflight(world);
  assert.equal(gate(undeclared, 'identity').status, 'satisfied');
  assertUnresolved(undeclared, 'review', /stale/);
  assert.match(gate(undeclared, 'review').reasons.join(), /base moved from [0-9a-f]{12} to [0-9a-f]{12}; the candidate's diff is unchanged/);
  world.compares[`${NEWER_MAIN}...${HEAD}`].files = [...world.files, { filename: 'README.md', status: 'modified', sha: 'f'.repeat(40) }];
  assert.match(gate(await preflight(world), 'review').reasons.join(), /and the candidate's diff changed/);
});

test('identity: a fork head and a non-main base are unresolved', async () => {
  const fork = cleanWorld();
  fork.pr.head.repo = { full_name: 'someone/agent-device-hub' };
  assertUnresolved(await preflight(fork), 'identity', /head comes from someone\/agent-device-hub/);
  const develop = cleanWorld();
  develop.pr.base.ref = 'develop';
  develop.refs.develop = BASE;
  assertUnresolved(await preflight(develop), 'identity', /targets develop, not main/);
});

test('identity: a missing or ambiguous work issue is unresolved, never not-applicable', async () => {
  const none = cleanWorld();
  none.pr.body = 'Adds the preflight.';
  const missing = await preflight(none);
  assertUnresolved(missing, 'identity', /no work issue: the PR body has no Refs #<issue>; declare --issue/);
  assertUnresolved(missing, 'counterparts', /blockers were not read: no single work issue; declare --issue/);
  assertUnresolved(missing, 'review', /cannot be matched to a work issue/);

  const two = cleanWorld();
  two.pr.body = 'Refs #496\nRefs #497';
  two.issues[`${REPO}#${ISSUE}`].blockedBy[0].state = 'open';
  const ambiguous = await preflight(two);
  assertUnresolved(ambiguous, 'identity', /ambiguous: the PR body references #496, #497; declare --issue/);
  assert.notEqual(gate(ambiguous, 'counterparts').status, 'not-applicable');
  assertUnresolved(await preflight(two, { issue: ISSUE }), 'counterparts', /#493, which is open/);
  two.issues[`${REPO}#${ISSUE}`].blockedBy[0].state = 'closed';
  assert.equal((await preflight(two, { issue: ISSUE })).result, 'satisfied');
});

test('identity: the bot-opened nightly guide refresh is the only PR without a work issue', async () => {
  const world = guideOnlyWorld();
  world.pr.user = { login: 'github-actions[bot]', type: 'Bot' };
  world.pr.head.ref = 'guide/nightly-refresh';
  world.pr.body = 'Nightly guide refresh.';
  const refresh = await preflight(world);
  assert.equal(gate(refresh, 'identity').status, 'satisfied', JSON.stringify(gate(refresh, 'identity').reasons));
  assert.match(gate(refresh, 'identity').reasons.join(), /not required for the bot-opened nightly guide refresh/);
  assert.equal(gate(refresh, 'counterparts').status, 'not-applicable');
  world.pr.head.ref = 'guide/other';
  assertUnresolved(await preflight(world), 'identity', /no work issue/);
  world.pr.head.ref = 'guide/nightly-refresh';
  world.pr.user = { login: OWNER, type: 'User' };
  assertUnresolved(await preflight(world), 'identity', /no work issue/);
  world.pr.user = { login: 'github-actions[bot]', type: 'Bot' };
  world.pr.head.ref = 'guide/nightly-refresh';
  world.files.push({ filename: 'README.md', status: 'modified' });
  assertUnresolved(await preflight(world), 'identity', /no work issue/);
});

test('identity catches drafts, closed PRs, conflicts and closing keywords', async () => {
  const draft = cleanWorld();
  draft.pr.draft = true;
  assertUnresolved(await preflight(draft), 'identity', /draft/);
  const closed = cleanWorld();
  closed.pr.state = 'closed';
  assertUnresolved(await preflight(closed), 'identity', /closed without merge/);
  const dirty = cleanWorld();
  dirty.pr.mergeable_state = 'dirty';
  assertUnresolved(await preflight(dirty), 'identity', /conflict/);
  const closing = cleanWorld();
  closing.closingIssues = [ISSUE];
  assertUnresolved(await preflight(closing), 'identity', /closes #496 on merge/);
});

// ---- Independent review (agent-skills#54 retained returns) ----

const reviewCases = [
  ['a stale review of an earlier head', world => { world.comments = [comment(reviewReport({ head: OLD_HEAD }))]; }, /stale: final 1 reviewed head [0-9a-f]{12}/],
  ['a partial specification return', world => {
    world.comments = [comment(reviewReport({ returns: [
      { label: 'standards-reviewer-1', axis: 'standards' },
      { label: 'specification-reviewer-1', axis: 'specification', ret: 'partial' },
    ] }))];
  }, /specification: no complete retained return/],
  ['a failed standards return', world => {
    world.comments = [comment(reviewReport({ returns: [
      { label: 'standards-reviewer-1', axis: 'standards', ret: 'failed', text: '[no return: reviewer errored]\n' },
      { label: 'specification-reviewer-1', axis: 'specification' },
    ] }))];
  }, /standards: no complete retained return/],
  ['a retained return whose digest does not match', world => {
    world.comments = [comment(reviewReport({ returns: [
      { label: 'standards-reviewer-1', axis: 'standards', digest: `sha256:${'0'.repeat(64)}` },
      { label: 'specification-reviewer-1', axis: 'specification' },
    ] }))];
  }, /digest does not match/],
  ['a missing specification reviewer', world => {
    world.comments = [comment(reviewReport({ returns: [{ label: 'standards-reviewer-1', axis: 'standards' }] }))];
  }, /specification: no complete retained return/],
  ['a return that names another comparison', world => {
    world.comments = [comment(reviewReport({ returns: [
      { label: 'standards-reviewer-1', axis: 'standards', comparisonRow: `base ${BASE}; head ${OLD_HEAD}; merge-base ${BASE}` },
      { label: 'specification-reviewer-1', axis: 'specification' },
    ] }))];
  }, /standards: no complete retained return/],
  ['a coordinator filling an axis', world => {
    world.comments = [comment(reviewReport({ returns: [
      { label: 'coordinator-1', axis: 'standards' },
      { label: 'specification-reviewer-1', axis: 'specification' },
    ] }))];
  }, /coordinator/],
  ['an action-required axis', world => {
    world.comments = [comment(reviewReport({ standards: 'action-required', openFindings: 'P0 0; P1 0; P2 1; P3 0',
      findings: '- F1 (P2, standards, unresolved): a.mjs:1, breaks; first final 1, latest final 1' }))];
  }, /standards is action-required/],
  ['an open blocker under a satisfied summary', world => {
    world.comments = [comment(reviewReport({ openFindings: 'P0 0; P1 1; P2 0; P3 0',
      findings: '- F1 (P1, specification, unresolved): a.mjs:1, breaks; first final 1, latest final 1' }))];
  }, /open P0-P2/],
  ['a specification without a requirement', world => { world.comments = [comment(reviewReport({ requirements: 'none' }))]; }, /no authoritative requirement/],
  ['an unknown policy', world => { world.comments = [comment(reviewReport({ policy: 'unknown' }))]; }, /policy is unknown/],
  ['requirements edited after the review', world => { world.issues[`${REPO}#${ISSUE}`].lastEditedAt = '2026-09-27T07:30:00Z'; }, /requirements changed after review/],
  ['policy sources changed after the reviewed policy', world => {
    world.compares[`${POLICY}...${BASE}`].files = [{ filename: 'docs/sdlc.md', status: 'modified' }];
  }, /policy changed after review: docs\/sdlc\.md/],
  ['a policy revision that is not an ancestor of the base', world => { world.compares[`${POLICY}...${BASE}`].status = 'diverged'; }, /policy revision [0-9a-f]{12} is not an ancestor of the base/],
  ['a review for another work item', world => { world.comments = [comment(reviewReport({ work: `${REPO}#1` }))]; }, /names work/],
  ['only a coordinator summary', world => {
    world.comments = [comment('Review round 3 on the head: both axes satisfied, no P0 to P2.')];
    world.pr.body = `Refs #${ISSUE}\n\n## Independent review\n\n**Review gate:** satisfied for head ${HEAD}\n`;
  }, /no retained final review report/],
  ['a report posted by another account', world => { world.comments = [comment(reviewReport(), { user: { login: 'someone-else' } })]; }, /no retained final review report/],
];

for (const [name, change, reason] of reviewCases) {
  test(`review: ${name} is unresolved`, async () => {
    const world = cleanWorld();
    change(world);
    assertUnresolved(await preflight(world), 'review', reason);
  });
}

test('review: a bot-opened PR takes reports from the repository owner, not the bot', async () => {
  const world = cleanWorld();
  world.pr.user = { login: 'github-actions[bot]', type: 'Bot' };
  assert.equal(gate(await preflight(world), 'review').status, 'satisfied');
  world.comments = [comment(reviewReport(), { user: { login: 'github-actions[bot]', type: 'Bot' } })];
  assertUnresolved(await preflight(world), 'review', /no retained final review report/);
});

test('review: a digest mismatch is reported in the evidence, not only as a reason', async () => {
  const world = cleanWorld();
  world.comments = [comment(reviewReport({ returns: [
    { label: 'standards-reviewer-1', axis: 'standards', digest: `sha256:${'0'.repeat(64)}` },
    { label: 'specification-reviewer-1', axis: 'specification' },
  ] }))];
  const returns = gate(await preflight(world), 'review').evidence.returns;
  assert.deepEqual(returns.map(item => item.digestVerified), [false, true]);
});

test('review: the latest final round decides, and a later stale round supersedes an earlier current one', async () => {
  const world = cleanWorld();
  world.comments = [comment(reviewReport({ round: 1, head: OLD_HEAD, standards: 'action-required', openFindings: 'P0 0; P1 0; P2 1; P3 0',
    findings: '- F1 (P2, standards, unresolved): a.mjs:1, breaks; first final 1, latest final 1' })), comment(reviewReport({ round: 2 }))];
  const report = await preflight(world);
  assert.equal(gate(report, 'review').status, 'satisfied');
  assert.deepEqual(gate(report, 'review').evidence.rounds.map(r => [r.round, r.head]), [['final 1', OLD_HEAD], ['final 2', HEAD]]);
});

// Finding lines in the agent-skills@3c418136f641caed4f785b0552fab05ae29b37de
// form: one or more axes joined by `+`, and optional axis-qualified aliases.
const findingLine = (axes, state, { id = 'F1', severity = 'P2', aliases = '' } = {}) =>
  `- ${id} (${severity}, ${axes}, ${state}): a.mjs:1, breaks${aliases}; first final 1, latest final 1`;

function parsedFindings(findings) {
  const parsed = parseReport(reviewReport({ findings }));
  return { findings: parsed.findings, problems: parsed.problems };
}

test('review: a finding line keeps every listed axis in each state', () => {
  assert.deepEqual(parsedFindings(findingLine('standards', 'resolved')), {
    findings: [{ id: 'F1', severity: 'P2', axes: ['standards'], state: 'resolved', aliases: [] }], problems: [],
  });
  for (const state of ['unresolved', 'resolved', 'regression']) {
    assert.deepEqual(parsedFindings(findingLine('standards+specification', state)), {
      findings: [{ id: 'F1', severity: 'P2', axes: ['standards', 'specification'], state, aliases: [] }], problems: [],
    }, state);
  }
  for (const state of ['accepted', 'deferred']) {
    const { findings, problems } = parsedFindings(findingLine('specification+standards', state, { severity: 'P3' }));
    assert.deepEqual([findings.map(item => [item.axes, item.state]), problems], [[[['specification', 'standards'], state]], []], state);
  }
  const aliased = parsedFindings(findingLine('standards+specification', 'resolved', { id: '71-F1', aliases: '; aliases standards:S-1, specification:S-3' }));
  assert.deepEqual(aliased, {
    findings: [{ id: '71-F1', severity: 'P2', axes: ['standards', 'specification'], state: 'resolved', aliases: [
      { axis: 'standards', id: 'S-1' }, { axis: 'specification', id: 'S-3' },
    ] }], problems: [],
  });
});

test('review: malformed finding lines are unreadable', () => {
  for (const line of [
    findingLine('both', 'unresolved'),
    findingLine('standards+standards', 'unresolved'),
    findingLine('standards+', 'unresolved'),
    findingLine('+specification', 'unresolved'),
    findingLine('standards,specification', 'unresolved'),
    findingLine('standards + specification', 'unresolved'),
    findingLine('Standards', 'unresolved'),
    findingLine('standards', 'open'),
    findingLine('standards', 'unresolved', { id: 'F_1' }),
    findingLine('standards', 'unresolved', { id: 'F--1' }),
    findingLine('standards', 'unresolved', { aliases: '; aliases specification:S-1' }),
    findingLine('standards', 'unresolved', { aliases: '; aliases standards:S_1' }),
    findingLine('standards', 'unresolved', { aliases: '; aliases standards S-1' }),
    findingLine('standards', 'unresolved', { aliases: '; aliases standards:S-1,standards:S-2' }),
    findingLine('standards', 'unresolved', { aliases: '; aliases standards:S-1, standards:S-1' }),
    findingLine('standards', 'unresolved', { aliases: '; aliases ' }),
    '- F1 (P2, standards, unresolved): a.mjs:1, breaks; aliases standards:S-1',
  ]) {
    assert.deepEqual(parsedFindings(line), { findings: [], problems: ['finding line 1 is unreadable'] }, line);
  }
});

test('review: an alias may not name another finding', () => {
  const second = findingLine('standards', 'resolved', { id: 'F2', aliases: '; aliases standards:S-1' });
  assert.deepEqual(parsedFindings([findingLine('standards', 'resolved', { aliases: '; aliases standards:S-1' }), second].join('\n')).problems,
    ['finding F2 alias standards:S-1 also names F1']);
  assert.deepEqual(parsedFindings([findingLine('standards', 'resolved', { aliases: '; aliases standards:F2' }), second.replace('; aliases standards:S-1', '')].join('\n')).problems,
    ['finding F1 alias standards:F2 is the ID of F2']);
  // Another axis may reuse the same raw ID for a different condition.
  assert.deepEqual(parsedFindings([
    findingLine('standards', 'resolved', { aliases: '; aliases standards:S-1' }),
    findingLine('specification', 'resolved', { id: 'F2', aliases: '; aliases specification:S-1' }),
  ].join('\n')).problems, []);
});

test('review: a satisfied round with a resolved multi-axis finding passes', async () => {
  const world = cleanWorld();
  world.comments = [comment(reviewReport({ round: 2,
    findings: findingLine('standards+specification', 'resolved', { aliases: '; aliases standards:S-1' }).replace('first final 1, latest final 1', 'first final 1, latest final 2') }))];
  const found = gate(await preflight(world), 'review');
  assert.equal(found.status, 'satisfied', JSON.stringify(found.reasons));
});

for (const state of ['unresolved', 'regression']) {
  test(`review: an ${state} multi-axis finding is an open blocker even under a clean summary`, async () => {
    const world = cleanWorld();
    world.comments = [comment(reviewReport({ findings: findingLine('standards+specification', state) }))];
    assertUnresolved(await preflight(world), 'review', /^open P0-P2 findings: F1 \(P2\)$/);
  });
}

function splitReport(text) {
  const [marker, ...body] = text.split('\n');
  const open = body.lastIndexOf('~~~text');
  const close = body.indexOf('~~~', open + 1);
  const middle = open + 1 + Math.floor((close - open - 1) / 2);
  const part = n => marker.replace('report final 1;', `report final 1 part ${n}/2;`);
  return [[part(1), ...body.slice(0, middle), '~~~'].join('\n'), [part(2), '~~~text', ...body.slice(middle)].join('\n')];
}

test('review: a report split across comments is read whole, and a missing part leaves it unresolved', async () => {
  const world = cleanWorld();
  const [first, second] = splitReport(reviewReport());
  world.comments = [comment(first), comment(second)];
  const report = await preflight(world);
  assert.equal(gate(report, 'review').status, 'satisfied', JSON.stringify(gate(report, 'review').reasons));
  assert.ok(gate(report, 'review').evidence.returns.every(item => item.digestVerified));
  world.comments = [comment(first)];
  assertUnresolved(await preflight(world), 'review', /split into parts that are missing/);
});

test('review: each retained return must itself state a satisfied verdict', async () => {
  const withSpecification = text => {
    const world = cleanWorld();
    world.comments = [comment(reviewReport({ returns: [
      { label: 'standards-reviewer-1', axis: 'standards' },
      { label: 'specification-reviewer-1', axis: 'specification', text },
    ] }))];
    return preflight(world);
  };
  const refused = /specification: retained return specification-reviewer-1 does not itself state a satisfied verdict/;
  for (const text of [
    '## Verdict: changes requested\n\nBlocking findings:\n- P1 a.mjs:1, an empty filter exports every row.\n',
    'Coverage: the whole comparison.\n',
    'The axis is action-required: F1 remains.\n',
    'Verdict: satisfied.\n\nVerdict (after rereading): changes requested\n',
    // Round 2 probes.
    'The Specification axis is **incomplete**: the requirement could not be read. Items 1 and 3 are satisfied.\n',
    'Axis status: not-satisfied. Items 1 and 3 are satisfied.\n',
    'The axis is not yet satisfied. Blocking findings: P1 a.mjs:1, an empty filter exports every row.\n',
    'Result: action required. Items 1 and 3 are satisfied.\n',
    '> Verdict: satisfied.\n\nThe Specification axis is **action-required**: P1 a.mjs:1 remains.\n',
    'Satisfied only if S1 is fixed.\n',
    // Round 3 probes.
    'The Standards axis is satisfied per the other reviewer. Blocking: P1 a.mjs:1.\n',
    '- **Satisfied:** items 1 and 3.\n- **Not met:** item 2 (P1 below).\n',
    'Verdict: satisfied\n\nThe Specification axis is **action-required**.\n',
    // Round 4: statements never grant satisfaction, and they veto a satisfied verdict line.
    'The Specification axis is now **satisfied**. No P0-P2 remains.\n',
    'Verdict: approve\n\nThe Specification axis is "action-required" for item 2 (P1 below).\n',
    'Standards verdict: approve (per standards-reviewer-1; not my axis).\n\nBlocking: P1 a.mjs:1.\n',
    'Coordinator verdict: satisfied.\n\nBlocking: P1 a.mjs:1.\n',
  ]) {
    assertUnresolved(await withSpecification(text), 'review', refused);
  }
  for (const text of ['## Verdict: approve\n\nNo blockers.\n', '**Verdict:** satisfied.\n', 'Verdict - approved\n', 'Specification verdict: approve\n', 'Final verdict: satisfied\n']) {
    const report = await withSpecification(text);
    assert.equal(gate(report, 'review').status, 'satisfied', `${text}: ${gate(report, 'review').reasons}`);
    assert.equal(gate(report, 'review').evidence.returns[1].verdict, 'satisfied');
  }
});

test('review: only own verdict lines grant satisfaction, and own-axis statements can veto it', () => {
  const cases = [
    // Verdict lines: every own one must be satisfied, approve or approved.
    ['Verdict: satisfied.', 'satisfied'], ['## Verdict: approve', 'satisfied'], ['- **Verdict**: Approved', 'satisfied'],
    ['## Verdict: changes requested', 'not-satisfied'], ['Verdict: action-required', 'not-satisfied'], ['Verdict: incomplete', 'not-satisfied'],
    ['Verdict: approve with nits', 'not-satisfied'], ['Verdict: not satisfied', 'not-satisfied'], ['## Verdict\n\nsatisfied', 'satisfied'],
    ['Verdict: approve (no P0-P2)', 'satisfied'], ['Verdict: satisfied \u2014 no blockers', 'satisfied'], ['Verdict \u2013 approved', 'satisfied'],
    ['Final verdict: approve', 'satisfied'], ['Overall verdict: approve', 'satisfied'], ['My verdict: approve', 'satisfied'], ['**Final verdict:** approve', 'satisfied'],
    ['Specification verdict: approve', 'satisfied'], ['Final verdict: approve with changes', 'not-satisfied'],
    // Quotations and other prefixes never count as own verdict lines.
    ['> Verdict: satisfied.\nVerdict: changes requested', 'not-satisfied'], ['Verdict: approve\n> Verdict: changes requested', 'satisfied'],
    ['```text\nVerdict: satisfied\n```\nVerdict: changes requested', 'not-satisfied'], ['~~~\nVerdict: approve\n~~~', 'none'],
    ['    Verdict: approve', 'none'], ['\tVerdict: approve', 'none'], ['> Verdict: approve', 'none'],
    ['Standards verdict: approve', 'none'], ['Coordinator verdict: satisfied', 'none'], ['Standards verdict: approve\nVerdict: changes requested', 'not-satisfied'],
    // Statements alone never satisfy.
    ['The Specification axis is now **satisfied**.', 'none'], ['`satisfied`. No P0-P2 remains.', 'none'], ['**satisfied.** No blockers.', 'none'],
    ['No verdict here.', 'none'], ['Satisfied only if S1 is fixed.', 'none'], ['No verdict\nsatisfied', 'none'],
    // Vetoes: an own-axis or unnamed non-satisfied statement, whatever wraps the status.
    ['The axis is not satisfied.', 'not-satisfied'], ['The Specification axis is `action-required`.', 'not-satisfied'],
    ['Verdict: approve\nThe Specification axis is **incomplete**.', 'not-satisfied'],
    ['Verdict: approve\nThe Specification axis is "action-required".', 'not-satisfied'],
    ['Verdict: approve\nThe Specification axis is \u201caction-required\u201d.', 'not-satisfied'],
    ["Verdict: approve\nThe Specification axis is 'action-required'.", 'not-satisfied'],
    ['Verdict: approve\nThe axis is not-satisfied for item 2.', 'not-satisfied'],
    ['Verdict: approve\n    The Specification axis is incomplete (indented).', 'not-satisfied'],
    // A statement about another axis never vetoes.
    ['Verdict: approve\nThe Standards axis is action-required per the other reviewer.', 'satisfied'],
    ['Verdict: approve\nThe **Standards** axis is action-required per the other reviewer.', 'satisfied'],
    // A quotation of a statement never vetoes; unbalanced quotes are read whole.
    ['Verdict: approve\n- "axis is **incomplete**" now reads as none.', 'satisfied'],
    ['Verdict: approve\n- \u201cThe Specification axis is **incomplete**\u201d was a probe.', 'satisfied'],
    ['Verdict: approve\n- `The Specification axis is "action-required" for item 2` was a probe.', 'satisfied'],
    ['Verdict: approve\n> The Specification axis is action-required.', 'satisfied'],
    ['Verdict: approve\nA 6" frame test and the Specification axis is action-required; see "UI approved".', 'not-satisfied'],
    ['Verdict: approve\ntyped \u201cok" and the Specification axis is action-required, see "x".', 'not-satisfied'],
    ['Verdict: approve\nend of quote" and the Specification axis is action-required, see "x".', 'not-satisfied'],
    ['Verdict: approve\n\u201cquoted\u201d \u201copen and the Specification axis is incomplete', 'not-satisfied'],
    ['Verdict: approve\n\u201copen and the Specification axis is incomplete, see \u201d then \u201d', 'not-satisfied'],
    ['Verdict: approve\nstray ` tick and the Specification axis is incomplete, see `x`.', 'not-satisfied'],
  ];
  for (const [text, expected] of cases) assert.equal(statedVerdict(`${text}\n`, 'specification'), expected, text);
  // Round 5: a verdict line in inline code is an example, and code spans pair as CommonMark does.
  assert.equal(statedVerdict('- `Verdict: satisfied.` is the contract example.\n', 'specification'), 'none');
  assert.equal(statedVerdict('- `Standards verdict: approve`\n**Changes requested.**\n', 'standards'), 'none');
  assert.equal(statedVerdict('Verdict: approve\nA lone `"` and the Standards axis is action-required; also `"`.\n', 'standards'), 'not-satisfied');
  assert.equal(statedVerdict('Verdict: approve\n- Case: ``The Standards axis is "action-required".`` next to x\n', 'standards'), 'satisfied');
  assert.equal(statedVerdict('Verdict: approve\n- Case: ``The Standards axis is `action-required`.`` next to x\n', 'standards'), 'satisfied');
  assert.equal(statedVerdict('Verdict: approve\nA ``` run and the Standards axis is incomplete, see `x`.\n', 'standards'), 'not-satisfied');
  assert.equal(statedVerdict('Verdict: approve\n- Probe: ``x` and the Standards axis is incomplete `y`` quoted.\n', 'standards'), 'satisfied');
  assert.equal(statedVerdict('Standards verdict: approve\n', 'standards'), 'satisfied');
  assert.equal(statedVerdict('Specification verdict: approve\n', 'standards'), 'none');
  assert.equal(statedVerdict('Verdict: approve\nThe Specification axis is action-required.\n', 'standards'), 'satisfied');
});

test('feedback: unresolved threads and outstanding change requests stay visible', async () => {
  const world = cleanWorld();
  world.threads = [{ isResolved: false, isOutdated: false, path: 'a.mjs', comments: { nodes: [{ url: 'https://github.com/x/1', author: { login: 'reviewer' } }] } }];
  assertUnresolved(await preflight(world), 'feedback', /1 unresolved review thread/);
  const requested = cleanWorld();
  requested.reviews = [{ id: 5, user: { login: 'reviewer' }, state: 'CHANGES_REQUESTED', commit_id: HEAD, html_url: 'https://github.com/x/r5' }];
  assertUnresolved(await preflight(requested), 'feedback', /changes requested by reviewer/);
});

test('feedback: the Codex security summary is reported with the head it covered', async () => {
  const world = cleanWorld();
  const marker = `<!-- codex-security-review:v1 {"headSha":"${OLD_HEAD}","status":"completed","pullRequestNumber":${PR}} -->`;
  world.comments.push(comment(`<!-- codex-pull-request-review-summary -->\n${marker}\n## Codex Review Summary`, { user: { login: 'chatgpt-codex-connector[bot]' } }));
  const report = await preflight(world);
  const feedback = gate(report, 'feedback');
  assert.equal(feedback.status, 'satisfied');
  assert.deepEqual(feedback.evidence.providerResults, [{ provider: 'codex-security-review', head: OLD_HEAD, status: 'completed', coversHead: false, url: world.comments.at(-1).html_url }]);
});

// ---- Unavailable API ----

test('an unavailable API is a read failure, never success', async () => {
  const world = cleanWorld();
  world.failures.push({ match: /check-runs/ });
  const report = await preflight(world);
  assert.equal(report.result, 'read-failure');
  assert.equal(report.exitCode, 2);
  assert.equal(gate(report, 'ci-pr').status, 'read-failure');
  assert.ok(report.readFailures.some(failure => /check-runs/.test(failure.what)));

  const down = cleanWorld();
  down.failures.push({ match: /./ });
  const none = await preflight(down);
  assert.equal(none.result, 'read-failure');
  assert.equal(none.exitCode, 2);
  assert.ok(none.gates.every(item => item.status !== 'satisfied'));

  const leaky = cleanWorld();
  leaky.failures.push({ match: /check-runs/, message: 'EACCES: open /home/someone/.config/gh/hosts.yml' });
  const leaked = await preflight(leaky);
  assert.equal(gate(leaked, 'ci-pr').status, 'read-failure');
  assert.doesNotMatch(JSON.stringify(leaked), /someone|hosts\.yml/);
  assert.ok(leaked.readFailures.some(failure => /\[path\]/.test(failure.detail)));

  const throttled = cleanWorld();
  throttled.failures.push({ match: /\/issues\/700\/comments/, status: 503 });
  const partial = await preflight(throttled);
  assert.equal(gate(partial, 'review').status, 'read-failure');
  assert.equal(partial.exitCode, 2);
});

test('a GraphQL response with errors is a read failure even when it carries partial data', async () => {
  const world = cleanWorld();
  world.graphqlErrors = true;
  const report = await preflight(world);
  assert.equal(report.result, 'read-failure');
  assert.equal(gate(report, 'feedback').status, 'read-failure');
  assert.equal(gate(report, 'identity').status, 'read-failure');
  assert.ok(report.readFailures.some(failure => /GraphQL PullRequestState/.test(failure.what) && /reviewThreads/.test(failure.detail)));
});

// ---- Pagination ----

test('pagination: every list and review thread page is read, and the decisive item can be on the last page', async () => {
  const paged = world => Object.assign(world, { pageSize: 1, threadPageSize: 1 });
  const clean = paged(cleanWorld());
  clean.comments.unshift(comment('An earlier note.', { created_at: '2026-09-27T07:00:00Z' }));
  const report = await preflight(clean);
  assert.equal(report.result, 'satisfied', JSON.stringify(report.gates.filter(g => g.status !== 'satisfied' && g.status !== 'not-applicable')));
  assert.ok(clean.requests.some(request => /comments\?.*page=2/.test(request.url)), 'the review report came from page 2');

  const reviews = paged(cleanWorld());
  reviews.reviews = [{ id: 1, user: { login: 'a' }, state: 'APPROVED', html_url: 'u1' }, { id: 2, user: { login: 'b' }, state: 'CHANGES_REQUESTED', html_url: 'u2' }];
  assertUnresolved(await preflight(reviews), 'feedback', /changes requested by b/);

  const threads = paged(cleanWorld());
  threads.threads = [{ isResolved: true, isOutdated: false, path: 'a', comments: { nodes: [] } }, { isResolved: false, isOutdated: false, path: 'b', comments: { nodes: [] } }];
  assertUnresolved(await preflight(threads), 'feedback', /1 unresolved review thread/);

  const blockers = paged(cleanWorld());
  blockers.issues[`${REPO}#${ISSUE}`].blockedBy[1].state = 'open';
  assertUnresolved(await preflight(blockers), 'counterparts', /agent-skills#54, which is open/);

  const files = paged(cleanWorld());
  files.files.push({ filename: 'apps/dashboard/src/main.tsx', status: 'modified' });
  assert.equal((await preflight(files)).result, 'satisfied');
  assert.ok(files.requests.some(request => /files\?.*page=2/.test(request.url)));

  const runs = paged(cleanWorld());
  runs.checkRuns[HEAD].at(-1).conclusion = 'failure';
  assertUnresolved(await preflight(runs), 'ci-pr', /: failure/);
});

test('pagination: a failed later page, an off-host next link and too many pages are read failures', async () => {
  const later = Object.assign(cleanWorld(), { pageSize: 1 });
  later.comments.push(comment('A second comment.'));
  later.failures.push({ match: /issues\/700\/comments\?.*page=2/, status: 502 });
  const failed = await preflight(later);
  assert.equal(gate(failed, 'review').status, 'read-failure');
  assert.equal(failed.exitCode, 2);

  const offHost = Object.assign(cleanWorld(), { pageSize: 1, nextLinkHost: 'https://example.com' });
  const left = await preflight(offHost);
  assert.equal(left.result, 'read-failure');
  assert.ok(left.readFailures.some(failure => /pagination left the GitHub API/.test(failure.detail)));

  const many = Object.assign(cleanWorld(), { pageSize: 1 });
  for (let index = 0; index < MAX_PAGES; index += 1) many.comments.push(comment(`note ${index}`));
  const tooMany = await preflight(many);
  assert.equal(gate(tooMany, 'review').status, 'read-failure');
  assert.ok(tooMany.readFailures.some(failure => new RegExp(`more than ${MAX_PAGES} pages`).test(failure.detail)));
});

test('an incomplete changed-file list keeps path-filtered jobs expected', async () => {
  const world = guideOnlyWorld();
  world.pr.changed_files = world.files.length + 1;
  const report = await preflight(world);
  assert.equal(gate(report, 'ui-approval').status, 'not-applicable');
  assertUnresolved(report, 'ci-pr', /(?<!\/ )Workflow checks on ubuntu-latest: missing/);
  assert.match(gate(report, 'ci-pr').reasons.join(), /path filters are not applied and every job stays expected/);
});

// ---- UI verification without human approval ----

test('UI changes pass without human approval for Guide, dashboard and new device UI', async () => {
  for (const file of ['docs/work-guide/work/guide_overview.css', 'apps/dashboard/src/main.tsx',
    'scripts/build-dashboard.mjs', 'controllers/tidbyt/src/newframe.ts',
    'controllers/tidbyt/fixtures/golden/status-bar.webp']) {
    const world = cleanWorld();
    world.files.push({ filename: file, status: 'added' });
    const report = await preflight(world);
    assert.equal(report.result, 'satisfied', file);
    assert.equal(gate(report, 'ui-approval').status, 'not-applicable');
  }
});

test('UI changes retain independent review, CI and declared proof failures', async t => {
  const ui = () => {
    const world = cleanWorld();
    world.files.push({ filename: 'apps/dashboard/src/main.tsx', status: 'modified' });
    return world;
  };
  const review = ui();
  review.comments = [];
  assertUnresolved(await preflight(review), 'review', /review/);
  const ci = ui();
  ci.checkRuns[HEAD].at(-1).conclusion = 'failure';
  assertUnresolved(await preflight(ci), 'ci-pr', /: failure/);
  const proof = writeProof(scratch(t));
  fs.writeFileSync(path.join(proof, 'receipt.json'), '{}');
  assertUnresolved(await preflight(ui(), { receipts: [proof] }), 'proof', /receipt/);
});

test('legacy UI declarations are ignored without fetching an approval record', async () => {
  const world = cleanWorld();
  const approvalUrl = `https://github.com/${REPO}/pull/${PR}#issuecomment-999999`;
  const report = await preflight(world, { ui: true, uiApproval: approvalUrl });
  assert.equal(report.result, 'satisfied');
  assert.equal(gate(report, 'ui-approval').status, 'not-applicable');
  assert.ok(!world.requests.some(request => request.url.includes('999999')));
});

// ---- Counterparts ----

test('an open counterpart or open blocker is unresolved; merged and completed ones pass', async () => {
  const world = cleanWorld();
  world.issues[`${OWNER}/codex-nanoleaf#189`] = { state: 'open', state_reason: null, blockedBy: [] };
  assertUnresolved(await preflight(world, { counterparts: [`${OWNER}/codex-nanoleaf#189`] }), 'counterparts', /codex-nanoleaf#189 is open/);

  const merged = cleanWorld();
  merged.pulls[`${OWNER}/divoom-app-upgrade#90`] = { state: 'closed', merged: true, merged_at: '2026-09-27T06:00:00Z', merge_commit_sha: 'f'.repeat(40), head: { sha: 'e'.repeat(40) } };
  const ok = await preflight(merged, { counterparts: [`${OWNER}/divoom-app-upgrade#90`] });
  assert.equal(gate(ok, 'counterparts').status, 'satisfied');

  const unmerged = cleanWorld();
  unmerged.pulls[`${OWNER}/divoom-app-upgrade#91`] = { state: 'closed', merged: false, merged_at: null, head: { sha: 'e'.repeat(40) } };
  assertUnresolved(await preflight(unmerged, { counterparts: [`${OWNER}/divoom-app-upgrade#91`] }), 'counterparts', /closed without merge/);

  const blocked = cleanWorld();
  blocked.issues[`${REPO}#${ISSUE}`].blockedBy[0].state = 'open';
  assertUnresolved(await preflight(blocked), 'counterparts', /blocked by .*#493, which is open/);

  const notPlanned = cleanWorld();
  notPlanned.issues[`${REPO}#${ISSUE}`].blockedBy[1].state_reason = 'not_planned';
  assertUnresolved(await preflight(notPlanned), 'counterparts', /agent-skills#54.*not_planned/);

  assertUnresolved(await preflight(cleanWorld(), { counterparts: ['someone/else#1'] }), 'counterparts', /not an owned repository/);
});

// ---- Finish line ----

test('a source-stage check never claims completed installation or device acceptance', async () => {
  const report = await preflight(cleanWorld(), { finishLine: 'source' });
  const live = gate(report, 'live-acceptance');
  assert.equal(live.status, 'not-applicable');
  assert.match(live.reasons.join(), /source-stage check only/);
  assert.equal(report.result, 'satisfied');
});

test('a live finish line cannot be satisfied by source, CI or simulator evidence', async t => {
  const proof = writeProof(scratch(t));
  for (const finishLine of ['installed', 'real-client', 'physical']) {
    const report = await preflight(cleanWorld(), { finishLine, receipts: [proof] });
    assert.equal(gate(report, 'proof').status, 'satisfied');
    assertUnresolved(report, 'live-acceptance', new RegExp(`${finishLine} acceptance`));
    assert.ok(gate(report, 'live-acceptance').reasons.some(reason => /simulated: wall-controller/.test(reason)));
  }
});

// ---- Guide-only CI exception ----

function guideOnlyWorld() {
  const world = cleanWorld();
  world.files = [
    { filename: 'docs/work-guide/work/backlogs/snapshot.json', status: 'modified' },
    { filename: 'docs/work-guide/outputs/agent-device-work-guides.html', status: 'modified' },
  ];
  world.compares[`${BASE}...${HEAD}`].files = world.files;
  world.checkRuns[HEAD] = [];
  world.checkSuites[HEAD] = [];
  world.blobs[`${HEAD}:docs/work-guide/outputs/agent-device-work-guides.html`] = GUIDE_HTML;
  return world;
}

function guideRecord(world, options = {}, sha = HEAD) {
  const record = comment(guideRecordBody(sha, options));
  world.comments.push(record);
  return record.html_url;
}

test('guide-only: the exception passes only with its documented evidence', async t => {
  const world = guideOnlyWorld();
  const receipt = writeGuideEvidence(scratch(t));
  const report = await preflight(world, { guideReceipts: [receipt], guideRecords: [guideRecord(world)] });
  const ci = gate(report, 'ci-pr');
  assert.equal(ci.status, 'satisfied', JSON.stringify(ci));
  assert.equal(ci.evidence.mode, 'guide-only-exception');
  assert.equal(ci.evidence.guideReceipt.htmlSha256, sha256(GUIDE_HTML));
  assert.equal(report.result, 'satisfied');
  assert.equal(gate(report, 'ui-approval').status, 'not-applicable');
});

test('guide-only: missing runs alone never establish the exception', async () => {
  assertUnresolved(await preflight(guideOnlyWorld()), 'ci-pr', /guide-only exception needs the guide verification receipt/);
});

test('guide files with other Markdown skip Checks and need the guide evidence (Hub #861)', async t => {
  const mixed = () => {
    const world = guideOnlyWorld();
    world.files.push({ filename: 'docs/sdlc.md', status: 'modified' });
    world.compares[`${BASE}...${HEAD}`].files = world.files;
    world.checkRuns[HEAD] = cleanWorld().checkRuns[HEAD].filter(run => /^(Workflow checks|Work guide build) /.test(run.name));
    world.checkSuites[HEAD] = cleanWorld().checkSuites[HEAD];
    return world;
  };
  const missing = await preflight(mixed());
  assertUnresolved(missing, 'ci-pr', /needs the guide verification receipt/);
  assert.match(gate(missing, 'ci-pr').reasons.join(), /skip checks\.yml; docs\/sdlc\.md#markdown-only-ci-routing requires the guide evidence/);
  const world = mixed();
  const receipt = writeGuideEvidence(scratch(t));
  const ci = gate(await preflight(world, { guideReceipts: [receipt], guideRecords: [guideRecord(world)] }), 'ci-pr');
  assert.equal(ci.status, 'satisfied', ci.reasons.join('; '));
});

test('guide-only: mixed changes, renames out of the folder and inconsistent runs cannot use it', async t => {
  const directory = scratch(t);
  const receipt = writeGuideEvidence(directory);
  const mixed = guideOnlyWorld();
  mixed.files.push({ filename: 'scripts/check-workflow.cjs', status: 'modified' });
  assertUnresolved(await preflight(mixed, { guideReceipts: [receipt], guideRecords: [guideRecord(mixed)] }), 'ci-pr', /Build, lint and core tests on ubuntu-latest: missing/);
  assert.match(gate(await preflight(mixed, { guideReceipts: [receipt] }), 'ci-pr').reasons.join(), /not guide-only: scripts\/check-workflow\.cjs/);

  const renamed = guideOnlyWorld();
  renamed.files.push({ filename: 'docs/build_guide.py', previous_filename: 'docs/work-guide/work/build_guide.py', status: 'renamed' });
  assertUnresolved(await preflight(renamed, { guideReceipts: [receipt], guideRecords: [guideRecord(renamed)] }), 'ci-pr', /missing/);

  const ran = guideOnlyWorld();
  ran.checkRuns[HEAD] = [checkRun(job(/Workflow checks/), HEAD, 9001)];
  ran.checkSuites[HEAD] = [suite(9001, HEAD, 'claude/gh-700-example')];
  assertUnresolved(await preflight(ran, { guideReceipts: [receipt], guideRecords: [guideRecord(ran)] }), 'ci-pr', /GitHub Actions runs exist/);
});

test('guide-only: a receipt for other HTML, a failed check or missing retained files are unresolved', async t => {
  const other = writeGuideEvidence(scratch(t), { html: Buffer.from('other') });
  const world = guideOnlyWorld();
  assertUnresolved(await preflight(world, { guideReceipts: [other], guideRecords: [guideRecord(world)] }), 'ci-pr', /no guide receipt's HTML hash matches the candidate's committed guide HTML/);
  const failed = writeGuideEvidence(scratch(t), { overrides: { navigation: 'failed' } });
  assertUnresolved(await preflight(world, { guideReceipts: [failed], guideRecords: [guideRecord(world)] }), 'ci-pr', /navigation: failed/);
  const errors = writeGuideEvidence(scratch(t), { errors: ['broken link'] });
  assertUnresolved(await preflight(world, { guideReceipts: [errors], guideRecords: [guideRecord(world)] }), 'ci-pr', /errors/);
  const bare = writeGuideEvidence(scratch(t), { screenshots: false, print: false });
  assertUnresolved(await preflight(world, { guideReceipts: [bare], guideRecords: [guideRecord(world)] }), 'ci-pr', /screenshots.*print check/);
  const good = writeGuideEvidence(scratch(t));
  assertUnresolved(await preflight(world, { guideReceipts: [good] }), 'ci-pr', /record/);
  const vague = comment('Guide checks passed.');
  world.comments.push(vague);
  assertUnresolved(await preflight(world, { guideReceipts: [good], guideRecords: [vague.html_url] }), 'ci-pr', /no guide record from jimmie-potts names [0-9a-f]{12} in full/);
});

test('guide-only: the record must show passing build, maintenance, Places and drift checks', async t => {
  const receipt = writeGuideEvidence(scratch(t));
  const unverified = check => new RegExp(`does not show ${check.replace(/[.-]/g, '\\$&')} in the form "<command>: exit 0" or "<command>: passed"; it remains unverified`);
  const cases = [
    [{ maintenance: 'FAILED (2 failures)' }, unverified('test_maintenance.py')],
    [{ maintenance: '2 failures, 40 passed' }, unverified('test_maintenance.py')],
    [{ maintenance: 'did not pass' }, unverified('test_maintenance.py')],
    [{ maintenance: 'not passed' }, unverified('test_maintenance.py')],
    [{ maintenance: 'would have passed' }, unverified('test_maintenance.py')],
    [{ maintenance: 'never passed' }, unverified('test_maintenance.py')],
    [{ maintenance: 'exit 0.' }, unverified('test_maintenance.py')],
    [{ maintenance: 'exit 0 (2 skipped)' }, unverified('test_maintenance.py')],
    [{ maintenance: 'exit 1; rerun: exit 0' }, unverified('test_maintenance.py')],
    [{ maintenance: 'FAILED; second run: passed' }, unverified('test_maintenance.py')],
    [{ drift: 'exit 1' }, unverified('git diff --exit-code')],
    [{ places: null }, unverified('check_places.cjs')],
    [{ build: 'ran' }, unverified('build_guide.py')],
    [{ build: null, maintenance: null, places: null, drift: null }, unverified('test_maintenance.py')],
  ];
  for (const [options, reason] of cases) {
    const world = guideOnlyWorld();
    assertUnresolved(await preflight(world, { guideReceipts: [receipt], guideRecords: [guideRecord(world, options)] }), 'ci-pr', reason);
  }
  const contradicted = guideOnlyWorld();
  const twice = comment(`${guideRecordBody(HEAD)}\n- python3 docs/work-guide/work/build_guide.py: exit 1`);
  contradicted.comments.push(twice);
  assertUnresolved(await preflight(contradicted, { guideReceipts: [receipt], guideRecords: [twice.html_url] }), 'ci-pr', unverified('build_guide.py'));
  const passedForm = guideOnlyWorld();
  const passed = comment(guideRecordBody(HEAD, { build: 'passed', maintenance: 'passed', places: 'passed', drift: 'passed' }));
  passedForm.comments.push(passed);
  assert.equal(gate(await preflight(passedForm, { guideReceipts: [receipt], guideRecords: [passed.html_url] }), 'ci-pr').status, 'satisfied');
  const hashless = guideOnlyWorld();
  const record = comment(guideRecordBody(HEAD).replace(sha256(GUIDE_HTML), 'unknown'));
  hashless.comments.push(record);
  assertUnresolved(await preflight(hashless, { guideReceipts: [receipt], guideRecords: [record.html_url] }), 'ci-pr', /does not name the HTML sha256/);
});

test('guide-only: records from bots, other accounts or with markers do not count', async t => {
  const receipt = writeGuideEvidence(scratch(t));
  for (const overrides of [{ user: { login: 'github-actions[bot]', type: 'Bot' } }, { user: { login: 'someone-else', type: 'User' } }]) {
    const world = guideOnlyWorld();
    const record = comment(guideRecordBody(HEAD), overrides);
    world.comments.push(record);
    assertUnresolved(await preflight(world, { guideReceipts: [receipt], guideRecords: [record.html_url] }), 'ci-pr', /not the delivery account|a bot/);
  }
  const marked = guideOnlyWorld();
  const record = comment(`<!-- deliver-work note -->\n${guideRecordBody(HEAD)}`);
  marked.comments.push(record);
  assertUnresolved(await preflight(marked, { guideReceipts: [receipt], guideRecords: [record.html_url] }), 'ci-pr', /automation marker/);
});

test('guide-only: a merged PR needs its own record for the head and for the merge commit', async t => {
  const receipt = writeGuideEvidence(scratch(t));
  const world = mergeWorld(guideOnlyWorld());
  world.checkRuns[MERGE] = [];
  world.checkSuites[MERGE] = [];
  world.blobs[`${MERGE}:docs/work-guide/outputs/agent-device-work-guides.html`] = GUIDE_HTML;
  const headRecord = guideRecord(world);
  const report = await preflight(world, { guideReceipts: [receipt], guideRecords: [headRecord] });
  assert.equal(gate(report, 'ci-pr').status, 'satisfied', JSON.stringify(gate(report, 'ci-pr').reasons));
  assertUnresolved(report, 'ci-main', new RegExp(`no guide record from jimmie-potts names ${MERGE.slice(0, 12)} in full`));
  const mainRecord = guideRecord(world, {}, MERGE);
  const both = await preflight(world, { guideReceipts: [receipt], guideRecords: [headRecord, mainRecord] });
  assert.equal(both.result, 'satisfied', JSON.stringify(both.gates.filter(g => g.status !== 'satisfied' && g.status !== 'not-applicable')));
  assert.equal(gate(both, 'ci-main').evidence.guideRecord.url, mainRecord);
});

test('guide-only: a branch-rule check keeps normal CI and the note says why', async t => {
  const world = guideOnlyWorld();
  world.branchRules = [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'Security scan' }] } }];
  const report = await preflight(world, { guideReceipts: [writeGuideEvidence(scratch(t))], guideRecords: [guideRecord(world)] });
  assertUnresolved(report, 'ci-pr', /Security scan: missing/);
  assert.match(gate(report, 'ci-pr').reasons.join(), /the guide-only exception does not apply: branch rules require Security scan/);
});

test('workflow filters treat ** as GitHub does, including dot-files', () => {
  const workflows = ['checks.yml', 'guide.yml'].map(file => parseWorkflow(file, WORKFLOW_FILES[file]));
  const dotfile = expectedJobs(workflows, { event: 'pull_request', branch: 'main', files: ['docs/work-guide/.gitignore'], filesComplete: true }, ACTIONS);
  assert.deepEqual(dotfile.jobs, []);
  for (const [pattern, file, expected] of [
    ['docs/work-guide/**', 'docs/work-guide/.gitignore', true], ['docs/work-guide/**', 'docs/work-guides/a.md', false],
    ['**/README.md', 'README.md', true], ['**/README.md', 'a/.b/README.md', true], ['docs/*.md', 'docs/a/b.md', false], ['a.b', 'axb', false],
  ]) assert.equal(filterPattern(pattern).test(file), expected, `${pattern} ${file}`);
  const classes = parseWorkflow('c.yml', "name: C\non:\n  pull_request:\n    paths-ignore: ['docs/[a-z]*/**']\njobs:\n  a:\n    runs-on: x\n    steps: [{run: 'true'}]\n");
  const kept = expectedJobs([classes], { event: 'pull_request', branch: 'main', files: ['docs/x/y.md'], filesComplete: true }, ACTIONS);
  assert.deepEqual(kept.jobs.map(item => item.key), ['C / a']);
  assert.match(kept.notes.join(), /not evaluated; every job stays expected/);
  const optional = parseWorkflow('q.yml', "name: Q\non:\n  pull_request:\n    paths-ignore: ['docs/a?.md']\njobs:\n  a:\n    runs-on: x\n    steps: [{run: 'true'}]\n");
  const question = expectedJobs([optional], { event: 'pull_request', branch: 'main', files: ['docs/ab.md'], filesComplete: true }, ACTIONS);
  assert.deepEqual(question.jobs.map(item => item.key), ['Q / a'], '? is zero-or-one in GitHub patterns, so it is not evaluated');
  assert.match(question.notes.join(), /negation, \?, \+ or \[\]/);
  for (const branches of ["['!main']", "['release/v?']", "['release/[0-9]']"]) {
    const pushes = parseWorkflow('b.yml', `name: B\non:\n  push:\n    branches: ${branches}\njobs:\n  a:\n    runs-on: x\n    steps: [{run: 'true'}]\n`);
    const result = expectedJobs([pushes], { event: 'push', branch: 'main', files: ['a'], filesComplete: true }, ACTIONS);
    assert.deepEqual(result.jobs.map(item => item.key), ['B / a'], branches);
    assert.match(result.notes.join(), /branch patterns .* are not evaluated/);
  }
});

// ---- Proof artifacts (app-verification/1 receipts) ----

const receiptCases = [
  ['a dirty build', { dirty: true }, /dirty/],
  ['a failed capture', { captures: [{ n: 1, step: 'task-appears', set: 'verified', outcome: 'failed', reason: 'assertion failed' }] }, /capture 1 task-appears: failed \(assertion failed\)/],
  ['an unavailable capture', { captures: [{ n: 1, step: 'task-appears', set: 'verified', outcome: 'unavailable', reason: 'Chromium missing' }] }, /unavailable/],
  ['no verified capture', { captures: [{ n: 2, step: 'later', set: 'after-handoff', outcome: 'passed' }] }, /no verified capture/],
  ['another revision', { sourceRevision: OLD_HEAD }, /built from [0-9a-f]{12}, not the candidate/],
  ['an unknown revision', { sourceRevision: 'unknown' }, /built from unknown/],
  ['an unfrozen verified set', { frozen: false }, /not frozen/],
  ['a tampered verified set', { tamper: true }, /SHA256SUMS mismatch: capture-1\/after\.png/],
  ['a failed run', { state: 'failed', failure: { cause: 'readiness-timeout', at: '2026-09-27T07:01:00Z' } }, /failed: readiness-timeout/],
  ['a failed receipt check', { checks: [{ id: 'readiness', outcome: 'failed', reason: 'timeout' }] }, /check readiness failed/],
  ['a receipt the app-verify validator refuses', { overrides: { secrets: 'token abc' } }, /receipt invalid: secrets/],
];

for (const [name, options, reason] of receiptCases) {
  test(`proof: ${name} is unresolved`, async t => {
    const proof = writeProof(scratch(t), options);
    assertUnresolved(await preflight(cleanWorld(), { receipts: [proof] }), 'proof', reason);
  });
}

test('proof: a clean frozen receipt is identified by run id and checksums, never by private path', async t => {
  const directory = scratch(t);
  const proof = writeProof(directory);
  const report = await preflight(cleanWorld(), { receipts: [path.join(proof, 'receipt.json')] });
  const found = gate(report, 'proof');
  assert.equal(found.status, 'satisfied');
  assert.equal(found.evidence.receipts[0].runId, 'hub-20260927T070000Z-3f9a1c');
  assert.match(found.evidence.receipts[0].sha256sums, /^sha256:[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(report).includes(directory), 'the report must not contain the local proof path');
  assert.ok(!renderText(report).includes(directory));
  const missing = await preflight(cleanWorld(), { receipts: [path.join(directory, 'nope')] });
  assert.equal(gate(missing, 'proof').status, 'read-failure');
  assert.ok(!JSON.stringify(missing).includes(directory));
});

test('proof: receipt reasons are shortened and never carry paths', async t => {
  const directory = scratch(t);
  const reason = `assertion failed reading /home/someone/private/screens/after.png and ~/secret/file.txt ${'x'.repeat(120)}`;
  const proof = writeProof(directory, { captures: [{ n: 1, step: 'task-appears', set: 'verified', outcome: 'failed', reason }] });
  const report = await preflight(cleanWorld(), { receipts: [proof] });
  const text = gate(report, 'proof').reasons.join('\n');
  assert.match(text, /assertion failed reading \[path\] and \[path\]/);
  assert.doesNotMatch(JSON.stringify(report), /someone|secret|x{100}/);
});

test('proof: an unreadable verified set is a read failure that names no local path', { skip: process.getuid?.() === 0 && 'root ignores directory permissions' }, async t => {
  const directory = scratch(t);
  const proof = writeProof(directory);
  const locked = path.join(proof, 'verified', 'capture-1');
  fs.chmodSync(locked, 0o000);
  let report;
  try {
    report = await preflight(cleanWorld(), { receipts: [proof] });
  } finally {
    fs.chmodSync(locked, 0o755);
  }
  assert.equal(gate(report, 'proof').status, 'read-failure');
  assert.match(gate(report, 'proof').reasons.join(), /read failure: receipt .*receipt\.json: EACCES/);
  assert.ok(!JSON.stringify(report).includes(directory));
});

// ---- Merged candidates ----

test('a merged PR also needs its main revision CI', async () => {
  const world = mergeWorld(cleanWorld());
  const report = await preflight(world);
  assert.equal(gate(report, 'ci-main').status, 'satisfied');
  assert.equal(report.candidate.state, 'merged');
  assert.equal(report.candidate.mergeCommit, MERGE);
  assert.equal(report.result, 'satisfied');
  world.checkRuns[MERGE].pop();
  assertUnresolved(await preflight(world), 'ci-main', /missing/);
});

// ---- Read-only property ----

const writes = [
  ['PUT', `/repos/${REPO}/pulls/${PR}/merge`, { merge_method: 'squash' }],
  ['PATCH', `/repos/${REPO}/issues/${ISSUE}`, { state: 'closed' }],
  ['POST', `/repos/${REPO}/issues/${ISSUE}/labels`, { labels: ['status:review'] }],
  ['DELETE', `/repos/${REPO}/issues/${ISSUE}/labels/status:review`, undefined],
  ['POST', `/repos/${REPO}/pulls/${PR}/reviews`, { event: 'APPROVE' }],
  ['POST', `/repos/${REPO}/issues/${PR}/comments`, { body: 'green' }],
  ['POST', `/repos/${REPO}/check-runs`, { name: 'dummy', conclusion: 'success' }],
  ['POST', `/repos/${REPO}/actions/workflows/1/dispatches`, { ref: 'main' }],
  ['PATCH', `/repos/${REPO}/pulls/${PR}`, { body: 'edited' }],
  ['GET', `/repos/${REPO}/pulls/${PR}`, { sneaky: true }],
  ['GET', 'https://example.com/steal', undefined],
];

const mutations = [
  // Lexer-bypass shapes: a block string opened inside a comment, and a lone carriage return ending a comment.
  'query A { viewer { login } } # """\nmutation B { deleteIssue(input: {issueId: "x"}) { clientMutationId } } # """',
  '# x\rmutation B { deleteIssue(input: {issueId: "x"}) { clientMutationId } }\nquery A { viewer { login } }',
  'mutation { mergePullRequest(input: {pullRequestId: "x"}) { clientMutationId } }',
  'mutation Close { closeIssue(input: {issueId: "x"}) { clientMutationId } }',
  'mutation { addComment(input: {subjectId: "x", body: "y"}) { clientMutationId } }',
  'mutation { addPullRequestReview(input: {pullRequestId: "x", event: APPROVE}) { clientMutationId } }',
  'mutation { addLabelsToLabelable(input: {labelableId: "x", labelIds: []}) { clientMutationId } }',
  '# a comment\n mutation { resolveReviewThread(input: {threadId: "x"}) { clientMutationId } }',
  'query { viewer { login } } mutation { deleteIssue(input: {issueId: "x"}) { clientMutationId } }',
  'subscription { x }',
  '{ viewer { login } }\nmutation M { x }',
];

test('the client refuses every write before the transport sees it', async () => {
  const seen = [];
  const client = createReadOnlyClient(async request => { seen.push(request); return { status: 200, json: {} }; });
  for (const [method, target, body] of writes) {
    await assert.rejects(client.request(method, target, body), ReadOnlyViolation, `${method} ${target}`);
  }
  for (const document of mutations) {
    await assert.rejects(client.graphql(document), ReadOnlyViolation, document);
    // The query guard refuses each one by itself, before the allowlist.
    assert.throws(() => assertQueryOnly(document), { name: 'ReadOnlyViolation' }, document);
  }
  for (const document of ['query Q { viewer { login } }', '{ viewer { login } }', 'query Q { repository(owner: "mutation", name: "x") { id } }']) {
    await assert.rejects(client.graphql(document), ReadOnlyViolation, `a query outside the allowlist: ${document}`);
  }
  assert.deepEqual(seen, []);
  for (const document of Object.values(QUERIES)) await client.graphql(document, {}).catch(() => {});
  assert.equal(seen.length, Object.keys(QUERIES).length, "only the preflight's own documents reach the transport");
  for (const document of Object.values(QUERIES)) {
    assert.doesNotThrow(() => assertQueryOnly(document));
    assert.match(document, /^query \w+\(/);
    assert.doesNotMatch(document, /\b(?:mutation|subscription)\b|#|"""|\r/);
  }
});

test('the live transport repeats the read-only gate before any network use', async () => {
  const calls = [];
  const transport = fetchTransport({ token: 'test-token', fetchImpl: async (url, init) => { calls.push([url, init.method]); return new Response('{}', { status: 200 }); } });
  for (const [method, target, body] of writes) {
    const url = target.startsWith('http') ? target : `https://api.github.com${target}`;
    await assert.rejects(transport({ method, url, body }), ReadOnlyViolation);
  }
  await assert.rejects(transport({ method: 'POST', url: 'https://api.github.com/graphql', body: { query: mutations[0] } }), ReadOnlyViolation);
  assert.deepEqual(calls, []);
  await transport({ method: 'GET', url: `https://api.github.com/repos/${REPO}` });
  assert.deepEqual(calls, [[`https://api.github.com/repos/${REPO}`, 'GET']]);
});

test('every scenario issues only GET requests and GraphQL queries', async t => {
  const directory = scratch(t);
  const proof = writeProof(directory);
  const guideReceipt = writeGuideEvidence(directory);
  const worlds = [];
  const run = async (world, overrides) => { worlds.push(world); await preflight(world, overrides); };
  await run(cleanWorld(), { receipts: [proof], finishLine: 'physical', counterparts: [`${OWNER}/codex-nanoleaf#189`] });
  await run(mergeWorld(cleanWorld()));
  const guide = guideOnlyWorld();
  await run(guide, { guideReceipts: [guideReceipt], guideRecords: [guideRecord(guide)] });
  const ui = cleanWorld();
  ui.files.push({ filename: 'apps/dashboard/src/main.tsx', status: 'modified' });
  await run(ui);
  for (const world of worlds) {
    assert.ok(world.requests.length > 5);
    for (const request of world.requests) {
      if (request.method === 'GET') {
        assert.equal(request.body, undefined);
        continue;
      }
      assert.equal(request.method, 'POST');
      assert.equal(request.url, 'https://api.github.com/graphql');
      assert.ok(Object.values(QUERIES).includes(request.body.query), 'only allowlisted query documents are sent');
    }
  }
});

test('under Node permissions the preflight runs with no file writes or child processes', t => {
  const directory = scratch(t);
  const proof = writeProof(directory);
  const guideReceipt = writeGuideEvidence(directory);
  const harness = path.join(root, 'tests', 'delivery-preflight', 'harness.mjs');
  const flags = ['--permission', `--allow-fs-read=${root}`, `--allow-fs-read=${directory}`];
  const result = spawnSync(process.execPath, [...flags, harness, proof, guideReceipt], { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stderr);
  const outcomes = JSON.parse(result.stdout);
  assert.deepEqual(outcomes, { clean: 'satisfied', guideOnly: 'satisfied', physical: 'unresolved', unavailable: 'read-failure', writeAttempt: 'ERR_ACCESS_DENIED', spawnAttempt: 'ERR_ACCESS_DENIED' });
});

// ---- Output ----

test('the text report is concise, names full revisions and hides credentials', async () => {
  const world = cleanWorld();
  world.checkRuns[HEAD].pop();
  const report = await preflight(world);
  const text = renderText(report);
  assert.match(text, new RegExp(`head ${HEAD}`));
  assert.match(text, /UNRESOLVED/);
  assert.match(text, /(?<!\/ )Workflow checks on ubuntu-latest: missing/);
  assert.match(text, /not authorization/);
  assert.ok(text.split('\n').length < 60, text);
  assert.doesNotMatch(text, /Verdict: satisfied/, 'reviewer text stays in the linked report, not the preflight output');
});

test('the CLI reports usage errors with their own exit status', () => {
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--pr <number>/);
  for (const args of [[], ['--pr', 'abc'], ['--pr', '1', '--finish-line', 'moon'], ['--pr', '1', '--counterpart', 'nope'], ['--pr', '1', '--head', 'xyz'], ['--pr', '1', '--wat'], ['--pr', '1', '--guide-record', 'https://example.com/x']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, GH_TOKEN: '' } });
    assert.equal(result.status, 3, `${args.join(' ')}: ${result.stderr}`);
  }
});

test('the CLI reports an internal error without local paths', async () => {
  const output = [];
  const errors = [];
  const code = await main({
    argv: ['--pr', '1'],
    run: async () => { throw new TypeError('cannot read /home/someone/.local/state/app-verify/run/receipt.json'); },
    transport: async () => ({ status: 500, json: {} }),
    stdout: { write: text => output.push(text) },
    stderr: { write: text => errors.push(text) },
  });
  assert.equal(code, 3);
  assert.deepEqual(output, []);
  assert.match(errors.join(''), /stopped by an internal error: cannot read \[path\]/);
  assert.doesNotMatch(errors.join(''), /someone/);
});

test('the CLI turns a missing credential into a read failure', () => {
  const result = spawnSync(process.execPath, [cli, '--pr', '1', '--json'], { encoding: 'utf8', env: { PATH: '/nonexistent', HOME: os.tmpdir() } });
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.result, 'read-failure');
  assert.match(report.readFailures[0].detail, /credential/);
});


test('the CLI accepts legacy UI flags without inspecting their unused value', async () => {
  const output = [];
  const code = await main({
    argv: ['--pr', String(PR), '--ui', '--ui-approval', '/private/obsolete-record', '--json'],
    transport: fakeTransport(cleanWorld()),
    stdout: { write: text => output.push(text) },
    stderr: { write: text => assert.fail(text) },
  });
  assert.equal(code, 0);
  assert.equal(gate(JSON.parse(output.join('')), 'ui-approval').status, 'not-applicable');
  assert.doesNotMatch(output.join(''), /private\/obsolete-record/);
});
