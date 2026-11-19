// The Runtime dashboard browser suite workflow (Hub #1942): which pushes run the full suite, how the runner reads the
// package script, how a failure on main reaches one issue, and the workflow's own shape. Fakes stand in for the GitHub
// API and for the journeys, so nothing here starts a browser or calls GitHub. The Workflow job runs this file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import { ISSUE_TITLE, SUITE, decideRun, journeys, report, runSelect, runSuite } from '../scripts/ci-selection/runtime-browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
const workflowFile = '.github/workflows/runtime-dashboard-browser.yml';
const workflow = YAML.parse(fs.readFileSync(path.join(root, workflowFile), 'utf8'));
const BEFORE = 'a'.repeat(40);
const AFTER = 'b'.repeat(40);
const TOKEN = 'token-value';
const REPO = 'jimmie-potts/agent-device-hub';

function directory(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gh1942-runtime-browser-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
}
const readOutputs = file => Object.fromEntries(fs.readFileSync(file, 'utf8').trim().split('\n').map(line => line.split(/=(.*)/s).slice(0, 2)));
const env = (extra = {}) => ({ GITHUB_REPOSITORY: REPO, GITHUB_API_URL: 'https://api.github.com', GITHUB_TOKEN: TOKEN, GITHUB_SHA: AFTER, ...extra });
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const compare = files => async () => json({ files: files.map(filename => ({ filename, status: 'modified' })) });
const push = (fetch, payload = {}) => decideRun({ event: 'push', payload: { before: BEFORE, after: AFTER, forced: false, ...payload }, env: env(), fetch });
const noRead = async () => assert.fail('this decision reads no comparison');

test('a push runs the suite exactly when the selector maps its changes to the runtime group', async () => {
  const requests = [];
  const recorded = files => async (url, init) => { requests.push({ url, init }); return compare(files)(); };
  for (const [files, run] of [
    [['apps/runtime/src/main.ts'], true],
    [['apps/runtime/dashboard/src/music.css'], true],
    [['modules/pixoo/src/module.ts'], true],
    [['scripts/a.mjs'], true],
    [['packages/sdk/src/index.ts'], true],
    [['an/unmapped/path.txt'], true],
    [['README.md', 'docs/work-guide/a.md'], false],
    [['openspec/specs/a/spec.md'], false],
    [['apps/chompi-bridge/src/bridge.ts', 'firmware/src/main.c'], false],
    [['modules/bb8/src/a.ts'], false],
    [[], true],
  ]) {
    const decision = await push(recorded(files));
    assert.equal(decision.run, run, files.join() || 'no files');
    assert.match(decision.reason, run ? /select the runtime group/ : /do not select the runtime group/);
  }
  assert.equal(requests[0].url, `https://api.github.com/repos/${REPO}/compare/${BEFORE}...${AFTER}`);
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[0].init.headers.authorization, `Bearer ${TOKEN}`);
  // A rename counts both paths, as the selector does for a pull request.
  const renamed = await push(async () => json({ files: [{ filename: 'docs/a.md', previous_filename: 'apps/runtime/a.md', status: 'renamed' }] }));
  assert.equal(renamed.run, false, 'Markdown on both sides of a rename selects nothing');
  const moved = await push(async () => json({ files: [{ filename: 'docs/a.ts', previous_filename: 'apps/runtime/src/a.ts', status: 'renamed' }] }));
  assert.equal(moved.run, true, 'a path moved out of the runtime still selects it');
});

test('a push whose changes are not known exactly runs the suite', async () => {
  assert.deepEqual(await push(noRead, { before: '0'.repeat(40) }), { run: true, reason: 'the push names no earlier revision to compare' });
  assert.equal((await push(noRead, { before: undefined })).run, true);
  assert.deepEqual(await push(noRead, { forced: true }), { run: true, reason: 'a force push is not compared, because it may replace revisions' });
  for (const [label, fetch, reason] of [
    ['HTTP error', async () => json({}, 404), /HTTP 404/],
    ['network error', async () => { throw new Error('getaddrinfo ENOTFOUND api.github.com'); }, /ENOTFOUND/],
    ['no file list', async () => json({}), /no file list/],
    ['300 files', compare(Array.from({ length: 300 }, (_, n) => `docs/f${n}.md`)), /300 files/],
  ]) {
    const decision = await push(fetch);
    assert.equal(decision.run, true, label);
    assert.match(decision.reason, reason, label);
    assert.doesNotMatch(decision.reason, new RegExp(TOKEN), label);
  }
});

