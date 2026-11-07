// Read-only tracker audit: closeout steps the GitHub tracker shows were skipped. It writes nothing.
// Every request crosses the delivery preflight's read-only gate (scripts/delivery-preflight/github.mjs),
// which allows only GET requests to the GitHub API and the preflight's own GraphQL queries.
// When to run it: docs/sdlc.md "Tracker audit".
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {ReadFailure, createReadOnlyClient, fetchTransport, resolveToken} from './delivery-preflight/github.mjs';

export const repository = 'jimmie-potts/agent-device-hub';
const hour = 3_600_000;
const day = 24 * hour;

/** Each finding type, the rule it checks and where that rule is written. */
export const rules = Object.freeze({
  'closed-workflow-label': 'docs/sdlc.md "Authority and preparation": remove workflow status/blocked labels on closure',
  'status-label': 'docs/sdlc.md "Authority and preparation": each open delivery issue has one of status:backlog, status:ready, status:in-progress or status:review; idea issues carry none (docs/issue-conventions.md "Classify and connect", owner decisions on #1254 and #1289)',
  'merged-without-update': 'docs/sdlc.md "Tracker reconciliation" and "Review and merge" step 6: update the selected issue at completion',
  'cleanup-unrecorded': 'docs/sdlc.md "Cleanup after delivery" step 8: record each resource\'s cleanup outcome in the PR or issue comment that closes out the work',
  'stale-review': 'docs/tracker-reconciliation.md "Report the checkpoint": the closeout receipt records acceptance still pending, "including observation dates and the next checkpoint where relevant". No document sets a time limit on status:review; the day threshold is this audit\'s default, proposed in #1508',
});

const headings = Object.freeze({
  'closed-workflow-label': 'Closed issues that keep a workflow label',
  'status-label': 'Open issues without exactly one workflow status label (idea issues left out)',
  'merged-without-update': 'Open in-progress or review issues with no comment since a referencing PR merged',
  'cleanup-unrecorded': 'Merged PRs with no cleanup outcome on the PR or its issue',
  'stale-review': 'Open review issues with no update',
});

const usage = 'usage: npm run audit:tracker -- [--hours <n>] [--stale-review-days <n>] [--json]';

export function parseArguments(args) {
  const options = {hours: 72, staleReviewDays: 5, json: false};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') options.json = true;
    else if (args[i] === '--hours' && /^[1-9]\d*$/.test(args[i + 1] ?? '')) options.hours = Number(args[++i]);
    else if (args[i] === '--stale-review-days' && /^[1-9]\d*$/.test(args[i + 1] ?? '')) options.staleReviewDays = Number(args[++i]);
    else throw new Error(usage);
  }
  return options;
}

const reference = String.raw`(?:${repository.replace('/', '\\/')})?#\d+`;
const clause = new RegExp(String.raw`\b(?:refs?|close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?[ \t]+(${reference}(?:(?:[ \t]*,[ \t]*|[ \t]*,?[ \t]+and[ \t]+)${reference})*)`, 'gi');

/**
 * Same-repository issue numbers a PR body names in a `Refs` or closing-keyword clause, such as
 * `Refs #12, #13 and #14` or `Closes jimmie-potts/agent-device-hub#15`. Bare mentions, `Part of #N` and other
 * repositories' issues are not references.
 */
