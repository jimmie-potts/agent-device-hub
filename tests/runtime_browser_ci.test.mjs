// The Runtime dashboard browser suite workflow (Hub #1942): which pushes run the full suite, how the runner reads the
// package scripts and their journey groups (#2015), how a failure on main reaches one issue, and the workflow's own
// shape. Fakes stand in for the GitHub API and for the journeys, so nothing here starts a browser or calls GitHub. The
// Workflow job runs this file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import { ISSUE_AUTHOR, ISSUE_TITLE, SUITE, decideRun, groupResults, groups, journeys, report, runSelect, runSuite, suiteOutputs } from '../scripts/ci-selection/runtime-browser.mjs';

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

test('the runner reads every journey of the package scripts, in order, and refuses any other shell form', () => {
  const list = groups(scripts);
  // The suite runs exactly its groups' scripts, and each group exactly the commands its script runs: rebuilding them
  // from the groups and journeys gives the scripts back.
  assert.equal(list.map(group => `npm run ${SUITE}:${group.name}`).join(' && '), scripts[SUITE]);
  for (const group of list) assert.equal(group.journeys.map(item => [item.command, ...item.args].join(' ')).join(' && '), scripts[`${SUITE}:${group.name}`]);
  const all = list.flatMap(group => group.journeys);
  assert.ok(all.length >= 29, `${all.length} journeys`);
  assert.equal(all[0].name, 'browser.ts');
  assert.ok(all.some(item => item.name === 'test:microduck:browser'));
  assert.equal(new Set(all.map(item => item.name)).size, all.length, 'each journey has its own name');
  assert.deepEqual(groups(scripts), list, 'the same scripts give the same groups');
  for (const command of ['', 'node a.ts || node b.ts', 'node a.ts; node b.ts', 'node a.ts | tee x', 'node "a b.ts"', 'node a.ts --flag',
    'npm run a && rm -rf x', 'node a.ts &&  node b.ts', 'node a.js', `npm run ${SUITE}`, `npm run ${SUITE}:2`]) {
    assert.throws(() => journeys(command), /no test:runtime-dashboard:browser script|does not read/, JSON.stringify(command));
  }
});

test('every journey belongs to exactly one group, and the suite script names only its groups', () => {
  const a = 'node apps/runtime/dashboard/tests/a.ts';
  const b = 'node apps/runtime/dashboard/tests/b.ts';
  const suite = (command, extra = {}) => ({ [SUITE]: command, [`${SUITE}:1`]: a, [`${SUITE}:2`]: b, ...extra });
  assert.deepEqual(groups(suite(`npm run ${SUITE}:1 && npm run ${SUITE}:2`)).map(group => [group.name, group.journeys.map(item => item.name)]),
    [['1', ['a.ts']], ['2', ['b.ts']]]);
  for (const [label, fixture, pattern] of [
    ['no suite', {}, /no test:runtime-dashboard:browser script/],
    ['a journey outside a group', suite(`npm run ${SUITE}:1 && ${b}`), /does not read as a group/],
    ['an ordinary script', suite('npm run test:art:browser'), /does not read as a group/],
    ['group 0', suite(`npm run ${SUITE}:0`, { [`${SUITE}:0`]: a }), /does not read as a group/],
    ['a named group', suite(`npm run ${SUITE}:home`, { [`${SUITE}:home`]: a }), /does not read as a group/],
    ['a missing group script', suite(`npm run ${SUITE}:3`), /no test:runtime-dashboard:browser:3 script/],
    ['a group twice', suite(`npm run ${SUITE}:1 && npm run ${SUITE}:1`), /names a group more than once/],
    ['a journey in two groups', suite(`npm run ${SUITE}:1 && npm run ${SUITE}:2`, { [`${SUITE}:2`]: `${b} && ${a}` }), /a\.ts is in group 1 and group 2/],
    ['a journey twice in one group', suite(`npm run ${SUITE}:1`, { [`${SUITE}:1`]: `${a} && ${a}` }), /a\.ts is in group 1 and group 1/],
    ['a group that runs another', suite(`npm run ${SUITE}:1 && npm run ${SUITE}:2`, { [`${SUITE}:2`]: `npm run ${SUITE}:1` }), /test:runtime-dashboard:browser:2 has a command/],
  ]) {
    assert.throws(() => groups(fixture), pattern, label);
  }
});

