import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadOnlyViolation, createReadOnlyClient} from '../delivery-preflight/github.mjs';
import {collect, main, parseArguments, recordsCleanup, references, render, repository, rules} from '../tracker-audit.mjs';

const now = new Date('2026-11-06T18:00:00Z');
const ago = hours => new Date(now.getTime() - hours * 3_600_000).toISOString();
const url = number => `https://github.com/${repository}/issues/${number}`;
const issue = (number, labels, extra = {}) => ({number, title: `Issue ${number}`, html_url: url(number), labels: labels.map(name => ({name})), state: 'open', updated_at: ago(1), ...extra});
const pr = (number, mergedHoursAgo, body, extra = {}) => ({...issue(number, [], {state: 'closed', closed_at: ago(mergedHoursAgo), updated_at: ago(mergedHoursAgo), body, pull_request: {merged_at: ago(mergedHoursAgo)}}), ...extra});
const comment = (hoursAgo, body) => ({created_at: ago(hoursAgo), updated_at: ago(hoursAgo), body});
const commented = hoursAgo => ({event: 'commented', created_at: ago(hoursAgo)});
const crossReference = source => ({event: 'cross-referenced', source: {type: 'issue', issue: {...source, repository: {full_name: repository}}}});
const cleanup = 'Cleanup: the worktree and local branch were removed (readback absent); scratch, clone and staging not applicable.';

/** A fixture GitHub: list responses, timelines and comments keyed by issue number. Every request is recorded. */
function world({open = [], closed = [], timelines = {}, comments = {}, failing = new Set()}) {
  const requests = [];
  const transport = async request => {
    requests.push(request);
    const {pathname, searchParams} = new URL(request.url);
    const json = (status, value) => ({status, link: null, json: value});
    if (pathname === `/repos/${repository}/issues`) return json(200, searchParams.get('state') === 'open' ? open : closed);
    const match = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/(timeline|comments)$/.exec(pathname);
    if (!match) return json(404, {message: 'Not Found'});
    if (failing.has(Number(match[1]))) return json(502, {message: 'Bad Gateway'});
    if (match[2] === 'timeline') return json(200, timelines[match[1]] ?? []);
    const since = searchParams.get('since');
    return json(200, (comments[match[1]] ?? []).filter(item => !since || item.updated_at >= since));
  };
  return {client: createReadOnlyClient(transport), requests};
}

/** One example of each finding type, beside records that satisfy each rule. */
const findingsWorld = () => world({
  open: [
    issue(10, ['status:in-progress']),
    issue(11, []),
    issue(12, ['status:backlog', 'status:ready']),
    issue(13, ['idea']),
    issue(14, ['status:review'], {updated_at: ago(24 * 6)}),
    issue(15, ['status:review']),
    issue(16, ['status:in-progress']),
    {...issue(17, []), pull_request: {merged_at: null}},
  ],
  closed: [
    issue(20, ['status:review', 'blocked', 'bug'], {state: 'closed', closed_at: ago(5)}),
    issue(21, ['bug'], {state: 'closed', closed_at: ago(5)}),
    issue(22, ['status:ready'], {state: 'closed', closed_at: ago(100)}),
    pr(30, 4, 'Refs #10'),
    pr(31, 3, 'Refs #15, #16. Part of #13.'),
    pr(32, 200, 'Refs #16'),
  ],
  timelines: {
    10: [commented(10), crossReference(pr(30, 4, 'Refs #10')), crossReference(pr(33, 2, 'Mentions #10 in passing'))],
    15: [crossReference(pr(31, 3, 'Refs #15, #16. Part of #13.')), commented(2)],
    16: [commented(5), crossReference(pr(31, 3, 'Refs #15, #16. Part of #13.'))],
  },
  comments: {
    30: [comment(3, '## Review result\n\nStandards satisfied. The branch was rebased.')],
    10: [comment(20, cleanup)],
  },
});

test('arguments accept the window, the stale-review threshold and JSON', () => {
  assert.deepEqual(parseArguments([]), {hours: 72, staleReviewDays: 5, json: false});
  assert.deepEqual(parseArguments(['--hours', '24', '--stale-review-days', '3', '--json']), {hours: 24, staleReviewDays: 3, json: true});
  for (const args of [['--fix'], ['--hours'], ['--hours', '0'], ['--stale-review-days', 'soon'], ['--json', 'extra']]) assert.throws(() => parseArguments(args), /usage/);
});

test('a PR references only the issues its Refs or closing clause names in this repository', () => {
  const numbers = body => [...references(body)].sort((a, b) => a - b);
  assert.deepEqual(numbers('Refs #1272, #722, #40, #720'), [40, 720, 722, 1272]);
  assert.deepEqual(numbers('Refs #1486. Approved separate repair for #1457 and #1485.'), [1486]);
  assert.deepEqual(numbers('Refs #684. Part of #677.'), [684]);
  assert.deepEqual(numbers('Closes jimmie-potts/agent-device-hub#5 and #6\nfixes #7\nRefs: #8'), [5, 6, 7, 8]);
  assert.deepEqual(numbers('Refs other/repo#9, prefix #10, closes its endpoint #11'), []);
  assert.deepEqual(numbers(null), []);
});

