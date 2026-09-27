// Evaluate one declared delivery comparison against the Hub delivery gates in
// docs/sdlc.md. Every gate is re-read from GitHub and local proof on each run;
// missing, pending, skipped, failed or stale evidence stays unresolved, and a
// failed read is a read failure, never success.
import { createHash } from 'node:crypto';

import { ReadFailure } from './github.mjs';
import { GUIDE_HTML_PATH, LocalReadFailure, RECEIPT_VERSION, describeLocal, readAppReceipt, readGuideReceipt } from './receipts.mjs';
import {
  POLICY_PATHS, REVIEW_FORMAT, collectReports, judgeRound, policyComponents, requirementReference, short,
} from './reviews.mjs';
import { expectedJobs, parseWorkflow } from './workflows.mjs';

export const DEPOT_APP = 'depot-code-access';
export const GUIDE_ROOT = 'docs/work-guide/';
// Non-guide UI the preflight recognizes by path. `--ui` declares UI elsewhere.
export const UI_ROOTS = ['apps/dashboard/src/', 'docs/system-design/', 'docs/skins/'];
export const FINISH_LINES = ['source', 'installed', 'real-client', 'physical'];
const PR_FILE_LIMIT = 3000;
const COMPARE_FILE_LIMIT = 300;
const SDLC = 'docs/sdlc.md';

class Gate {
  constructor(id, title, rule) {
    this.id = id;
    this.title = title;
    this.rule = rule;
    this.status = 'satisfied';
    this.reasons = [];
    this.evidence = {};
  }

  unresolved(reason) {
    if (this.status !== 'read-failure') this.status = 'unresolved';
    this.reasons.push(reason);
  }

  note(reason) {
    this.reasons.push(reason);
  }

  notApplicable(reason) {
    this.status = 'not-applicable';
    this.reasons.push(reason);
  }

  toJSON() {
    return { id: this.id, title: this.title, rule: this.rule, status: this.status, reasons: this.reasons, evidence: this.evidence };
  }
}

const isReadError = error => error instanceof ReadFailure || error instanceof LocalReadFailure;

