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

import { createReadOnlyClient, fetchTransport, ReadOnlyViolation, assertQueryOnly } from '../scripts/delivery-preflight/github.mjs';
import { runPreflight } from '../scripts/delivery-preflight/preflight.mjs';
import { renderText } from '../scripts/delivery-preflight/report.mjs';
import { expectedJobs, parseWorkflow } from '../scripts/delivery-preflight/workflows.mjs';
import {
  BASE, EXPECTED_JOBS, GUIDE_HTML, HEAD, ISSUE, MERGE, NEWER_MAIN, OLD_HEAD, OWNER, POLICY, PR, REPO,
  checkRun, cleanWorld, comment, declaration, fakeTransport, mergeWorld, reviewReport, sha256, suite,
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
  assert.equal(report.formats.reviewReports, 'jimmie-potts/agent-skills@5d03ee40d119ba432dca39c17345d4ae00d0c2d7');
  assert.equal(report.formats.receipt, 'app-verification/1');
  assert.equal(report.readAt, READ_AT.toISOString());
  assert.match(report.notice, /not authorization/);
  assert.match(report.notice, new RegExp(HEAD));
});

test('the real Depot configuration enumerates the six expected jobs and filters guide-only changes', () => {
  const workflows = ['ci.yml', 'work-guide.yml'].map(file => parseWorkflow(file, fs.readFileSync(path.join(root, '.depot/workflows', file), 'utf8')));
  const source = expectedJobs(workflows, { event: 'pull_request', branch: 'main', files: ['scripts/a.mjs'], filesComplete: true });
  assert.deepEqual(source.jobs.map(job => job.name).sort(), [...EXPECTED_JOBS].sort());
  assert.deepEqual(source.uncertain, []);
  const push = expectedJobs(workflows, { event: 'push', branch: 'main', files: ['docs/work-guide/a.md', 'README.md'], filesComplete: true });
  assert.equal(push.jobs.length, 6);
  const guide = expectedJobs(workflows, { event: 'pull_request', branch: 'main', files: ['docs/work-guide/outputs/agent-device-work-guides.html'], filesComplete: true });
  assert.deepEqual(guide.jobs, []);
  assert.equal(guide.filtered.length, 2);
  const incomplete = expectedJobs(workflows, { event: 'pull_request', branch: 'main', files: ['docs/work-guide/a.md'], filesComplete: false });
  assert.equal(incomplete.jobs.length, 6, 'an incomplete file list keeps every job expected');
  const branchPush = expectedJobs(workflows, { event: 'push', branch: 'feature', files: ['README.md'], filesComplete: true });
  assert.deepEqual(branchPush.jobs, []);
});

test('workflow shapes the preflight cannot evaluate are reported, not guessed', () => {
  const unnamed = parseWorkflow('x.yml', 'on: pull_request\njobs:\n  a:\n    runs-on: x\n    steps: [{run: "true"}]\n');
  assert.match(expectedJobs([unnamed], { event: 'pull_request', branch: 'main', files: ['a'], filesComplete: true }).uncertain.join(), /no name/);
  const dynamic = parseWorkflow('y.yml', 'name: Y\non: pull_request\njobs:\n  a:\n    name: A ${{ github.ref }}\n    runs-on: x\n    steps: [{run: "true"}]\n');
  assert.match(expectedJobs([dynamic], { event: 'pull_request', branch: 'main', files: ['a'], filesComplete: true }).uncertain.join(), /cannot expand/);
  const include = parseWorkflow('z.yml', 'name: Z\non: pull_request\njobs:\n  a:\n    strategy:\n      matrix:\n        os: [a]\n        include: [{os: b}]\n    runs-on: x\n    steps: [{run: "true"}]\n');
  assert.match(expectedJobs([include], { event: 'pull_request', branch: 'main', files: ['a'], filesComplete: true }).uncertain.join(), /include/);
  const plain = parseWorkflow('p.yml', 'name: P\non: [push, pull_request]\njobs:\n  test:\n    strategy:\n      matrix:\n        os: [a, b]\n        exclude: [{os: b}]\n    runs-on: x\n    steps: [{run: "true"}]\n');
  assert.deepEqual(expectedJobs([plain], { event: 'pull_request', branch: 'main', files: ['a'], filesComplete: true }).jobs.map(j => j.name), ['P / test (a)']);
});

// ---- CI evidence ----