test('pull requests and manual runs always run the suite; other events and mismatched revisions are refused', async () => {
  for (const event of ['pull_request', 'workflow_dispatch']) assert.equal((await decideRun({ event, payload: null, env: env(), fetch: noRead })).run, true, event);
  await assert.rejects(decideRun({ event: 'schedule', payload: null, env: env(), fetch: noRead }), /unsupported event/);
  await assert.rejects(decideRun({ event: 'push', payload: { before: BEFORE, after: 'c'.repeat(40) }, env: env(), fetch: noRead }), /this run's revision/);
  await assert.rejects(decideRun({ event: 'push', payload: { before: BEFORE }, env: env(), fetch: noRead }), /this run's revision/);
});

test('the select step writes its decision and a summary without the token', async t => {
  const folder = directory(t);
  const eventPath = path.join(folder, 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify({ before: BEFORE, after: AFTER, forced: false }));
  const files = { GITHUB_OUTPUT: path.join(folder, 'output'), GITHUB_STEP_SUMMARY: path.join(folder, 'summary'), GITHUB_EVENT_PATH: eventPath };
  const decision = await runSelect({ env: env({ GITHUB_EVENT_NAME: 'push', ...files }), fetch: compare(['README.md']) });
  assert.equal(decision.run, false);
  assert.deepEqual(readOutputs(files.GITHUB_OUTPUT), { run: 'false' });
  const summary = fs.readFileSync(files.GITHUB_STEP_SUMMARY, 'utf8');
  assert.match(summary, /^### Runtime dashboard browser suite: not run\n\nthe pushed changes do not select the runtime group \(no group\)\.\n$/);
  assert.doesNotMatch(summary, new RegExp(TOKEN));
  fs.rmSync(files.GITHUB_OUTPUT);
  // A pull request does not read its event file or the comparison.
  assert.equal((await runSelect({ env: env({ GITHUB_EVENT_NAME: 'pull_request', ...files, GITHUB_EVENT_PATH: path.join(folder, 'missing.json') }), fetch: noRead })).run, true);
  assert.deepEqual(readOutputs(files.GITHUB_OUTPUT), { run: 'true' });
});

test('the runner reads every journey of the package script, in order, and refuses any other shell form', () => {
  const list = journeys(scripts[SUITE]);
  // The chain runs exactly the commands the package script runs: rebuilding it from the journeys gives the script back.
  assert.equal(list.map(item => [item.command, ...item.args].join(' ')).join(' && '), scripts[SUITE]);
  assert.ok(list.length >= 20, `${list.length} journeys`);
  assert.equal(list[0].name, 'browser.ts');
  assert.ok(list.some(item => item.name === 'test:microduck:browser'));
  assert.equal(new Set(list.map(item => item.name)).size, list.length, 'each journey has its own name');
  for (const command of ['', 'node a.ts || node b.ts', 'node a.ts; node b.ts', 'node a.ts | tee x', 'node "a b.ts"', 'node a.ts --flag',
    'npm run a && rm -rf x', 'node a.ts &&  node b.ts', 'node a.js']) {
    assert.throws(() => journeys(command), /no test:runtime-dashboard:browser script|does not read/, JSON.stringify(command));
  }
});

test('the runner stops at the first failing journey and names it for the report', t => {
  const folder = directory(t);
  const output = path.join(folder, 'output');
  const chain = 'node apps/runtime/dashboard/tests/a.ts && npm run test:b:browser && node apps/runtime/dashboard/tests/c.ts';
  const quiet = t.mock.method(console, 'log', () => {});
  for (const [label, results, code, journey, ran] of [
    ['all pass', [{ status: 0 }, { status: 0 }, { status: 0 }], 0, undefined, 3],
    ['second fails', [{ status: 0 }, { status: 1 }], 1, 'test:b:browser', 2],
    ['killed', [{ status: null, signal: 'SIGKILL' }], 1, 'a.ts', 1],
    ['cannot start', [{ status: null, error: new Error('ENOENT') }], 1, 'a.ts', 1],
  ]) {
    fs.rmSync(output, { force: true });
    const calls = [];
    const spawn = (command, args, options) => { calls.push([command, ...args]); assert.equal(options.stdio, 'inherit'); return results[calls.length - 1]; };
    assert.equal(runSuite({ env: { GITHUB_OUTPUT: output }, spawn, scripts: { [SUITE]: chain } }), code, label);
    assert.equal(calls.length, ran, label);
    assert.deepEqual(calls[0], ['node', 'apps/runtime/dashboard/tests/a.ts'], label);
    if (ran > 1) assert.deepEqual(calls[1], ['npm', 'run', 'test:b:browser'], label);
    assert.deepEqual(fs.existsSync(output) ? readOutputs(output) : {}, journey ? { journey } : {}, label);
  }
  assert.ok(quiet.mock.calls.some(call => /::error title=Runtime dashboard browser suite::test:b:browser exited with status 1/.test(call.arguments[0])));
  assert.throws(() => runSuite({ env: {}, spawn: () => assert.fail('nothing runs'), scripts: {} }), /no test:runtime-dashboard:browser script/);
});

// A fake GitHub API: pages of open issues, then the one write the report makes.
function github(pages, { status = {}, created = 4242 } = {}) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const { pathname, searchParams } = new URL(url);
    const key = `${init.method} ${pathname}`;
    if (status[key]) return json({}, status[key]);
    if (key === `GET /repos/${REPO}/issues`) return json(pages[Number(searchParams.get('page')) - 1] ?? []);
    if (init.method === 'POST' && pathname === `/repos/${REPO}/issues`) return json({ number: created }, 201);
    if (init.method === 'POST' && /\/issues\/\d+\/comments$/.test(pathname)) return json({ id: 1 }, 201);
    return json({}, 404);
  };
  return { fetch, requests };
}
const failed = (extra = {}) => env({
  GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_SERVER_URL: 'https://github.com', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2',
  SUITE_RESULT: 'failure', FAILED_JOURNEY: 'controls.browser.ts', ...extra,
});
const filler = (count, from = 1) => Array.from({ length: count }, (_, n) => ({ number: from + n, title: `Other issue ${from + n}` }));
const facts = journey => `- Commit: ${AFTER}\n- Run: https://github.com/${REPO}/actions/runs/123/attempts/2\n- Failing journey: ${journey}\n`;

test('a failure on main comments on the open issue with the fixed title, found on any page', async () => {
  // A pull request with the title and a near-miss title are older, so picking either would show here.
  const page2 = [{ number: 700, title: ISSUE_TITLE, pull_request: {} }, { number: 777, title: ISSUE_TITLE }, { number: 501, title: `${ISSUE_TITLE}!` }, ...filler(3, 200)];
  const { fetch, requests } = github([filler(100), page2]);
  assert.deepEqual(await report({ env: failed(), fetch }), { action: 'commented', number: 777 });
  assert.deepEqual(requests.map(item => `${item.method} ${item.url}`), [
    `GET https://api.github.com/repos/${REPO}/issues?state=open&per_page=100&page=1`,
    `GET https://api.github.com/repos/${REPO}/issues?state=open&per_page=100&page=2`,
    `POST https://api.github.com/repos/${REPO}/issues/777/comments`,
  ]);
  assert.deepEqual(requests[2].body, { body: `The runtime dashboard browser suite failed again on main.\n\n${facts('`controls.browser.ts`')}` });
  assert.ok(requests.every(item => item.headers.authorization === `Bearer ${TOKEN}`));
  // Two open issues with the title: the older one collects the comments.
  const twice = github([[{ number: 812, title: ISSUE_TITLE }, { number: 811, title: ISSUE_TITLE }]]);
  assert.deepEqual(await report({ env: failed(), fetch: twice.fetch }), { action: 'commented', number: 811 });
});

test('a failure on main opens the issue when none is open, naming only the commit, run and journey', async () => {
  const { fetch, requests } = github([filler(100), filler(100, 101), []]);
  assert.deepEqual(await report({ env: failed({ FAILED_JOURNEY: 'test:art:browser' }), fetch }), { action: 'opened', number: 4242 });
  assert.equal(requests.length, 4);
  const create = requests.at(-1);
  assert.equal(`${create.method} ${create.url}`, `POST https://api.github.com/repos/${REPO}/issues`);
  assert.deepEqual(Object.keys(create.body).sort(), ['body', 'title'], 'no labels, assignees or milestones');
  assert.equal(create.body.title, ISSUE_TITLE);
  assert.equal(create.body.body, 'The runtime dashboard browser suite failed after a push to main. The Runtime dashboard browser suite workflow '
    + '(`.github/workflows/runtime-dashboard-browser.yml`) opened this issue and comments on it while it stays open.\n\n' + facts('`test:art:browser`'));
  assert.equal(create.headers['content-type'], 'application/json');
});

test('a failure outside a journey, or an unexpected journey value, records no journey name', async () => {
  for (const journey of [undefined, '', 'two words', '`x`', 'a\nb', '-flag', 'x'.repeat(121)]) {
    const { fetch, requests } = github([[]]);
    await report({ env: failed({ SUITE_RESULT: 'cancelled', FAILED_JOURNEY: journey }), fetch });
    assert.match(requests.at(-1).body.body, /- Failing journey: none recorded \(the job failed outside a journey or reached its time limit\)\n$/, JSON.stringify(journey));
  }
});

test('pull requests, manual runs, other branches and passing suites file nothing', async () => {
  for (const extra of [
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/1/merge' },
    { GITHUB_EVENT_NAME: 'workflow_dispatch' },
    { GITHUB_REF: 'refs/heads/other' },
    { SUITE_RESULT: 'success' },
  ]) {
    assert.equal((await report({ env: failed(extra), fetch: async () => assert.fail('no GitHub call') })).action, 'none', JSON.stringify(extra));
  }
});

test('the report fails loudly, without the token, when it cannot read, write or identify the run', async () => {
  for (const [label, fake, pattern] of [
    ['list fails', github([], { status: { [`GET /repos/${REPO}/issues`]: 502 } }), /GET \/repos\/jimmie-potts\/agent-device-hub\/issues failed: HTTP 502/],
    ['comment fails', github([[{ number: 9, title: ISSUE_TITLE }]], { status: { [`POST /repos/${REPO}/issues/9/comments`]: 403 } }), /HTTP 403/],
    ['create fails', github([[]], { status: { [`POST /repos/${REPO}/issues`]: 410 } }), /HTTP 410/],
    ['too many pages', github(Array.from({ length: 50 }, (_, n) => filler(100, n * 100 + 1))), /more than 5000 open issues/],
  ]) {
    await assert.rejects(report({ env: failed(), fetch: fake.fetch }), error => pattern.test(error.message) && !error.message.includes(TOKEN), label);
  }
  for (const extra of [{ GITHUB_SHA: 'nope' }, { GITHUB_RUN_ID: '' }, { GITHUB_RUN_ATTEMPT: '0' }, { GITHUB_REPOSITORY: 'a/b/c' }]) {
    await assert.rejects(report({ env: failed(extra), fetch: async () => assert.fail('no GitHub call') }), /does not name its revision/, JSON.stringify(extra));
  }
});

test('the workflow runs after main pushes, by hand and on pull requests that change it, and never cancels a run', () => {
  assert.equal(workflow.name, 'Runtime dashboard browser suite');
  assert.deepEqual(workflow.on, {
    push: { branches: ['main'] },
    pull_request: { types: ['opened', 'synchronize', 'reopened', 'ready_for_review'], paths: [workflowFile, 'scripts/ci-selection/runtime-browser.mjs'] },
    workflow_dispatch: {},
  });
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(workflow.concurrency, {
    group: 'runtime-dashboard-browser-${{ github.event_name }}-${{ github.event.pull_request.number || github.sha }}',
    'cancel-in-progress': false,
  });
  assert.deepEqual(Object.keys(workflow.jobs), ['suite', 'report']);
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job['runs-on'], 'ubuntu-latest');
    assert.equal(job.concurrency, undefined);
    assert.equal(job['continue-on-error'], undefined);
    assert.ok(Number.isInteger(job['timeout-minutes']) && job['timeout-minutes'] > 0);
    for (const step of job.steps) {
      assert.equal(step['continue-on-error'], undefined);
      if (step.uses) assert.match(step.uses, /^actions\/(checkout|setup-node)@[0-9a-f]{40}$/, 'actions are pinned by commit');
      if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false, 'no job keeps the token in Git');
    }
  }
  // The pinned actions are the ones the other workflows use.
  const checks = fs.readFileSync(path.join(root, '.github/workflows/checks.yml'), 'utf8');
  for (const step of Object.values(workflow.jobs).flatMap(job => job.steps).filter(item => item.uses)) assert.ok(checks.includes(step.uses), step.uses);
});