test('no journey of the suite also runs another of its journeys, so each runs once', () => {
  // Before #2015 browser.ts imported six journeys at its end; they are separate entries now, so no file may chain one.
  const files = groups(scripts).flatMap(group => group.journeys).filter(item => item.command === 'node').map(item => item.args[0]);
  const entries = new Set(files.map(file => path.basename(file)));
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [, imported] of text.matchAll(/import\(\s*'\.\/([\w.-]+)'\s*\)/g)) assert.ok(!entries.has(imported), `${file} also runs ${imported}`);
  }
});

const CHAIN = {
  [SUITE]: `npm run ${SUITE}:1 && npm run ${SUITE}:2 && npm run ${SUITE}:3`,
  [`${SUITE}:1`]: 'node apps/runtime/dashboard/tests/a.ts && npm run test:b:browser',
  [`${SUITE}:2`]: 'node apps/runtime/dashboard/tests/c.ts',
  [`${SUITE}:3`]: 'node apps/runtime/dashboard/tests/d.ts && node apps/runtime/dashboard/tests/e.ts',
};

test('the runner runs one group, stopping at its first failing journey, and records the group\'s result', t => {
  const folder = directory(t);
  const output = path.join(folder, 'output');
  const quiet = t.mock.method(console, 'log', () => {});
  for (const [label, group, results, code, outputs, ran] of [
    ['all pass', '1', [{ status: 0 }, { status: 0 }], 0, { passed_1: 'true' }, ['a.ts', 'test:b:browser']],
    ['second fails', '1', [{ status: 0 }, { status: 1 }], 1, { journey_1: 'test:b:browser' }, ['a.ts', 'test:b:browser']],
    ['killed', '3', [{ status: null, signal: 'SIGKILL' }], 1, { journey_3: 'd.ts' }, ['d.ts']],
    ['cannot start', '2', [{ status: null, error: new Error('ENOENT') }], 1, { journey_2: 'c.ts' }, ['c.ts']],
    ['every group', undefined, [0, 0, 0, 0, 0].map(() => ({ status: 0 })), 0, { passed_1: 'true', passed_2: 'true', passed_3: 'true' },
      ['a.ts', 'test:b:browser', 'c.ts', 'd.ts', 'e.ts']],
    ['every group, stopping at a failure', undefined, [{ status: 0 }, { status: 0 }, { status: 1 }], 1, { passed_1: 'true', journey_2: 'c.ts' },
      ['a.ts', 'test:b:browser', 'c.ts']],
  ]) {
    fs.rmSync(output, { force: true });
    const calls = [];
    const spawn = (command, args, options) => { calls.push([command, ...args]); assert.equal(options.stdio, 'inherit'); return results[calls.length - 1]; };
    assert.equal(runSuite({ env: { GITHUB_OUTPUT: output }, spawn, scripts: CHAIN, group }), code, label);
    assert.deepEqual(calls.map(call => call.at(-1).split('/').at(-1)), ran, label);
    if (ran.includes('test:b:browser')) assert.deepEqual(calls[1], ['npm', 'run', 'test:b:browser'], label);
    assert.deepEqual(fs.existsSync(output) ? readOutputs(output) : {}, outputs, label);
  }
  assert.ok(quiet.mock.calls.some(call => /::error title=Runtime dashboard browser suite::test:b:browser exited with status 1/.test(call.arguments[0])));
  assert.ok(quiet.mock.calls.some(call => call.arguments[0] === '\nJourney 2 of 2, group 1: test:b:browser'));
  assert.throws(() => runSuite({ env: {}, spawn: () => assert.fail('nothing runs'), scripts: {} }), /no test:runtime-dashboard:browser script/);
  assert.throws(() => runSuite({ env: {}, spawn: () => assert.fail('nothing runs'), scripts: CHAIN, group: '4' }), /has no group "4"; its groups are 1, 2, 3/);
  assert.throws(() => runSuite({ env: {}, spawn: () => assert.fail('nothing runs'), scripts: CHAIN, group: '' }), /has no group ""/);
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
// The suite job's outputs as `toJSON(needs.suite.outputs)` gives them: group 2 recorded a failing journey.
const outputs = (values = { passed_1: 'true', journey_2: 'c.ts', passed_3: 'true' }) => JSON.stringify(values);
const failed = (extra = {}) => env({
  GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_SERVER_URL: 'https://github.com', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2',
  SUITE_RESULT: 'failure', SUITE_OUTPUTS: outputs(), ...extra,
});
const filed = options => report({ scripts: CHAIN, ...options });
const bot = { login: ISSUE_AUTHOR, type: 'Bot' };
const filler = (count, from = 1) => Array.from({ length: count }, (_, n) => ({ number: from + n, title: `Other issue ${from + n}` }));
const NONE = 'none recorded (the group failed outside a journey or reached its time limit)';
const facts = (...lines) => `- Commit: ${AFTER}\n- Run: https://github.com/${REPO}/actions/runs/123/attempts/2\n${lines.map(line => `${line}\n`).join('')}`;

test('a failure on main comments on the open issue with the fixed title, found on any page', async () => {
  // A pull request with the title, a near-miss title and a same-title issue by someone else are older, so picking any
  // of them would show here.
  const page2 = [{ number: 700, title: ISSUE_TITLE, pull_request: {}, user: bot }, { number: 777, title: ISSUE_TITLE, user: bot },
    { number: 501, title: `${ISSUE_TITLE}!`, user: bot }, { number: 450, title: ISSUE_TITLE, user: { login: 'someone-else' } },
    { number: 440, title: ISSUE_TITLE }, ...filler(3, 200)];
  const { fetch, requests } = github([filler(100), page2]);
  assert.deepEqual(await filed({ env: failed(), fetch }), { action: 'commented', number: 777 });
  assert.deepEqual(requests.map(item => `${item.method} ${item.url}`), [
    `GET https://api.github.com/repos/${REPO}/issues?state=open&per_page=100&page=1`,
    `GET https://api.github.com/repos/${REPO}/issues?state=open&per_page=100&page=2`,
    `POST https://api.github.com/repos/${REPO}/issues/777/comments`,
  ]);
  assert.deepEqual(requests[2].body, { body: `The runtime dashboard browser suite failed again on main.\n\n${facts('- Failing journey in group 2: `c.ts`')}` });
  assert.ok(requests.every(item => item.headers.authorization === `Bearer ${TOKEN}`));
  // Two open issues with the title: the older one collects the comments.
  const twice = github([[{ number: 812, title: ISSUE_TITLE, user: bot }, { number: 811, title: ISSUE_TITLE, user: bot }]]);
  assert.deepEqual(await filed({ env: failed(), fetch: twice.fetch }), { action: 'commented', number: 811 });
});

test('a failure on main opens the issue when none is open, naming only the commit, run and journey', async () => {
  const { fetch, requests } = github([filler(100), filler(100, 101), []]);
  assert.deepEqual(await filed({ env: failed({ SUITE_OUTPUTS: outputs({ journey_1: 'test:b:browser', passed_2: 'true', passed_3: 'true' }) }), fetch }), { action: 'opened', number: 4242 });
  assert.equal(requests.length, 4);
  const create = requests.at(-1);
  assert.equal(`${create.method} ${create.url}`, `POST https://api.github.com/repos/${REPO}/issues`);
  assert.deepEqual(Object.keys(create.body).sort(), ['body', 'title'], 'no labels, assignees or milestones');
  assert.equal(create.body.title, ISSUE_TITLE);
  assert.equal(create.body.body, 'The runtime dashboard browser suite failed after a push to main. The Runtime dashboard browser suite workflow '
    + '(`.github/workflows/runtime-dashboard-browser.yml`) opened this issue and comments on it while it stays open.\n\n'
    + facts('- Failing journey in group 1: `test:b:browser`'));
  assert.equal(create.headers['content-type'], 'application/json');
});

test('a same-title issue opened by anyone else is ignored, so the workflow opens its own', async () => {
  assert.equal(ISSUE_AUTHOR, 'github-actions[bot]', 'the login of issues the GITHUB_TOKEN opens');
  const { fetch, requests } = github([[{ number: 12, title: ISSUE_TITLE, user: { login: 'someone-else', type: 'User' } },
    { number: 13, title: ISSUE_TITLE, user: { login: 'github-actions', type: 'User' } }]]);
  assert.deepEqual(await filed({ env: failed(), fetch }), { action: 'opened', number: 4242 });
  assert.equal(`${requests.at(-1).method} ${requests.at(-1).url}`, `POST https://api.github.com/repos/${REPO}/issues`);
});

test('the report names every group\'s failing journey, and records none for a group that failed outside a journey', async () => {
  for (const [label, values, lines] of [
    ['two groups failed', { journey_1: 'a.ts', passed_2: 'true', journey_3: 'e.ts' }, ['- Failing journey in group 1: `a.ts`', '- Failing journey in group 3: `e.ts`']],
    ['a group with no record', { passed_1: 'true', journey_2: 'c.ts' }, ['- Failing journey in group 2: `c.ts`', `- Failing journey in group 3: ${NONE}`]],
    ['no outputs', {}, [1, 2, 3].map(group => `- Failing journey in group ${group}: ${NONE}`)],
    ['every group passed', { passed_1: 'true', passed_2: 'true', passed_3: 'true' }, ['- Failing journey: none recorded (every group recorded a pass)']],
    ['another group\'s journey', { passed_1: 'true', journey_2: 'a.ts', passed_3: 'true' }, [`- Failing journey in group 2: ${NONE}`]],
    ['a pass that is not true', { passed_1: 'yes', passed_2: 'true', passed_3: 'true' }, [`- Failing journey in group 1: ${NONE}`]],
  ]) {
    const { fetch, requests } = github([[]]);
    await filed({ env: failed({ SUITE_RESULT: 'cancelled', SUITE_OUTPUTS: outputs(values) }), fetch });
    assert.equal(requests.at(-1).body.body.split('\n\n').at(-1), facts(...lines), label);
  }
  for (const journey of [undefined, '', 'two words', '`x`', 'a\nb', '-flag', 'x'.repeat(121), 7]) {
    const { fetch, requests } = github([[]]);
    await filed({ env: failed({ SUITE_OUTPUTS: outputs({ passed_1: 'true', journey_2: journey, passed_3: 'true' }) }), fetch });
    assert.match(requests.at(-1).body.body, new RegExp(`- Failing journey in group 2: ${NONE.replace(/[()]/g, '\\$&')}\n$`), JSON.stringify(journey));
  }
  for (const text of [undefined, '', 'not json', '[]', 'null', '"x"']) {
    const { fetch, requests } = github([[]]);
    await filed({ env: failed({ SUITE_OUTPUTS: text }), fetch });
    assert.match(requests.at(-1).body.body, new RegExp(`- Failing journey in group 3: ${NONE.replace(/[()]/g, '\\$&')}\n$`), JSON.stringify(text));
  }
});

test('negative control: a failing journey in one group is reported by name while the other groups finish', async t => {
  // The three groups run as separate jobs, each with its own output file; one journey of group 2 fails.
  const folder = directory(t);
  t.mock.method(console, 'log', () => {});
  const ran = [];
  const merged = {};
  for (const group of ['1', '2', '3']) {
    const output = path.join(folder, `output-${group}`);
    const spawn = (command, args) => { ran.push(args.at(-1).split('/').at(-1)); return { status: args.at(-1).endsWith('c.ts') ? 1 : 0 }; };
    assert.equal(runSuite({ env: { GITHUB_OUTPUT: output }, spawn, scripts: CHAIN, group }), group === '2' ? 1 : 0, group);
    // A matrix job's outputs merge across its jobs; each group sets only its own keys.
    Object.assign(merged, readOutputs(output));
  }
  assert.deepEqual(ran, ['a.ts', 'test:b:browser', 'c.ts', 'd.ts', 'e.ts'], 'groups 1 and 3 run every journey');
  assert.deepEqual(merged, { passed_1: 'true', journey_2: 'c.ts', passed_3: 'true' });
  assert.deepEqual(groupResults(groups(CHAIN), suiteOutputs(JSON.stringify(merged))), [
    { name: '1', passed: true, journey: null }, { name: '2', passed: false, journey: 'c.ts' }, { name: '3', passed: true, journey: null }]);
  const { fetch, requests } = github([[]]);
  assert.deepEqual(await filed({ env: failed({ SUITE_OUTPUTS: JSON.stringify(merged) }), fetch }), { action: 'opened', number: 4242 });
  assert.ok(requests.at(-1).body.body.endsWith(facts('- Failing journey in group 2: `c.ts`')));
});

test('the report reads the groups from package.json when it files', async () => {
  const { fetch, requests } = github([[]]);
  const real = groups(scripts);
  const values = Object.fromEntries(real.map(group => [`passed_${group.name}`, 'true']));
  delete values.passed_2;
  values.journey_2 = real[1].journeys[0].name;
  await report({ env: failed({ SUITE_OUTPUTS: JSON.stringify(values) }), fetch });
  assert.ok(requests.at(-1).body.body.endsWith(facts(`- Failing journey in group 2: \`${real[1].journeys[0].name}\``)));
});

test('pull requests, manual runs, other branches and passing suites file nothing', async () => {
  for (const extra of [
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/1/merge' },
    { GITHUB_EVENT_NAME: 'workflow_dispatch' },
    { GITHUB_REF: 'refs/heads/other' },
    { SUITE_RESULT: 'success' },
  ]) {
    assert.equal((await filed({ env: failed(extra), fetch: async () => assert.fail('no GitHub call') })).action, 'none', JSON.stringify(extra));
  }
});

test('the report fails loudly, without the token, when it cannot read, write or identify the run', async () => {
  for (const [label, fake, pattern] of [
    ['list fails', github([], { status: { [`GET /repos/${REPO}/issues`]: 502 } }), /GET \/repos\/jimmie-potts\/agent-device-hub\/issues failed: HTTP 502/],
    ['comment fails', github([[{ number: 9, title: ISSUE_TITLE, user: bot }]], { status: { [`POST /repos/${REPO}/issues/9/comments`]: 403 } }), /HTTP 403/],
    ['create fails', github([[]], { status: { [`POST /repos/${REPO}/issues`]: 410 } }), /HTTP 410/],
    ['too many pages', github(Array.from({ length: 50 }, (_, n) => filler(100, n * 100 + 1))), /more than 5000 open issues/],
  ]) {
    await assert.rejects(filed({ env: failed(), fetch: fake.fetch }), error => pattern.test(error.message) && !error.message.includes(TOKEN), label);
  }
  for (const extra of [{ GITHUB_SHA: 'nope' }, { GITHUB_RUN_ID: '' }, { GITHUB_RUN_ATTEMPT: '0' }, { GITHUB_REPOSITORY: 'a/b/c' }]) {
    await assert.rejects(filed({ env: failed(extra), fetch: async () => assert.fail('no GitHub call') }), /does not name its revision/, JSON.stringify(extra));
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

test('the suite job runs every group in parallel, each under a finite limit and only when selected', () => {
  const job = workflow.jobs.suite;
  assert.equal(job.name, 'Runtime dashboard browser suite (group ${{ matrix.group }}) on ubuntu-latest');
  assert.equal(job.if, "github.event_name != 'pull_request' || !github.event.pull_request.draft");
  assert.equal(job.permissions, undefined, 'the suite job keeps the workflow\'s read-only token');
  assert.equal(job['timeout-minutes'], 60);
  // One job per group of the package scripts, and a failing group does not cancel the others.
  const names = groups(scripts).map(group => group.name);
  assert.deepEqual(job.strategy, { 'fail-fast': false, matrix: { group: names } });
  assert.deepEqual(job.outputs, Object.fromEntries(names.flatMap(name => ['passed', 'journey'].map(key => [`${key}_${name}`, `\${{ steps.suite.outputs.${key}_${name} }}`]))));
  assert.deepEqual(job.env, { XDG_RUNTIME_DIR: '', DBUS_SESSION_BUS_ADDRESS: '' });
  const selected = "steps.select.outputs.run == 'true'";
  assert.deepEqual(job.steps.filter(step => step.run).map(step => [step.if ?? null, step.run]), [
    [null, 'node scripts/ci-selection/runtime-browser.mjs select'],
    [selected, 'npm ci'],
    [selected, 'bash scripts/apt-retry.sh 300 npx playwright install --with-deps chromium'],
    [selected, 'npm run build'],
    [selected, 'node scripts/ci-selection/runtime-browser.mjs run "$SUITE_GROUP"'],
  ]);
  assert.deepEqual(job.steps.find(step => step.id === 'suite').env, { SUITE_GROUP: '${{ matrix.group }}' });
  assert.deepEqual(job.steps.find(step => step.id === 'select').env, { GITHUB_TOKEN: '${{ github.token }}' });
  assert.equal(job.steps.find(step => /playwright install/.test(step.run ?? ''))['timeout-minutes'], 20);
  assert.equal(job.steps.filter(step => step['timeout-minutes'] !== undefined).length, 1, 'only the Chromium install has a step limit');
  assert.equal(job.steps.find(step => step.id === 'suite').if, selected);
});

test('only the report job can write issues, and it runs once after every group\'s result', () => {
  const job = workflow.jobs.report;
  assert.equal(job.name, 'Report runtime dashboard browser failures');
  assert.equal(job.needs, 'suite');
  assert.equal(job.if, 'always()');
  assert.deepEqual(job.permissions, { contents: 'read', issues: 'write' });
  assert.equal(job['timeout-minutes'], 5);
  assert.deepEqual(job.steps.filter(step => step.run), [{
    env: { GITHUB_TOKEN: '${{ github.token }}', SUITE_RESULT: '${{ needs.suite.result }}', SUITE_OUTPUTS: '${{ toJSON(needs.suite.outputs) }}' },
    run: 'node scripts/ci-selection/runtime-browser.mjs report',
  }]);
  // A cone-mode sparse checkout also has the root files, where the report reads the groups from package.json.
  assert.equal(job.steps[0].with['sparse-checkout'], 'scripts/ci-selection', 'the report job installs and runs no product code');
  assert.equal(job.steps[0].with['sparse-checkout-cone-mode'], undefined);
});