export function references(body) {
  const numbers = new Set();
  for (const match of String(body ?? '').matchAll(clause)) {
    for (const item of match[1].matchAll(/#(\d+)/g)) numbers.add(Number(item[1]));
  }
  return numbers;
}

/**
 * Heuristic signal that a comment records step 8's cleanup outcome: it names cleanup or a worktree and uses
 * one of step 8's outcome words (removed, retained, not applicable). It does not check that every resource
 * has an outcome or that a removal cites its readback.
 */
export const recordsCleanup = body => /\b(?:clean-?up|worktrees?)\b/i.test(body ?? '') && /\b(?:removed|retained|not applicable)\b/i.test(body ?? '');

const labelNames = item => (item.labels ?? []).map(label => (typeof label === 'string' ? label : label.name));
const workflowLabel = name => name.startsWith('status:') || name === 'blocked';
/** The four workflow status values docs/sdlc.md "Authority and preparation" names. */
export const statusValues = Object.freeze(['status:backlog', 'status:ready', 'status:in-progress', 'status:review']);
const finding = (type, item, detail) => ({type, number: item.number, title: item.title, url: item.html_url, detail, rule: rules[type]});
const time = text => new Date(text).getTime();

/** Issues closed inside the window that still carry `status:*` or `blocked`. */
export function closedWithWorkflowLabels(closed, start) {
  return closed.filter(item => !item.pull_request && item.closed_at && time(item.closed_at) >= start.getTime())
    .flatMap(item => {
      const kept = labelNames(item).filter(workflowLabel);
      return kept.length ? [finding('closed-workflow-label', item, `closed ${item.closed_at}, keeps ${kept.join(', ')}`)] : [];
    });
}

/** Open issues, other than `idea` issues, without exactly one `status:*` label that is one of the four workflow values. */
export function statusLabelGaps(open) {
  return open.filter(item => !item.pull_request && !labelNames(item).includes('idea')).flatMap(item => {
    const status = labelNames(item).filter(name => name.startsWith('status:'));
    if (status.length === 1 && statusValues.includes(status[0])) return [];
    if (status.length === 1) return [finding('status-label', item, `has ${status[0]}, which is not one of ${statusValues.join(', ')}`)];
    return [finding('status-label', item, status.length ? `has ${status.join(', ')}` : `has no status label (labels: ${labelNames(item).join(', ') || 'none'})`)];
  });
}

/** Open `status:review` issues whose last update is older than the threshold. */
export function staleReviews(open, now, days) {
  return open.filter(item => !item.pull_request && labelNames(item).includes('status:review') && now.getTime() - time(item.updated_at) > days * day)
    .map(item => finding('stale-review', item, `last updated ${item.updated_at}, ${Math.floor((now.getTime() - time(item.updated_at)) / day)} days ago`));
}

/**
 * For one open in-progress or review issue and its timeline: the merged same-repository PRs whose body
 * references the issue, and whether any comment on the issue came at or after the latest of those merges.
 */
export function mergedWithoutUpdate(issue, timeline) {
  const merged = timeline.filter(event => event.event === 'cross-referenced' && event.source?.type === 'issue')
    .map(event => event.source.issue)
    .filter(source => source?.pull_request?.merged_at && source.repository?.full_name === repository && references(source.body).has(issue.number))
    .sort((a, b) => time(a.pull_request.merged_at) - time(b.pull_request.merged_at));
  if (!merged.length) return [];
  const latest = merged.at(-1);
  const comments = timeline.filter(event => event.event === 'commented').map(event => event.created_at).sort();
  const lastComment = comments.at(-1);
  if (lastComment && time(lastComment) >= time(latest.pull_request.merged_at)) return [];
  return [finding('merged-without-update', issue, `PR #${latest.number} merged ${latest.pull_request.merged_at}; ${lastComment ? `last comment ${lastComment}` : 'no comment'}`)];
}

/** For one merged PR: a finding unless a comment on the PR or a referenced issue, updated since the merge, records cleanup. */
export function cleanupUnrecorded(pr, commentsSinceMerge) {
  const mergedAt = time(pr.pull_request.merged_at);
  if (commentsSinceMerge.some(comment => time(comment.updated_at) >= mergedAt && recordsCleanup(comment.body))) return [];
  const issues = [...references(pr.body)];
  return [finding('cleanup-unrecorded', pr, `merged ${pr.pull_request.merged_at}; checked comments on the PR${issues.length ? ` and ${issues.map(n => `#${n}`).join(', ')}` : ' (its body references no issue)'}`)];
}

/**
 * The report. `client` is a read-only client (createReadOnlyClient); every read is a GET. A failed list read
 * throws; a failed per-item read lists that item as unknown, because a failed read is not an empty result.
 */
export async function collect(client, options, now = new Date()) {
  const start = new Date(now.getTime() - options.hours * hour);
  const base = `/repos/${repository}`;
  const open = (await client.getAll(`${base}/issues?state=open&per_page=100`)).filter(item => !item.pull_request);
  const closed = await client.getAll(`${base}/issues?state=closed&sort=updated&direction=desc&since=${start.toISOString()}&per_page=100`);
  const findings = [...closedWithWorkflowLabels(closed, start), ...statusLabelGaps(open)];
  const unknown = [];
  const attempt = async (type, item, read) => {
    try {return await read();} catch (error) {
      if (!(error instanceof ReadFailure)) throw error;
      unknown.push({type, number: item.number, url: item.html_url, detail: error.message});
      return [];
    }
  };
  for (const issue of open.filter(item => labelNames(item).some(name => name === 'status:in-progress' || name === 'status:review'))) {
    findings.push(...await attempt('merged-without-update', issue, async () => mergedWithoutUpdate(issue, await client.getAll(`${base}/issues/${issue.number}/timeline?per_page=100`))));
  }
  const merged = closed.filter(item => item.pull_request?.merged_at && time(item.pull_request.merged_at) >= start.getTime());
  for (const pr of merged) {
    findings.push(...await attempt('cleanup-unrecorded', pr, async () => {
      const since = new Date(pr.pull_request.merged_at).toISOString();
      const comments = [];
      for (const number of [pr.number, ...references(pr.body)]) comments.push(...await client.getAll(`${base}/issues/${number}/comments?since=${since}&per_page=100`));
      return cleanupUnrecorded(pr, comments);
    }));
  }
  findings.push(...staleReviews(open, now, options.staleReviewDays));
  return {repository, now: now.toISOString(), start: start.toISOString(), hours: options.hours, staleReviewDays: options.staleReviewDays, findings, unknown};
}

export function render(report) {
  const lines = [`Tracker audit for ${report.repository} (${report.hours} h window from ${report.start}; review stale after ${report.staleReviewDays} days; ${report.now})`];
  for (const type of Object.keys(rules)) {
    const found = report.findings.filter(item => item.type === type);
    const heading = type === 'stale-review' ? `${headings[type]} for more than ${report.staleReviewDays} days` : headings[type];
    lines.push('', `${heading}: ${found.length}`, `  Rule: ${rules[type]}`);
    for (const item of found) lines.push(`  #${item.number}  ${item.detail}  ${item.title}`);
  }
  if (report.unknown.length) {
    lines.push('', `Could not be checked (a failed read is not a clean result): ${report.unknown.length}`);
    for (const item of report.unknown) lines.push(`  #${item.number} ${item.type}: ${item.detail}`);
  }
  lines.push('', 'Read-only: nothing was written to the tracker. The PR-to-issue link and the cleanup signal are heuristics; see docs/development.md "Tracker audit".');
  return lines.join('\n');
}

/** Exit status: 0 clean, 1 findings, 2 a read failed or an item could not be checked, 3 usage or internal error. */
export async function main({argv, client, now = new Date(), write = text => process.stdout.write(text), error = text => process.stderr.write(text)}) {
  let options;
  try {options = parseArguments(argv);} catch (failure) {
    error(`${failure.message}\n`);
    return 3;
  }
  let report;
  try {
    report = await collect(client, options, now);
    write(`${options.json ? JSON.stringify(report, null, 2) : render(report)}\n`);
  } catch (failure) {
    if (failure instanceof ReadFailure) {
      error(`tracker audit: ${failure.message}\n`);
      return 2;
    }
    // Anything else is a defect or malformed data, never a finding: keep it off exit 1.
    error(`tracker audit: internal error: ${failure?.stack ?? failure}\n`);
    return 3;
  }
  if (report.unknown.length) return 2;
  return report.findings.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const client = createReadOnlyClient(fetchTransport({token: resolveToken()}));
  process.exitCode = await main({argv: process.argv.slice(2), client});
}