const ciCases = [
  ['a missing expected job', world => { world.checkRuns[HEAD] = world.checkRuns[HEAD].filter(run => run.name !== EXPECTED_JOBS[3]); }, /MCP on ubuntu-latest: missing/],
  ['a pending job', world => { Object.assign(world.checkRuns[HEAD][0], { status: 'in_progress', conclusion: null }); }, /pending/],
  ['a failed job', world => { world.checkRuns[HEAD][1].conclusion = 'failure'; }, /failure/],
  ['a skipped job', world => { world.checkRuns[HEAD][2].conclusion = 'skipped'; }, /skipped/],
  ['a cancelled job', world => { world.checkRuns[HEAD][2].conclusion = 'cancelled'; }, /cancelled/],
  ['a job from another app', world => { world.checkRuns[HEAD][4].app = { slug: 'github-actions' }; }, /missing/],
  ['a job for another revision', world => { world.checkRuns[HEAD][4].head_sha = OLD_HEAD; }, /missing/],
  ['a job from the push event instead of the PR', world => {
    world.checkRuns[HEAD][5].check_suite = { id: 9100 };
    world.checkSuites[HEAD].push(suite(9100, HEAD, 'main'));
  }, /missing/],
  ['a job from another repository', world => {
    world.checkRuns[HEAD][5].check_suite = { id: 9101 };
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

test('CI: a branch rule requiring a check adds it to the expected set', async () => {
  const world = cleanWorld();
  world.branchRules = [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'Security scan' }] } }];
  assertUnresolved(await preflight(world), 'ci-pr', /Security scan: missing/);
});

test('CI: a candidate that edits its workflows cannot drop an expected job unnoticed', async () => {
  const world = cleanWorld();
  const ci = world.workflows[HEAD]['ci.yml'];
  world.workflows[BASE] = { ...world.workflows[HEAD] };
  world.workflows[HEAD] = { ...world.workflows[HEAD], 'ci.yml': ci.replace(/\n  mcp:\n[\s\S]*?(?=\n  dashboard:)/, '') };
  world.files.push({ filename: '.depot/workflows/ci.yml', status: 'modified' });
  world.checkRuns[HEAD] = world.checkRuns[HEAD].filter(run => run.name !== EXPECTED_JOBS[3]);
  assertUnresolved(await preflight(world), 'ci-pr', /MCP on ubuntu-latest: expected at [0-9a-f]{12} but dropped/);

  const added = cleanWorld();
  added.workflows[BASE] = { ...added.workflows[HEAD] };
  added.workflows[HEAD] = { ...added.workflows[HEAD], 'ci.yml': ci.replace('      - run: npm run test:workflow\n', '      - run: npm run test:workflow\n      - run: npm run test:preflight\n') };
  added.files.push({ filename: '.depot/workflows/ci.yml', status: 'modified' });
  const report = await preflight(added);
  assert.equal(gate(report, 'ci-pr').status, 'satisfied');
  assert.match(gate(report, 'ci-pr').reasons.join(), /no job expected at [0-9a-f]{12} is dropped/);
});

