// Owner-facing records on the PR: UI approval and guide-only exception
// evidence. A record counts only when the delivery account wrote it as a plain
// comment or review on this PR; bot comments, other accounts and comments that
// carry automation markers (review reports, provider summaries) never count.
export const RECORD_URL = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)#(?:issuecomment-(\d+)|pullrequestreview-(\d+)|discussion_r(\d+))$/;

export function isBot(user) {
  return Boolean(user) && (user.type === 'Bot' || String(user.login || '').endsWith('[bot]'));
}

/**
 * Read one record URL. Returns null after a read failure or a URL outside this
 * PR (both already on the gate), otherwise {record, problems}.
 */
export async function readRecord(ctx, gate, url, label) {
  const { github, repo, pr } = ctx;
  const match = String(url).match(RECORD_URL);
  if (!match || match[1] !== repo || Number(match[2]) !== pr.number) {
    gate.unresolved(`the ${label} is not a comment or review on this PR`);
    return null;
  }
  const [, , , commentId, reviewId, discussionId] = match;
  const found = await ctx.read(gate, async () => {
    if (commentId) {
      const item = await github.get(`/repos/${repo}/issues/comments/${commentId}`);
      return String(item.issue_url || '').endsWith(`/issues/${pr.number}`) ? item : null;
    }
    if (reviewId) return github.get(`/repos/${repo}/pulls/${pr.number}/reviews/${reviewId}`);
    const item = await github.get(`/repos/${repo}/pulls/comments/${discussionId}`);
    return String(item.pull_request_url || '').endsWith(`/pulls/${pr.number}`) ? item : null;
  });
  if (!found.ok) return null;
  if (!found.value) {
    gate.unresolved(`the ${label} belongs to another issue or PR`);
    return null;
  }
  const item = found.value;
  const user = item.user || {};
  const record = { url, author: user.login ?? null, createdAt: item.created_at || item.submitted_at || null, body: String(item.body || '').replace(/\r\n/g, '\n') };
  const problems = [];
  if (isBot(user)) problems.push(`the ${label} ${url} is by ${record.author}, a bot; it must come from the delivery account ${ctx.publisher}`);
  else if (record.author !== ctx.publisher) problems.push(`the ${label} ${url} is by ${record.author}, not the delivery account ${ctx.publisher}`);
  if (record.body.includes('<!--')) problems.push(`the ${label} ${url} carries an automation marker (a review report or provider summary), not a plain record`);
  return { record, problems };
}

// The local checks the guide README asks the record to report, besides the
// browser check that the guide receipt covers. Only one documented line form
// counts: the check's command, a colon, and exactly `exit 0` or `passed`, for
// example "- python3 docs/work-guide/work/build_guide.py: exit 0". Every line
// that names a check must have that form, so any other wording leaves the
// check unverified.
export const GUIDE_RECORD_CHECKS = [
  ['build_guide.py', /\bbuild_guide\.py\b/],
  ['test_maintenance.py', /\btest_maintenance\.py\b/],
  ['check_places.cjs', /\bcheck_places\.cjs\b/],
  ['git diff --exit-code', /git diff --exit-code/],
];
const PASSING_LINE = /^\s*(?:[-*]\s+)?(.+):[ \t]*(?:exit 0|passed)[ \t]*$/;

/** Classify each required check as passed or unverified from the record's lines. */
export function guideRecordResults(body) {
  const lines = body.split('\n');
  const results = { passed: [], unverified: [] };
  for (const [id, pattern] of GUIDE_RECORD_CHECKS) {
    const mentions = lines.filter(line => pattern.test(line));
    const passing = mentions.length > 0 && mentions.every(line => {
      const match = line.match(PASSING_LINE);
      return Boolean(match) && pattern.test(match[1]);
    });
    results[passing ? 'passed' : 'unverified'].push(id);
  }
  return results;
}

// A UI approval record states approval of a revision on one line: an approval
// word and the revision together, with no negation on that line.
const APPROVAL_WORD = /\bapprov(?:e|ed|al)\b/i;
const NEGATION = /\bnot\b|n't\b|\bnever\b|\bno\b|\bwithout\b|\bpending\b|\bawait(?:s|ing)?\b|\bunapproved\b/i;

/** PR revisions a record names on an approval line, by full or abbreviated (7+) hex SHA. */
export function approvedRevisions(body, commits) {
  const named = new Set();
  for (const line of body.split('\n')) {
    if (!APPROVAL_WORD.test(line) || NEGATION.test(line)) continue;
    const tokens = line.match(/\b[0-9a-f]{7,40}\b/g) || [];
    for (const sha of commits) if (tokens.some(token => sha.startsWith(token))) named.add(sha);
  }
  return [...named];
}