function issueReference(body) {
  const numbers = new Set();
  for (const match of String(body || '').matchAll(/\b(?:refs?|closes?|closed|fix(?:es|ed)?|resolves?|resolved)\s+#(\d+)\b/gi)) {
    numbers.add(Number(match[1]));
  }
  return [...numbers];
}

function publicDeclaration(declaration) {
  return {
    pr: declaration.pr,
    head: declaration.head ?? null,
    base: declaration.base ?? null,
    issue: declaration.issue ?? null,
    finishLine: declaration.finishLine,
    counterparts: declaration.counterparts || [],
    receipts: (declaration.receipts || []).map(describeLocal),
    ui: Boolean(declaration.ui),
    uiApproval: declaration.uiApproval ?? null,
    guideReceipt: declaration.guideReceipt ? describeLocal(declaration.guideReceipt) : null,
    guideRecord: declaration.guideRecord ?? null,
  };
}

export async function runPreflight({ github, declaration, now = () => new Date() }) {
  const readAt = now().toISOString();
  const repo = declaration.repo;
  const [owner] = repo.split('/');
  const readFailures = [];
  const gates = {
    identity: new Gate('identity', 'Source identity', `${SDLC}#review-and-merge`),
    ciPr: new Gate('ci-pr', 'Depot CI on the PR head', `${SDLC}#depot-ci-evidence`),
    ciMain: new Gate('ci-main', 'Depot CI on the merged main revision', `${SDLC}#depot-ci-evidence`),
    review: new Gate('review', 'Independent Standards and Specification review', `${SDLC}#review-and-merge`),
    feedback: new Gate('feedback', 'Published review feedback', `${SDLC}#review-and-merge`),
    ui: new Gate('ui-approval', 'UI approval', `${SDLC}#ui-approval-scope`),
    proof: new Gate('proof', 'Proof artifacts', 'docs/app-verification.md#frozen-proof'),
    counterparts: new Gate('counterparts', 'Linked counterparts and blockers', `${SDLC}#authority-and-preparation`),
    live: new Gate('live-acceptance', 'Installation, real-client and physical acceptance', `${SDLC}#installation-and-evidence`),
  };

  async function read(gate, fn) {
    try {
      return { ok: true, value: await fn() };
    } catch (error) {
      if (!isReadError(error)) throw error;
      gate.status = 'read-failure';
      gate.reasons.push(`read failure: ${error.what}: ${error.detail}`);
      readFailures.push({ gate: gate.id, what: error.what, detail: error.detail });
      return { ok: false };
    }
  }

  const report = {
    tool: 'delivery-preflight',
    schema: 1,
    readAt,
    notice: '',
    formats: { reviewReports: REVIEW_FORMAT, receipt: RECEIPT_VERSION, guideReceipt: 'docs/work-guide/work/check_guide.cjs guide-verification.json' },
    declared: publicDeclaration(declaration),
    candidate: null,
    finishLine: declaration.finishLine,
    gates: [],
    result: 'unresolved',
    exitCode: 1,
    readFailures,
  };

  function finish() {
    const list = Object.values(gates);
    report.gates = list.map(gate => gate.toJSON());
    report.result = list.some(gate => gate.status === 'read-failure') ? 'read-failure'
      : list.some(gate => gate.status === 'unresolved') ? 'unresolved' : 'satisfied';
    report.exitCode = { satisfied: 0, unresolved: 1, 'read-failure': 2 }[report.result];
    const subject = report.candidate ? `head ${report.candidate.head}` : `PR #${declaration.pr}`;
    report.notice = `Read at ${readAt} for ${subject}. GitHub state is volatile: re-run immediately before any merge or closure. This report is not authorization to merge, close issues or install.`;
    return report;
  }

  evaluateLive(gates.live, declaration, []);

  // ---- Identity ----
  const prRead = await read(gates.identity, () => github.get(`/repos/${repo}/pulls/${declaration.pr}`));
  if (!prRead.ok) {
    for (const gate of Object.values(gates)) {
      if (gate !== gates.identity && gate !== gates.live) {
        gate.status = 'read-failure';
        gate.reasons.push('not evaluated: the PR could not be read');
      }
    }
    return finish();
  }
  const pr = prRead.value;
  const merged = Boolean(pr.merged || pr.merged_at);
  const state = merged ? 'merged' : pr.state === 'open' ? 'open' : 'closed';
  const head = pr.head.sha;
  const baseRef = pr.base.ref;
  let base = null;
  if (merged) {
    base = pr.base.sha;
  } else {
    const ref = await read(gates.identity, () => github.get(`/repos/${repo}/git/ref/heads/${baseRef}`));
    if (ref.ok) base = ref.value.object.sha;
  }
  let mergeBase = null;
  if (base) {
    const compare = await read(gates.identity, () => github.get(`/repos/${repo}/compare/${base}...${head}`));
    if (compare.ok) mergeBase = compare.value.merge_base_commit.sha;
  }
  report.candidate = {
    repository: repo,
    pr: pr.number,
    url: pr.html_url,
    state,
    draft: Boolean(pr.draft),
    head,
    headRef: pr.head.ref,
    base,
    baseRef,
    mergeBase,
    mergeCommit: merged ? pr.merge_commit_sha : null,
  };
  const identity = gates.identity;
  identity.evidence = { mergeableState: pr.mergeable_state ?? null };
  if (declaration.head && declaration.head !== head) identity.unresolved(`head changed: declared ${short(declaration.head)}, live ${short(head)}`);
  if (declaration.base && base && declaration.base !== base) {
    identity.unresolved(merged
      ? `base changed: declared ${short(declaration.base)}, the PR merged onto ${short(base)}`
      : `base changed: declared ${short(declaration.base)}, ${baseRef} is now ${short(base)}`);
  }
  if (state === 'closed') identity.unresolved('the PR is closed without merge');
  if (pr.draft) identity.unresolved('the PR is a draft');
  if (state === 'open' && pr.mergeable_state === 'dirty') identity.unresolved('the PR has merge conflicts with its base');
  if (pr.head.repo && pr.head.repo.full_name !== repo) identity.unresolved(`the head comes from ${pr.head.repo.full_name}, not ${repo}`);
  if (baseRef !== 'main') identity.unresolved(`the PR targets ${baseRef}, not main`);

  const referenced = issueReference(pr.body);
  const workIssue = declaration.issue ?? (referenced.length === 1 ? referenced[0] : null);
  if (!declaration.issue && referenced.length > 1) identity.note(`the PR body references ${referenced.map(n => `#${n}`).join(', ')}; declare --issue to name the work issue`);
  if (!workIssue) identity.note('no work issue is declared or referenced; review work and blockers are not matched to one');
  const work = workIssue ? { number: workIssue, reference: `${repo}#${workIssue}`, url: `https://github.com/${repo}/issues/${workIssue}` } : null;
  identity.evidence.workIssue = work ? work.url : null;

  // Pull-request state that GitHub only exposes through GraphQL.
  const threadsRead = await read(gates.feedback, async () => {
    const [ownerName, repoName] = repo.split('/');
    const threads = [];
    let closing = [];
    let after = null;
    for (let page = 0; page < 20; page += 1) {
      const data = await github.graphql(`query PullRequestState($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      closingIssuesReferences(first: 50) { nodes { number repository { nameWithOwner } } }
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { isResolved isOutdated path comments(first: 1) { nodes { url author { login } } } }
      }
    }
  }
}`, { owner: ownerName, name: repoName, number: pr.number, after });
      const pull = data.repository && data.repository.pullRequest;
      if (!pull) throw new ReadFailure('GraphQL PullRequestState', 'pull request not found');
      closing = pull.closingIssuesReferences.nodes;
      threads.push(...pull.reviewThreads.nodes);
      if (!pull.reviewThreads.pageInfo.hasNextPage) return { threads, closing };
      after = pull.reviewThreads.pageInfo.endCursor;
    }
    throw new ReadFailure('GraphQL PullRequestState', 'too many review thread pages');
  });
  if (!threadsRead.ok) {
    identity.status = 'read-failure';
    identity.reasons.push('not evaluated: closing issue references could not be read');
  } else if (state === 'open') {
    for (const item of threadsRead.value.closing) {
      const ref = item.repository.nameWithOwner === repo ? `#${item.number}` : `${item.repository.nameWithOwner}#${item.number}`;
      identity.unresolved(`the PR closes ${ref} on merge; use Refs so closure waits for merged-main CI`);
    }
  }

  // ---- Changed files ----
  const filesRead = await read(gates.ciPr, () => github.getAll(`/repos/${repo}/pulls/${pr.number}/files?per_page=100`));
  const files = filesRead.ok ? filesRead.value : [];
  const paths = [...new Set(files.flatMap(file => [file.filename, file.previous_filename].filter(Boolean)))];
  const filesComplete = filesRead.ok && files.length === pr.changed_files && files.length < PR_FILE_LIMIT;
  if (filesRead.ok && !filesComplete) gates.ciPr.note(`the changed-file list is incomplete (${files.length} of ${pr.changed_files})`);

  // ---- CI on the PR head ----
  const branchRules = await read(gates.ciPr, () => github.getAll(`/repos/${repo}/rules/branches/${baseRef}?per_page=100`));
  const requiredContexts = branchRules.ok
    ? branchRules.value.filter(rule => rule.type === 'required_status_checks')
      .flatMap(rule => (rule.parameters && rule.parameters.required_status_checks) || []).map(check => check.context)
    : [];
  if (filesRead.ok && branchRules.ok) {
    await evaluateCi(gates.ciPr, { sha: head, event: 'pull_request', branch: baseRef, checkBranch: pr.head.ref, paths, filesComplete, requiredContexts, baseline: mergeBase });
  }

  // ---- CI on the merged main revision ----
  if (!merged) {
    gates.ciMain.notApplicable('applies after merge: merged-main CI is read before issue closure');
  } else if (!pr.merge_commit_sha) {
    gates.ciMain.unresolved('the merged PR has no merge commit to verify');
  } else {
    const commit = await read(gates.ciMain, () => github.get(`/repos/${repo}/commits/${pr.merge_commit_sha}`));
    if (commit.ok) {
      const mainPaths = [...new Set((commit.value.files || []).flatMap(file => [file.filename, file.previous_filename].filter(Boolean)))];
      gates.ciMain.evidence.parent = commit.value.parents && commit.value.parents[0] ? commit.value.parents[0].sha : null;
      const complete = Array.isArray(commit.value.files) && commit.value.files.length < COMPARE_FILE_LIMIT;
      await evaluateCi(gates.ciMain, { sha: pr.merge_commit_sha, event: 'push', branch: baseRef, checkBranch: baseRef, paths: mainPaths, filesComplete: complete, requiredContexts: [] });
    }
  }

  async function readWorkflows(gate, sha) {
    return read(gate, async () => {
      const listing = await github.get(`/repos/${repo}/contents/.depot/workflows?ref=${sha}`);
      const files = (Array.isArray(listing) ? listing : []).filter(item => item.type === 'file' && /\.ya?ml$/.test(item.name));
      const parsed = [];
      for (const item of files) {
        const content = await github.get(`/repos/${repo}/contents/${item.path}?ref=${sha}`);
        const text = Buffer.from(content.content || '', 'base64').toString('utf8');
        try {
          parsed.push(parseWorkflow(item.name, text));
        } catch (error) {
          gate.unresolved(`cannot parse workflow ${item.name} at ${short(sha)}: ${error.message}`);
        }
      }
      return parsed;
    });
  }

  async function evaluateCi(gate, { sha, event, branch, checkBranch, paths: changed, filesComplete: complete, requiredContexts: contexts, baseline }) {
    gate.evidence.revision = sha;
    gate.evidence.event = event;
    const workflowsRead = await readWorkflows(gate, sha);
    if (!workflowsRead.ok) return;
    const scope = { event, branch, files: changed, filesComplete: complete };
    const expected = expectedJobs(workflowsRead.value, scope);
    for (const reason of expected.uncertain) gate.unresolved(`cannot enumerate expected jobs: ${reason}`);
    for (const reason of expected.notes) gate.note(reason);
    const names = [...new Set([...expected.jobs.map(job => job.name), ...contexts])];
    gate.evidence.expected = names;
    gate.evidence.filtered = expected.filtered;
    // A candidate that edits its own workflows cannot lower its gate silently.
    if (baseline && changed.some(file => file.startsWith('.depot/workflows/'))) {
      const before = await readWorkflows(gate, baseline);
      if (before.ok) {
        const dropped = expectedJobs(before.value, scope).jobs.map(job => job.name).filter(name => !names.includes(name));
        for (const name of dropped) gate.unresolved(`${name}: expected at ${short(baseline)} but dropped by the candidate's workflow change; confirm the intended coverage`);
        if (!dropped.length) gate.note(`the candidate changes .depot/workflows/; no job expected at ${short(baseline)} is dropped`);
      }
    }
    const guideOnly = complete && changed.length > 0 && changed.every(file => file.startsWith(GUIDE_ROOT));
    const outside = changed.filter(file => !file.startsWith(GUIDE_ROOT));
    if (!names.length && !expected.uncertain.length) {
      if (guideOnly && expected.filtered.length) {
        await evaluateGuideException(gate, { sha, event });
      } else {
        gate.unresolved('no configured job applies and no exception covers this change');
      }
      return;
    }
    gate.evidence.mode = 'depot';
    if (declaration.guideReceipt || declaration.guideRecord) {
      gate.note(`the guide-only exception does not apply: not guide-only: ${outside.slice(0, 5).join(', ') || 'the file list is incomplete'}`);
    }
    await evaluateChecks(gate, { sha, names, checkBranch });
  }

  async function evaluateChecks(gate, { sha, names, checkBranch }) {
    const evidence = await read(gate, async () => ({
      runs: await github.getAll(`/repos/${repo}/commits/${sha}/check-runs?per_page=100&filter=all`, 'check_runs'),
      suites: await github.getAll(`/repos/${repo}/commits/${sha}/check-suites?per_page=100`, 'check_suites'),
    }));
    if (!evidence.ok) return;
    const suites = new Map(evidence.value.suites.map(item => [item.id, item]));
    const qualifies = run => {
      const suite = suites.get(run.check_suite && run.check_suite.id);
      if (!run.app || run.app.slug !== DEPOT_APP) return 'another app';
      if (run.head_sha !== sha) return 'another revision';
      if (!suite) return 'unknown check suite';
      if (!suite.repository || suite.repository.full_name !== repo) return 'another repository';
      if (suite.head_branch !== checkBranch) return `event on ${suite.head_branch}, expected ${checkBranch}`;
      return null;
    };
    const jobs = [];
    const ignored = [];
    for (const run of evidence.value.runs) {
      const why = qualifies(run);
      if (why) ignored.push({ checkRunId: run.id, name: run.name, why });
    }
    for (const name of names) {
      const attempts = evidence.value.runs.filter(run => run.name === name && !qualifies(run))
        .sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)) || a.id - b.id);
      if (!attempts.length) {
        jobs.push({ name, result: 'missing' });
        gate.unresolved(`${name}: missing`);
        continue;
      }
      const latest = attempts.at(-1);
      const result = latest.status !== 'completed' ? 'pending' : latest.conclusion;
      const job = {
        name,
        result,
        checkRunId: latest.id,
        detailsUrl: latest.details_url ?? null,
        htmlUrl: latest.html_url ?? null,
        superseded: attempts.slice(0, -1).map(run => ({ checkRunId: run.id, result: run.status === 'completed' ? run.conclusion : 'pending' })),
      };
      jobs.push(job);
      if (result === 'pending') {
        gate.unresolved(`${name}: pending (${latest.status})`);
      } else if (result !== 'success') {
        gate.unresolved(`${name}: ${result}`);
      } else if (job.superseded.some(item => item.result === 'pending')) {
        gate.unresolved(`${name}: an earlier attempt is still running`);
      }
      if (result === 'success' && latest.output && latest.output.annotations_count > 0) {
        const annotations = await read(gate, () => github.getAll(`/repos/${repo}/check-runs/${latest.id}/annotations?per_page=100`));
        if (annotations.ok) {
          job.annotations = annotations.value.length;
          const failing = annotations.value.filter(item => item.annotation_level === 'failure');
          if (failing.length) gate.unresolved(`${name}: success with a failure annotation (${failing[0].title || 'untitled'}); resolve the contradiction`);
        }
      }
    }
    const unexpected = evidence.value.runs.filter(run => !qualifies(run) && !names.includes(run.name));
    gate.evidence.jobs = jobs;
    if (unexpected.length) gate.evidence.unexpected = unexpected.map(run => ({ name: run.name, checkRunId: run.id, result: run.status === 'completed' ? run.conclusion : 'pending' }));
    if (ignored.length) gate.evidence.ignoredRuns = ignored;
  }

  async function readRecord(gate, url, label) {
    const match = String(url).match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)#(?:issuecomment-(\d+)|pullrequestreview-(\d+)|discussion_r(\d+))$/);
    if (!match || match[1] !== repo || Number(match[2]) !== pr.number) {
      gate.unresolved(`the ${label} is not a comment or review on this PR`);
      return null;
    }
    const [, , , commentId, reviewId, discussionId] = match;
    const found = await read(gate, async () => {
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
    return { url, author: item.user ? item.user.login : null, createdAt: item.created_at || item.submitted_at || null, body: String(item.body || '') };
  }

  async function evaluateGuideException(gate, { sha }) {
    gate.evidence.mode = 'guide-only-exception';
    gate.note(`every changed path is under ${GUIDE_ROOT} and every workflow filters it; ${SDLC}#guide-only-ci-exception applies only with its evidence`);
    const runs = await read(gate, () => github.getAll(`/repos/${repo}/commits/${sha}/check-runs?per_page=100&filter=all`, 'check_runs'));
    if (runs.ok) {
      const depot = runs.value.filter(run => run.app && run.app.slug === DEPOT_APP);
      if (depot.length) gate.unresolved(`Depot runs exist for ${short(sha)} although the filters exclude this change; resolve that before using the exception`);
    }
    if (!declaration.guideReceipt) {
      gate.unresolved('the guide-only exception needs the guide verification receipt (--guide-receipt) and its PR record (--guide-record); missing runs alone do not establish it');
      return;
    }
    const receipt = await read(gate, async () => readGuideReceipt(declaration.guideReceipt));
    if (!receipt.ok) return;
    gate.evidence.guideReceipt = receipt.value.evidence;
    for (const reason of receipt.value.reasons) gate.unresolved(reason);
    const html = await read(gate, async () => {
      const item = await github.get(`/repos/${repo}/contents/${GUIDE_HTML_PATH}?ref=${sha}`);
      if (item.encoding === 'base64' && item.content) return Buffer.from(item.content, 'base64');
      const blob = await github.get(`/repos/${repo}/git/blobs/${item.sha}`);
      return Buffer.from(blob.content || '', 'base64');
    });
    if (html.ok) {
      const digest = createHash('sha256').update(html.value).digest('hex');
      gate.evidence.committedHtmlSha256 = digest;
      if (digest !== receipt.value.evidence.htmlSha256) {
        gate.unresolved(`the guide receipt's HTML hash does not match the candidate's committed guide HTML at ${short(sha)}`);
      }
    }
    if (!declaration.guideRecord) {
      gate.unresolved(`the guide-only exception needs its PR record (--guide-record) naming ${short(sha)} and the HTML hash`);
      return;
    }
    const record = await readRecord(gate, declaration.guideRecord, 'guide record');
    if (!record) return;
    gate.evidence.guideRecord = { url: record.url, author: record.author, createdAt: record.createdAt };
    const hash = receipt.value.evidence.htmlSha256;
    if (!record.body.includes(sha) || !hash || !record.body.includes(hash)) {
      gate.unresolved(`the guide record does not name ${short(sha)} in full and HTML sha256 ${short(hash || 'unknown')}`);
    }
  }

  // ---- Comments: review reports and other feedback ----
  const commentsRead = await read(gates.review, () => github.getAll(`/repos/${repo}/issues/${pr.number}/comments?per_page=100`));
  if (!commentsRead.ok) {
    gates.feedback.status = 'read-failure';
    gates.feedback.reasons.push('not evaluated: PR comments could not be read');
  }
  const comments = commentsRead.ok ? commentsRead.value : [];
  // Review reports come from the delivery's account: the PR author, or the
  // repository owner when a bot opened the PR (the nightly guide refresh).
  const author = pr.user || {};
  const publisher = author.login && author.type !== 'Bot' && !author.login.endsWith('[bot]') ? author.login : owner;

  // ---- Independent review ----
  if (commentsRead.ok) {
    const review = gates.review;
    const { rounds, ignored } = collectReports(comments, publisher);
    review.evidence.rounds = rounds.map(round => ({ round: `final ${round.round}`, head: round.head, url: round.url }));
    if (ignored.length) review.evidence.ignoredReports = ignored;
    if (!rounds.length) {
      review.unresolved(`no retained final review report in the agent-skills#54 format (a PR comment from ${publisher} starting with a deliver-work report marker)`);
    } else if (!base || !mergeBase) {
      review.status = 'read-failure';
      review.reasons.push('not evaluated: the current base or merge-base could not be read');
    } else {
      const latest = rounds.at(-1);
      const judged = judgeRound(latest, { current: { base, head, mergeBase }, work });
      review.evidence = {
        ...review.evidence,
        round: `final ${latest.round}`,
        report: latest.url,
        comparison: judged.rows.Comparison ?? null,
        requirements: judged.rows.Requirements ?? null,
        policy: judged.rows.Policy ?? null,
        returns: judged.returns,
      };
      for (const reason of judged.reasons) review.unresolved(reason);
      await checkRequirements(review, judged.rows.Requirements);
      await checkPolicy(review, judged.rows.Policy, base);
    }
  }

  async function checkRequirements(gate, value) {
    if (!value || value === 'none') return;
    const parsed = requirementReference(value);
    if (!parsed) {
      gate.unresolved(`the requirements row ${value} cannot be read`);
      return;
    }
    if (!parsed.issue) {
      gate.note(`requirements source ${parsed.reference} is not a GitHub issue and is not rechecked`);
      return;
    }
    if (parsed.issue.owner !== owner) {
      gate.unresolved(`requirements ${parsed.reference} are outside owned repositories; recheck them manually`);
      return;
    }
    const reviewedAt = Date.parse(parsed.version);
    if (Number.isNaN(reviewedAt)) {
      gate.unresolved(`requirement version ${parsed.version} is not a timestamp, so its freshness cannot be checked`);
      return;
    }
    const issue = await read(gate, async () => {
      const data = await github.graphql(`query RequirementVersion($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) { lastEditedAt createdAt state } }
}`, parsed.issue);
      if (!data.repository || !data.repository.issue) throw new ReadFailure('GraphQL RequirementVersion', `${parsed.reference} not found`);
      return data.repository.issue;
    });
    if (!issue.ok) return;
    const edited = issue.value.lastEditedAt || issue.value.createdAt;
    gate.evidence.requirementsEditedAt = edited;
    if (Date.parse(edited) > reviewedAt) gate.unresolved(`requirements changed after review: ${parsed.reference} was edited ${edited}, reviewed at ${parsed.version}`);
  }

  async function checkPolicy(gate, value, currentBase) {
    if (!value || value === 'unknown') return;
    for (const component of policyComponents(value, repo)) {
      if (!component.local) {
        gate.note(`policy source ${component.source} is not rechecked`);
        continue;
      }
      const compare = await read(gate, () => github.get(`/repos/${repo}/compare/${component.revision}...${currentBase}`));
      if (!compare.ok) continue;
      if (!['ahead', 'identical'].includes(compare.value.status)) {
        gate.unresolved(`policy revision ${short(component.revision)} is not an ancestor of the base ${short(currentBase)}`);
        continue;
      }
      const changed = (compare.value.files || []).map(file => file.filename);
      if (changed.length >= COMPARE_FILE_LIMIT) {
        gate.unresolved(`cannot confirm policy freshness: more than ${COMPARE_FILE_LIMIT} files changed since ${short(component.revision)}`);
        continue;
      }
      const policy = changed.filter(file => POLICY_PATHS.includes(file));
      if (policy.length) gate.unresolved(`policy changed after review: ${policy.join(', ')} changed since ${short(component.revision)}`);
    }
  }

  // ---- Feedback ----
  if (commentsRead.ok) {
    const feedback = gates.feedback;
    const reviewsRead = await read(feedback, () => github.getAll(`/repos/${repo}/pulls/${pr.number}/reviews?per_page=100`));
    if (reviewsRead.ok) {
      const latestByUser = new Map();
      for (const item of reviewsRead.value) {
        if (!['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(item.state) || !item.user) continue;
        latestByUser.set(item.user.login, item);
      }
      for (const [login, item] of latestByUser) {
        if (item.state === 'CHANGES_REQUESTED') feedback.unresolved(`changes requested by ${login} (${item.html_url})`);
      }
    }
    if (threadsRead.ok) {
      const open = threadsRead.value.threads.filter(thread => !thread.isResolved);
      if (open.length) {
        feedback.unresolved(`${open.length} unresolved review thread(s)`);
        feedback.evidence.unresolvedThreads = open.map(thread => ({ path: thread.path, url: thread.comments.nodes[0] ? thread.comments.nodes[0].url : null, outdated: thread.isOutdated }));
      }
    }
    const providerResults = [];
    const others = [];
    for (const item of comments) {
      const marker = String(item.body || '').match(/<!-- codex-security-review:v1 (\{.*?\}) -->/);
      if (marker) {
        let data = {};
        try {
          data = JSON.parse(marker[1]);
        } catch {
          data = {};
        }
        providerResults.push({ provider: 'codex-security-review', head: data.headSha ?? null, status: data.status ?? null, coversHead: data.headSha === head, url: item.html_url });
      } else if (item.user && item.user.login !== publisher) {
        others.push({ author: item.user.login, url: item.html_url });
      }
    }
    feedback.evidence.providerResults = providerResults;
    for (const result of providerResults) {
      feedback.note(`${result.provider} ${result.status} for ${short(result.head)}${result.coversHead ? '' : ' (superseded: not the current head)'}; informational, not a required axis`);
    }
    if (others.length) {
      feedback.evidence.otherComments = others;
      feedback.note(`${others.length} comment(s) from other accounts; read and dispose of them`);
    }
  }

  // ---- UI approval ----
  {
    const ui = gates.ui;
    const uiPaths = paths.filter(file => UI_ROOTS.some(rootPath => file.startsWith(rootPath)));
    const guidePaths = paths.filter(file => file.startsWith(GUIDE_ROOT));
    ui.evidence = { paths: uiPaths, guidePaths: guidePaths.length };
    if (!filesRead.ok) {
      ui.status = 'read-failure';
      ui.reasons.push('not evaluated: the changed files could not be read');
    } else if (!filesComplete) {
      ui.unresolved('the changed-file list is incomplete, so the UI scope is unknown');
    } else if (!uiPaths.length && !declaration.ui) {
      ui.notApplicable(guidePaths.length
        ? 'no non-guide UI path changed; guide UI is exempt from human approval'
        : 'no non-guide UI path changed');
    } else if (!declaration.uiApproval) {
      ui.unresolved(uiPaths.length
        ? `${uiPaths.join(', ')} needs explicit human approval of the current candidate (--ui-approval <PR comment URL>)`
        : 'the declared UI change needs explicit human approval of the current candidate (--ui-approval <PR comment URL>)');
    } else {
      await evaluateApproval(ui, uiPaths);
    }
    if (guidePaths.length && ui.status !== 'not-applicable') ui.note('guide UI is exempt; the approval covers the other UI');
  }

  async function evaluateApproval(gate, uiPaths) {
    const record = await readRecord(gate, declaration.uiApproval, 'UI approval record');
    if (!record) return;
    const commits = await read(gate, () => github.getAll(`/repos/${repo}/pulls/${pr.number}/commits?per_page=100`));
    if (!commits.ok) return;
    const tokens = record.body.match(/\b[0-9a-f]{7,40}\b/g) || [];
    const named = [...new Set(commits.value.map(item => item.sha).filter(sha => tokens.some(token => sha.startsWith(token))))];
    gate.evidence.approval = { url: record.url, author: record.author, createdAt: record.createdAt };
    if (named.length !== 1) {
      gate.unresolved(named.length ? `the approval record names several revisions of this PR (${named.map(short).join(', ')})` : 'the approval record names no revision of this PR');
      return;
    }
    const [approved] = named;
    gate.evidence.approvedRevision = approved;
    if (approved === head) return;
    if (declaration.ui && !uiPaths.length) {
      gate.unresolved(`declared UI cannot be traced by path; the approval names ${short(approved)}, not the current head`);
      return;
    }
    const compare = await read(gate, () => github.get(`/repos/${repo}/compare/${approved}...${head}`));
    if (!compare.ok) return;
    const changed = (compare.value.files || []).flatMap(file => [file.filename, file.previous_filename].filter(Boolean));
    if (changed.length >= COMPARE_FILE_LIMIT) {
      gate.unresolved(`cannot confirm the UI is unchanged since ${short(approved)}: the comparison is too large`);
      return;
    }
    const uiChanged = changed.filter(file => UI_ROOTS.some(rootPath => file.startsWith(rootPath)));
    if (uiChanged.length) gate.unresolved(`UI changed after the approved revision: ${uiChanged.join(', ')} since ${short(approved)}`);
    else gate.note(`no UI path changed between the approved ${short(approved)} and the current head`);
  }

  // ---- Proof artifacts ----
  const proofs = [];
  if (!(declaration.receipts || []).length) {
    gates.proof.notApplicable('no proof artifact declared (--receipt)');
  } else {
    gates.proof.evidence.receipts = [];
    for (const location of declaration.receipts) {
      const receipt = await read(gates.proof, async () => readAppReceipt(location, { repository: repo, head }));
      if (!receipt.ok) continue;
      gates.proof.evidence.receipts.push(receipt.value.evidence);
      proofs.push(receipt.value.evidence);
      for (const reason of receipt.value.reasons) gates.proof.unresolved(reason);
    }
  }

  // ---- Counterparts ----
  {
    const counterparts = gates.counterparts;
    counterparts.evidence.items = [];
    const checked = [];
    if (work) {
      const blockers = await read(counterparts, () => github.getAll(`/repos/${repo}/issues/${work.number}/dependencies/blocked_by?per_page=100`));
      if (blockers.ok) {
        for (const item of blockers.value) {
          const blockerRepo = String(item.repository_url || '').replace('https://api.github.com/repos/', '');
          const ref = `${blockerRepo}#${item.number}`;
          checked.push(ref);
          counterparts.evidence.items.push({ ref, kind: 'blocked-by', state: item.state, stateReason: item.state_reason ?? null, url: item.html_url });
          if (!blockerRepo.startsWith(`${owner}/`)) counterparts.unresolved(`blocked by ${ref}, outside owned repositories; verify it manually`);
          else if (item.state !== 'closed') counterparts.unresolved(`blocked by ${ref}, which is open`);
          else if (item.state_reason !== 'completed') counterparts.unresolved(`blocked by ${ref}, closed as ${item.state_reason}`);
        }
      }
    }
    for (const ref of declaration.counterparts || []) {
      const match = ref.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
      if (!match) {
        counterparts.unresolved(`${ref} is not an owner/repository#number reference`);
        continue;
      }
      if (match[1] !== owner) {
        counterparts.unresolved(`${ref} is not an owned repository; this preflight reads only ${owner} counterparts`);
        continue;
      }
      checked.push(ref);
      const itemRepo = `${match[1]}/${match[2]}`;
      const found = await read(counterparts, () => github.get(`/repos/${itemRepo}/issues/${match[3]}`));
      if (!found.ok) continue;
      if (found.value.pull_request) {
        const pull = await read(counterparts, () => github.get(`/repos/${itemRepo}/pulls/${match[3]}`));
        if (!pull.ok) continue;
        const pullMerged = Boolean(pull.value.merged || pull.value.merged_at);
        counterparts.evidence.items.push({ ref, kind: 'pull-request', state: pullMerged ? 'merged' : pull.value.state, head: pull.value.head ? pull.value.head.sha : null, mergeCommit: pull.value.merge_commit_sha ?? null, url: found.value.html_url });
        if (pullMerged) continue;
        counterparts.unresolved(pull.value.state === 'open' ? `${ref} is open (head ${short(pull.value.head.sha)})` : `${ref} closed without merge`);
      } else {
        counterparts.evidence.items.push({ ref, kind: 'issue', state: found.value.state, stateReason: found.value.state_reason ?? null, url: found.value.html_url });
        if (found.value.state !== 'closed') counterparts.unresolved(`${ref} is open`);
        else if (found.value.state_reason !== 'completed') counterparts.unresolved(`${ref} closed as ${found.value.state_reason}`);
      }
    }
    if (!checked.length && counterparts.status === 'satisfied' && !(declaration.counterparts || []).length) {
      if (work) counterparts.note(`${work.reference} has no native blockers and no counterpart is declared`);
      else counterparts.notApplicable('no work issue or counterpart declared');
    }
  }

  gates.live.reasons.length = 0;
  gates.live.status = 'satisfied';
  evaluateLive(gates.live, declaration, proofs);
  return finish();
}

function evaluateLive(gate, declaration, proofs) {
  const line = declaration.finishLine;
  if (line === 'source') {
    gate.notApplicable('source-only finish line: installation, real-client and physical acceptance are separate and not required here');
    return;
  }
  gate.unresolved(`${line} acceptance needs the owner's evidence under its owning issue; this preflight reads no installation, client or device state, and CI, fixtures and simulator receipts cannot satisfy it`);
  for (const proof of proofs) {
    if (proof.simulated.length) gate.note(`proof ${proof.runId} is simulated: ${proof.simulated.join(', ')}; it does not count toward ${line} acceptance`);
  }
}