test('the suite job runs the whole suite under a finite limit only when selected', () => {
  const job = workflow.jobs.suite;
  assert.equal(job.name, 'Runtime dashboard browser suite on ubuntu-latest');
  assert.equal(job.if, "github.event_name != 'pull_request' || !github.event.pull_request.draft");
  assert.equal(job.permissions, undefined, 'the suite job keeps the workflow\'s read-only token');
  assert.equal(job['timeout-minutes'], 60);
  assert.deepEqual(job.outputs, { journey: '${{ steps.suite.outputs.journey }}' });
  assert.deepEqual(job.env, { XDG_RUNTIME_DIR: '', DBUS_SESSION_BUS_ADDRESS: '' });
  const selected = "steps.select.outputs.run == 'true'";
  assert.deepEqual(job.steps.filter(step => step.run).map(step => [step.if ?? null, step.run]), [
    [null, 'node scripts/ci-selection/runtime-browser.mjs select'],
    [selected, 'npm ci'],
    [selected, 'bash scripts/apt-retry.sh 300 npx playwright install --with-deps chromium'],
    [selected, 'npm run build'],
    [selected, 'node scripts/ci-selection/runtime-browser.mjs run'],
  ]);
  assert.deepEqual(job.steps.find(step => step.id === 'select').env, { GITHUB_TOKEN: '${{ github.token }}' });
  assert.equal(job.steps.find(step => /playwright install/.test(step.run ?? ''))['timeout-minutes'], 20);
  assert.equal(job.steps.filter(step => step['timeout-minutes'] !== undefined).length, 1, 'only the Chromium install has a step limit');
  assert.equal(job.steps.find(step => step.id === 'suite').if, selected);
});

test('only the report job can write issues, and it runs after every suite result', () => {
  const job = workflow.jobs.report;
  assert.equal(job.name, 'Report runtime dashboard browser failures');
  assert.equal(job.needs, 'suite');
  assert.equal(job.if, 'always()');
  assert.deepEqual(job.permissions, { contents: 'read', issues: 'write' });
  assert.equal(job['timeout-minutes'], 5);
  assert.deepEqual(job.steps.filter(step => step.run), [{
    env: { GITHUB_TOKEN: '${{ github.token }}', SUITE_RESULT: '${{ needs.suite.result }}', FAILED_JOURNEY: '${{ needs.suite.outputs.journey }}' },
    run: 'node scripts/ci-selection/runtime-browser.mjs report',
  }]);
  assert.equal(job.steps[0].with['sparse-checkout'], 'scripts/ci-selection', 'the report job installs and runs no product code');
});