test('CI: filters that skip non-guide paths leave the change without CI, never under the guide exception', async t => {
  const world = cleanWorld();
  for (const file of ['ci.yml', 'work-guide.yml']) {
    world.workflows[HEAD][file] = world.workflows[HEAD][file].replaceAll("paths-ignore: ['docs/work-guide/**']", "paths-ignore: ['docs/**']");
  }
  world.files = [{ filename: 'docs/sdlc.md', status: 'modified' }];
  world.compares[`${BASE}...${HEAD}`].files = world.files;
  world.checkRuns[HEAD] = [];
  const receipt = writeGuideEvidence(scratch(t));
  const record = comment(`Guide evidence for ${HEAD}, HTML sha256 ${sha256(GUIDE_HTML)}.`);
  world.comments.push(record);
  assertUnresolved(await preflight(world, { guideReceipt: receipt, guideRecord: record.html_url }), 'ci-pr', /no configured job applies and no exception covers this change/);
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

test('review: the latest final round decides, and a later stale round supersedes an earlier current one', async () => {
  const world = cleanWorld();
  world.comments = [comment(reviewReport({ round: 1, head: OLD_HEAD, standards: 'action-required', openFindings: 'P0 0; P1 0; P2 1; P3 0',
    findings: '- F1 (P2, standards, unresolved): a.mjs:1, breaks; first final 1, latest final 1' })), comment(reviewReport({ round: 2 }))];
  const report = await preflight(world);
  assert.equal(gate(report, 'review').status, 'satisfied');
  assert.deepEqual(gate(report, 'review').evidence.rounds.map(r => [r.round, r.head]), [['final 1', OLD_HEAD], ['final 2', HEAD]]);
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

  const throttled = cleanWorld();
  throttled.failures.push({ match: /\/issues\/700\/comments/, status: 503 });
  const partial = await preflight(throttled);
  assert.equal(gate(partial, 'review').status, 'read-failure');
  assert.equal(partial.exitCode, 2);
});

// ---- UI approval ----

test('UI approval: a non-guide UI change without approval evidence is unresolved', async () => {
  const world = cleanWorld();
  world.files.push({ filename: 'apps/dashboard/src/main.tsx', status: 'modified' });
  assertUnresolved(await preflight(world), 'ui-approval', /apps\/dashboard\/src\/main\.tsx.*needs explicit human approval/);
});

test('UI approval: a record naming the current candidate satisfies it; a stale one does not', async () => {
  const world = cleanWorld();
  world.files.push({ filename: 'apps/dashboard/src/main.tsx', status: 'modified' });
  const approval = comment(`Owner UI approval, recorded by the delivery session: the owner approved the current candidate at head ${HEAD}.`);
  world.comments.push(approval);
  const current = await preflight(world, { uiApproval: approval.html_url });
  assert.equal(gate(current, 'ui-approval').status, 'satisfied', JSON.stringify(gate(current, 'ui-approval')));
  assert.equal(gate(current, 'ui-approval').evidence.approvedRevision, HEAD);

  const older = comment(`Owner approved the UI candidate at ${OLD_HEAD.slice(0, 7)}.`);
  world.comments.push(older);
  world.compares[`${OLD_HEAD}...${HEAD}`] = { status: 'ahead', merge_base_commit: { sha: OLD_HEAD }, files: [{ filename: 'apps/dashboard/src/style.css', status: 'modified' }] };
  assertUnresolved(await preflight(world, { uiApproval: older.html_url }), 'ui-approval', /UI changed after the approved revision: apps\/dashboard\/src\/style\.css/);

  world.compares[`${OLD_HEAD}...${HEAD}`].files = [{ filename: 'apps/dashboard/tests/browser.mjs', status: 'modified' }];
  const unchanged = await preflight(world, { uiApproval: older.html_url });
  assert.equal(gate(unchanged, 'ui-approval').status, 'satisfied');
});

test('UI approval: guide UI is exempt, and --ui declares UI the path list does not know', async () => {
  const world = cleanWorld();
  world.files.push({ filename: 'docs/work-guide/work/guide_overview.css', status: 'modified' });
  const guide = await preflight(world);
  assert.equal(gate(guide, 'ui-approval').status, 'not-applicable');
  assert.match(gate(guide, 'ui-approval').reasons.join(), /guide UI is exempt/);
  assertUnresolved(await preflight(cleanWorld(), { ui: true }), 'ui-approval', /declared UI change needs explicit human approval/);
});

test('UI approval: a record that names no candidate revision is not approval', async () => {
  const world = cleanWorld();
  world.files.push({ filename: 'apps/dashboard/src/main.tsx', status: 'modified' });
  const vague = comment('The owner likes the dashboard.');
  world.comments.push(vague);
  assertUnresolved(await preflight(world, { uiApproval: vague.html_url }), 'ui-approval', /names no revision of this PR/);
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

test('a source-only finish line never demands installation or device acceptance', async () => {
  const report = await preflight(cleanWorld(), { finishLine: 'source' });
  const live = gate(report, 'live-acceptance');
  assert.equal(live.status, 'not-applicable');
  assert.match(live.reasons.join(), /source-only finish line/);
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

function guideRecord(world, extra = '') {
  const record = comment(`Guide-only CI exception evidence for head ${HEAD}: build, drift check, maintenance tests and browser checks passed; HTML sha256 ${sha256(GUIDE_HTML)}. ${extra}`);
  world.comments.push(record);
  return record.html_url;
}

test('guide-only: the exception passes only with its documented evidence', async t => {
  const world = guideOnlyWorld();
  const receipt = writeGuideEvidence(scratch(t));
  const report = await preflight(world, { guideReceipt: receipt, guideRecord: guideRecord(world) });
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

test('guide-only: mixed changes, renames out of the folder and inconsistent runs cannot use it', async t => {
  const directory = scratch(t);
  const receipt = writeGuideEvidence(directory);
  const mixed = guideOnlyWorld();
  mixed.files.push({ filename: 'docs/sdlc.md', status: 'modified' });
  assertUnresolved(await preflight(mixed, { guideReceipt: receipt, guideRecord: guideRecord(mixed) }), 'ci-pr', /Checks \/ Workflow checks on ubuntu-latest: missing/);
  assert.match(gate(await preflight(mixed, { guideReceipt: receipt }), 'ci-pr').reasons.join(), /not guide-only: docs\/sdlc\.md/);

  const renamed = guideOnlyWorld();
  renamed.files.push({ filename: 'docs/build_guide.py', previous_filename: 'docs/work-guide/work/build_guide.py', status: 'renamed' });
  assertUnresolved(await preflight(renamed, { guideReceipt: receipt, guideRecord: guideRecord(renamed) }), 'ci-pr', /missing/);

  const ran = guideOnlyWorld();
  ran.checkRuns[HEAD] = [checkRun(EXPECTED_JOBS[0], HEAD, 9001)];
  ran.checkSuites[HEAD] = [suite(9001, HEAD, 'claude/gh-700-example')];
  assertUnresolved(await preflight(ran, { guideReceipt: receipt, guideRecord: guideRecord(ran) }), 'ci-pr', /Depot runs exist/);
});

test('guide-only: a receipt for other HTML, a failed check or missing retained files are unresolved', async t => {
  const other = writeGuideEvidence(scratch(t), { html: Buffer.from('other') });
  const world = guideOnlyWorld();
  assertUnresolved(await preflight(world, { guideReceipt: other, guideRecord: guideRecord(world) }), 'ci-pr', /does not match the candidate's committed guide HTML/);
  const failed = writeGuideEvidence(scratch(t), { overrides: { navigation: 'failed' } });
  assertUnresolved(await preflight(world, { guideReceipt: failed, guideRecord: guideRecord(world) }), 'ci-pr', /navigation: failed/);
  const errors = writeGuideEvidence(scratch(t), { errors: ['broken link'] });
  assertUnresolved(await preflight(world, { guideReceipt: errors, guideRecord: guideRecord(world) }), 'ci-pr', /errors/);
  const bare = writeGuideEvidence(scratch(t), { screenshots: false, print: false });
  assertUnresolved(await preflight(world, { guideReceipt: bare, guideRecord: guideRecord(world) }), 'ci-pr', /screenshots.*print check/);
  const good = writeGuideEvidence(scratch(t));
  assertUnresolved(await preflight(world, { guideReceipt: good }), 'ci-pr', /record/);
  const vague = comment('Guide checks passed.');
  world.comments.push(vague);
  assertUnresolved(await preflight(world, { guideReceipt: good, guideRecord: vague.html_url }), 'ci-pr', /record does not name/);
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
  }
  assert.deepEqual(seen, []);
  await client.graphql('query Q { viewer { login } }').catch(() => {});
  await client.graphql('{ viewer { login } }').catch(() => {});
  await client.graphql('query Q { repository(owner: "mutation", name: "x") { id } }').catch(() => {});
  assert.equal(seen.length, 3, 'queries, including one with a string that looks like a keyword, still pass');
  assert.doesNotThrow(() => assertQueryOnly('query { a } # the word mutation in a comment is inert'));
  assert.throws(() => assertQueryOnly('query { a }\n# comment\nmutation { b }'), { name: 'ReadOnlyViolation' }, 'a comment cannot hide a second operation');
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
  await run(guide, { guideReceipt, guideRecord: guideRecord(guide) });
  const ui = cleanWorld();
  ui.files.push({ filename: 'apps/dashboard/src/main.tsx', status: 'modified' });
  const approval = comment(`approved ${HEAD}`);
  ui.comments.push(approval);
  await run(ui, { uiApproval: approval.html_url });
  for (const world of worlds) {
    assert.ok(world.requests.length > 5);
    for (const request of world.requests) {
      if (request.method === 'GET') {
        assert.equal(request.body, undefined);
        continue;
      }
      assert.equal(request.method, 'POST');
      assert.equal(request.url, 'https://api.github.com/graphql');
      assert.doesNotThrow(() => assertQueryOnly(request.body.query));
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
  assert.match(text, /Work guide \/ Work guide build and browser checks: missing/);
  assert.match(text, /not authorization/);
  assert.ok(text.split('\n').length < 60, text);
  assert.doesNotMatch(text, /Verdict: satisfied/, 'reviewer text stays in the linked report, not the preflight output');
});

test('the CLI reports usage errors with their own exit status', () => {
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--pr <number>/);
  for (const args of [[], ['--pr', 'abc'], ['--pr', '1', '--finish-line', 'moon'], ['--pr', '1', '--counterpart', 'nope'], ['--pr', '1', '--head', 'xyz'], ['--pr', '1', '--wat']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, GH_TOKEN: '' } });
    assert.equal(result.status, 3, `${args.join(' ')}: ${result.stderr}`);
  }
});

test('the CLI turns a missing credential into a read failure', () => {
  const result = spawnSync(process.execPath, [cli, '--pr', '1', '--json'], { encoding: 'utf8', env: { PATH: '/nonexistent', HOME: os.tmpdir() } });
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.result, 'read-failure');
  assert.match(report.readFailures[0].detail, /credential/);
});