test('the cleanup signal needs cleanup or a worktree and one of step 8\'s outcome words', () => {
  assert.ok(recordsCleanup(cleanup));
  assert.ok(recordsCleanup('**Cleanup:** not performed by this closure. The worktree is retained with the delivering session.'));
  assert.ok(recordsCleanup('The integration worktree and exact local branch were removed and verified absent.'));
  assert.ok(!recordsCleanup('Cleanup pending.'));
  assert.ok(!recordsCleanup('The flaky step was removed from the job.'));
  assert.ok(!recordsCleanup(undefined));
});

test('each finding type is reported with the rule it comes from', async () => {
  const {client, requests} = findingsWorld();
  const report = await collect(client, {hours: 72, staleReviewDays: 5}, now);
  const found = report.findings.map(item => `${item.type} #${item.number}`).sort();
  assert.deepEqual(found, [
    'cleanup-unrecorded #30',
    'cleanup-unrecorded #31',
    'closed-workflow-label #20',
    'merged-without-update #10',
    'merged-without-update #16',
    'stale-review #14',
    'status-label #11',
    'status-label #12',
  ]);
  for (const item of report.findings) assert.equal(item.rule, rules[item.type]);
  assert.match(report.findings.find(item => item.type === 'closed-workflow-label').detail, /keeps status:review, blocked/);
  assert.match(report.findings.find(item => item.number === 10).detail, /PR #30 merged/);
  assert.match(report.findings.find(item => item.number === 31).detail, /#15, #16/);
  assert.deepEqual(report.unknown, []);
  assert.ok(requests.length > 0 && requests.every(request => request.method === 'GET' && request.body === undefined), 'every request is a GET');
  const text = render(report);
  for (const rule of Object.values(rules)) assert.ok(text.includes(rule), rule);
  assert.match(text, /Read-only: nothing was written/);
});

test('a tracker that follows every rule is clean', async () => {
  const {client} = world({
    open: [issue(10, ['status:in-progress']), issue(13, ['idea']), issue(14, ['status:review'], {updated_at: ago(24 * 4)})],
    closed: [issue(20, ['bug'], {state: 'closed', closed_at: ago(5)}), pr(30, 4, 'Refs #10')],
    timelines: {10: [crossReference(pr(30, 4, 'Refs #10')), commented(3)], 14: [commented(24 * 4)]},
    comments: {10: [comment(3, cleanup)]},
  });
  const report = await collect(client, {hours: 72, staleReviewDays: 5}, now);
  assert.deepEqual(report.findings, []);
  const lines = [];
  assert.equal(await main({argv: [], client, now, write: text => lines.push(text)}), 0);
  assert.match(lines.join(''), /Closed issues that keep a workflow label: 0/);
});

test('exit status distinguishes findings, unreadable items, failed lists and usage', async () => {
  const quiet = {write: () => {}, error: () => {}};
  assert.equal(await main({argv: [], client: findingsWorld().client, now, ...quiet}), 1);
  const partial = world({open: [issue(10, ['status:review'])], timelines: {}, failing: new Set([10])});
  const report = await collect(partial.client, {hours: 72, staleReviewDays: 5}, now);
  assert.deepEqual(report.unknown.map(item => `${item.type} #${item.number}`), ['merged-without-update #10']);
  assert.equal(await main({argv: [], client: partial.client, now, ...quiet}), 2);
  const broken = createReadOnlyClient(async () => ({status: 500, link: null, json: {message: 'down'}}));
  assert.equal(await main({argv: [], client: broken, now, ...quiet}), 2);
  assert.equal(await main({argv: ['--close'], client: broken, now, ...quiet}), 3);
});

test('the audit\'s client refuses every tracker write before the transport sees it', async () => {
  const {client, requests} = world({});
  const issuePath = `/repos/${repository}/issues/10`;
  await assert.rejects(client.request('POST', `${issuePath}/comments`, {body: 'x'}), ReadOnlyViolation);
  await assert.rejects(client.request('PATCH', issuePath, {state: 'closed'}), ReadOnlyViolation);
  await assert.rejects(client.request('POST', `${issuePath}/labels`, {labels: ['status:review']}), ReadOnlyViolation);
  await assert.rejects(client.request('DELETE', `${issuePath}/labels/blocked`), ReadOnlyViolation);
  await assert.rejects(client.request('PUT', `/repos/${repository}/pulls/30/merge`, {}), ReadOnlyViolation);
  await assert.rejects(client.graphql('mutation { addComment(input: {subjectId: "x", body: "y"}) { clientMutationId } }'), ReadOnlyViolation);
  await assert.rejects(client.request('GET', 'https://example.com/repos'), ReadOnlyViolation);
  assert.deepEqual(requests, []);
});
