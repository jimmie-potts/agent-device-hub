// Evaluate one declared delivery comparison against the Hub delivery gates in
// docs/sdlc.md. Every gate is re-read from GitHub and local proof on each run;
// missing, pending, skipped, failed or stale evidence stays unresolved, and a
// failed read is a read failure, never success.
import { evaluateCi } from './ci.mjs';
import { COMPARE_FILE_LIMIT, Gate, GUIDE_ROOT, SDLC, createReader, short, touchedPaths } from './context.mjs';
import { QUERIES, ReadFailure } from './github.mjs';
import { RECEIPT_VERSION, describeLocal, readAppReceipt } from './receipts.mjs';
import { isBot, readRecord } from './records.mjs';
import { POLICY_PATHS, REVIEW_FORMAT, collectReports, judgeRound, policyComponents, requirementReference } from './reviews.mjs';

export const FINISH_LINES = ['source', 'installed', 'real-client', 'physical'];
// The one bot-opened delivery: the nightly guide refresh, which carries no work issue.
export const GUIDE_REFRESH_BRANCH = 'guide/nightly-refresh';
const PR_FILE_LIMIT = 3000;

function issueReferences(body) {
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
    // Ignored legacy inputs carry no evidence and are not echoed.
    ui: false,
    uiApproval: null,
    guideReceipts: (declaration.guideReceipts || []).map(describeLocal),
    guideRecords: declaration.guideRecords || [],
  };
}

export async function runPreflight({ github, declaration, now = () => new Date() }) {
  const readAt = now().toISOString();
  const repo = declaration.repo;
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
  const ctx = { github, declaration, repo, owner: repo.split('/')[0], gates, read: createReader(readFailures) };
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
  const finish = () => {
    const list = Object.values(gates);
    report.gates = list.map(gate => gate.toJSON());
    report.result = list.some(gate => gate.status === 'read-failure') ? 'read-failure'
      : list.some(gate => gate.status === 'unresolved') ? 'unresolved' : 'satisfied';
    report.exitCode = { satisfied: 0, unresolved: 1, 'read-failure': 2 }[report.result];
    const subject = report.candidate ? `head ${report.candidate.head}` : `PR #${declaration.pr}`;
    report.notice = `Read at ${readAt} for ${subject}. GitHub state is volatile: re-run immediately before any merge or closure. This report is not authorization to merge, close issues or install.`;
    return report;
  };

  if (!(await loadCandidate(ctx))) {
    for (const gate of Object.values(gates)) {
      if (gate !== gates.identity) gate.notEvaluated('the PR could not be read');
    }
    return finish();
  }
  report.candidate = {
    repository: repo,
    pr: ctx.pr.number,
    url: ctx.pr.html_url,
    state: ctx.state,
    draft: Boolean(ctx.pr.draft),
    head: ctx.head,
    headRef: ctx.pr.head.ref,
    base: ctx.base,
    baseRef: ctx.baseRef,
    mergeBase: ctx.mergeBase,
    mergeCommit: ctx.merged ? ctx.pr.merge_commit_sha : null,
  };
  evaluateIdentity(ctx);
  await evaluateCiGates(ctx);
  const comments = await ctx.read(gates.review, () => github.getAll(`/repos/${repo}/issues/${ctx.pr.number}/comments?per_page=100`));
  if (comments.ok) {
    await evaluateReview(ctx, comments.value);
    await evaluateFeedback(ctx, comments.value);
  } else {
    gates.feedback.notEvaluated('PR comments could not be read');
  }
  await evaluateUi(ctx);
  const proofs = await evaluateProof(ctx);
  await evaluateCounterparts(ctx);
  evaluateLive(gates.live, declaration, proofs);
  return finish();
}

/** Read the PR and everything the gates share. Returns false when the PR is unreadable. */
async function loadCandidate(ctx) {
  const { github, repo, gates, declaration } = ctx;
  const prRead = await ctx.read(gates.identity, () => github.get(`/repos/${repo}/pulls/${declaration.pr}`));
  if (!prRead.ok) return false;
  const pr = prRead.value;
  ctx.pr = pr;
  ctx.merged = Boolean(pr.merged || pr.merged_at);
  ctx.state = ctx.merged ? 'merged' : pr.state === 'open' ? 'open' : 'closed';
  ctx.head = pr.head.sha;
  ctx.baseRef = pr.base.ref;
  ctx.base = null;
  ctx.mergeBase = null;
  if (ctx.merged) {
    ctx.base = pr.base.sha;
  } else {
    const ref = await ctx.read(gates.identity, () => github.get(`/repos/${repo}/git/ref/heads/${ctx.baseRef}`));
    if (ref.ok) ctx.base = ref.value.object.sha;
  }
  if (ctx.base) {
    const compare = await ctx.read(gates.identity, () => github.get(`/repos/${repo}/compare/${ctx.base}...${ctx.head}`));
    if (compare.ok) {
      ctx.mergeBase = compare.value.merge_base_commit.sha;
      ctx.baseCompareFiles = compare.value.files || [];
    }
  }
  // Review reports and records come from the delivery account: the PR author,
  // or the repository owner when a bot opened the PR.
  ctx.publisher = pr.user && pr.user.login && !isBot(pr.user) ? pr.user.login : ctx.owner;

  const files = await ctx.read(gates.ciPr, () => github.getAll(`/repos/${repo}/pulls/${pr.number}/files?per_page=100`));
  ctx.filesRead = files.ok;
  ctx.paths = files.ok ? touchedPaths(files.value) : [];
  ctx.filesComplete = files.ok && files.value.length === pr.changed_files && files.value.length < PR_FILE_LIMIT;
  if (files.ok && !ctx.filesComplete) gates.ciPr.note(`the changed-file list is incomplete (${files.value.length} of ${pr.changed_files})`);
  ctx.guideRefresh = isBot(pr.user) && pr.head.ref === GUIDE_REFRESH_BRANCH
    && ctx.filesComplete && ctx.paths.length > 0 && ctx.paths.every(file => file.startsWith(GUIDE_ROOT));

  const references = issueReferences(pr.body);
  ctx.references = references;
  const number = declaration.issue ?? (references.length === 1 ? references[0] : null);
  ctx.work = number ? { number, reference: `${repo}#${number}`, url: `https://github.com/${repo}/issues/${number}` } : null;

  // Pull-request state that GitHub only exposes through GraphQL.
  const [ownerName, repoName] = repo.split('/');
  ctx.prState = await ctx.read(gates.feedback, async () => {
    const threads = [];
    let closing = [];
    let after = null;
    for (let page = 0; page < 20; page += 1) {
      const data = await github.graphql(QUERIES.PullRequestState, { owner: ownerName, name: repoName, number: pr.number, after });
      const pull = data.repository && data.repository.pullRequest;
      if (!pull) throw new ReadFailure('GraphQL PullRequestState', 'pull request not found');
      closing = pull.closingIssuesReferences.nodes;
      threads.push(...pull.reviewThreads.nodes);
      if (!pull.reviewThreads.pageInfo.hasNextPage) return { threads, closing };
      after = pull.reviewThreads.pageInfo.endCursor;
    }
    throw new ReadFailure('GraphQL PullRequestState', 'too many review thread pages');
  });
  return true;
}

function evaluateIdentity(ctx) {
  const { gates, declaration, pr, repo } = ctx;
  const identity = gates.identity;
  identity.evidence = { mergeableState: pr.mergeable_state ?? null, workIssue: ctx.work ? ctx.work.url : null };
  if (declaration.head && declaration.head !== ctx.head) identity.unresolved(`head changed: declared ${short(declaration.head)}, live ${short(ctx.head)}`);
  if (declaration.base && ctx.base && declaration.base !== ctx.base) {
    identity.unresolved(ctx.merged
      ? `base changed: declared ${short(declaration.base)}, the PR merged onto ${short(ctx.base)}`
      : `base changed: declared ${short(declaration.base)}, ${ctx.baseRef} is now ${short(ctx.base)}`);
  }
  if (ctx.state === 'closed') identity.unresolved('the PR is closed without merge');
  if (pr.draft) identity.unresolved('the PR is a draft');
  if (ctx.state === 'open' && pr.mergeable_state === 'dirty') identity.unresolved('the PR has merge conflicts with its base');
  if (pr.head.repo && pr.head.repo.full_name !== repo) identity.unresolved(`the head comes from ${pr.head.repo.full_name}, not ${repo}`);
  if (ctx.baseRef !== 'main') identity.unresolved(`the PR targets ${ctx.baseRef}, not main`);

  if (!declaration.issue && ctx.references.length !== 1) {
    const problem = ctx.references.length
      ? `the work issue is ambiguous: the PR body references ${ctx.references.map(n => `#${n}`).join(', ')}; declare --issue`
      : 'no work issue: the PR body has no Refs #<issue>; declare --issue';
    if (ctx.guideRefresh) identity.note(`${problem} (not required for the bot-opened nightly guide refresh)`);
    else identity.unresolved(problem);
  } else if (declaration.issue && !ctx.references.includes(declaration.issue)) {
    identity.note(`the PR body does not reference the declared #${declaration.issue}`);
  }

  if (!ctx.prState.ok) {
    identity.notEvaluated('closing issue references could not be read');
  } else if (ctx.state === 'open') {
    for (const item of ctx.prState.value.closing) {
      const ref = item.repository.nameWithOwner === repo ? `#${item.number}` : `${item.repository.nameWithOwner}#${item.number}`;
      identity.unresolved(`the PR closes ${ref} on merge; use Refs so closure waits for merged-main CI`);
    }
  }
}

async function evaluateCiGates(ctx) {
  const { github, repo, gates, pr } = ctx;
  const rules = await ctx.read(gates.ciPr, () => github.getAll(`/repos/${repo}/rules/branches/${ctx.baseRef}?per_page=100`));
  const requiredContexts = rules.ok
    ? rules.value.filter(rule => rule.type === 'required_status_checks')
      .flatMap(rule => (rule.parameters && rule.parameters.required_status_checks) || []).map(check => check.context)
    : [];
  if (ctx.filesRead && rules.ok) {
    await evaluateCi(ctx, gates.ciPr, {
      sha: ctx.head, event: 'pull_request', branch: ctx.baseRef, checkBranch: pr.head.ref,
      paths: ctx.paths, filesComplete: ctx.filesComplete, requiredContexts, baseline: ctx.mergeBase,
    });
  }

  if (!ctx.merged) {
    gates.ciMain.notApplicable('applies after merge: merged-main CI is read before issue closure');
    return;
  }
  if (!pr.merge_commit_sha) {
    gates.ciMain.unresolved('the merged PR has no merge commit to verify');
    return;
  }
  const commit = await ctx.read(gates.ciMain, () => github.get(`/repos/${repo}/commits/${pr.merge_commit_sha}`));
  if (!commit.ok) return;
  const files = Array.isArray(commit.value.files) ? commit.value.files : [];
  gates.ciMain.evidence.parent = commit.value.parents && commit.value.parents[0] ? commit.value.parents[0].sha : null;
  await evaluateCi(ctx, gates.ciMain, {
    sha: pr.merge_commit_sha, event: 'push', branch: ctx.baseRef, checkBranch: ctx.baseRef,
    paths: touchedPaths(files), filesComplete: files.length > 0 && files.length < COMPARE_FILE_LIMIT, requiredContexts: [],
  });
}

async function evaluateReview(ctx, comments) {
  const review = ctx.gates.review;
  const { rounds, ignored } = collectReports(comments, ctx.publisher);
  review.evidence.rounds = rounds.map(round => ({ round: `final ${round.round}`, head: round.head, url: round.url }));
  if (ignored.length) review.evidence.ignoredReports = ignored;
  if (!ctx.work) {
    if (ctx.guideRefresh) review.note('no work issue for the nightly guide refresh; the review Work row is not matched');
    else review.unresolved('the review cannot be matched to a work issue; declare --issue');
  }
  if (!rounds.length) {
    review.unresolved(`no retained final review report in the agent-skills#54 format (a PR comment from ${ctx.publisher} starting with a deliver-work report marker)`);
    return;
  }
  if (!ctx.base || !ctx.mergeBase) {
    review.notEvaluated('the current base or merge-base could not be read');
    return;
  }
  const latest = rounds.at(-1);
  const judged = judgeRound(latest, { current: { base: ctx.base, head: ctx.head, mergeBase: ctx.mergeBase }, work: ctx.work });
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
  if (judged.reviewedBase && latest.head === ctx.head && judged.reviewedBase !== ctx.base) await noteBaseMove(ctx, review, judged.reviewedBase);
  await checkRequirements(ctx, review, judged.rows.Requirements);
  await checkPolicy(ctx, review, judged.rows.Policy);
}

/** Help reassessment after a base move: say whether the candidate's own diff changed. */
async function noteBaseMove(ctx, gate, reviewedBase) {
  const key = files => JSON.stringify((files || []).map(file => [file.filename, file.status, file.sha]).sort());
  let before;
  try {
    before = await ctx.github.get(`/repos/${ctx.repo}/compare/${reviewedBase}...${ctx.head}`);
  } catch (error) {
    if (error instanceof ReadFailure) {
      gate.note('the base moved since review; the earlier diff could not be read for comparison');
      return;
    }
    throw error;
  }
  const sizes = [before.files || [], ctx.baseCompareFiles || []];
  if (sizes.some(files => files.length >= COMPARE_FILE_LIMIT)) return;
  gate.note(key(before.files) === key(ctx.baseCompareFiles)
    ? `the base moved from ${short(reviewedBase)} to ${short(ctx.base)}; the candidate's diff is unchanged (same files and blob SHAs), so reassessment can focus on the new base`
    : `the base moved from ${short(reviewedBase)} to ${short(ctx.base)} and the candidate's diff changed`);
}

async function checkRequirements(ctx, gate, value) {
  if (!value || value === 'none') return;
  const parsed = requirementReference(value);
  if (!parsed) {
    gate.unresolved('the Requirements row cannot be read');
    return;
  }
  if (!parsed.issue) {
    gate.note('the requirements source is not a GitHub issue and is not rechecked');
    return;
  }
  if (parsed.issue.owner !== ctx.owner) {
    gate.unresolved(`requirements ${parsed.reference} are outside owned repositories; recheck them manually`);
    return;
  }
  const reviewedAt = Date.parse(parsed.version);
  if (Number.isNaN(reviewedAt)) {
    gate.unresolved('the requirement version is not a timestamp, so its freshness cannot be checked');
    return;
  }
  const issue = await ctx.read(gate, async () => {
    const data = await ctx.github.graphql(QUERIES.RequirementVersion, parsed.issue);
    if (!data.repository || !data.repository.issue) throw new ReadFailure('GraphQL RequirementVersion', `${parsed.reference} not found`);
    return data.repository.issue;
  });
  if (!issue.ok) return;
  const edited = issue.value.lastEditedAt || issue.value.createdAt;
  gate.evidence.requirementsEditedAt = edited;
  if (Date.parse(edited) > reviewedAt) gate.unresolved(`requirements changed after review: ${parsed.reference} was edited ${edited}, reviewed at ${parsed.version}`);
}

async function checkPolicy(ctx, gate, value) {
  if (!value || value === 'unknown') return;
  for (const component of policyComponents(value, ctx.repo)) {
    if (!component.local) {
      gate.note('a policy source outside this repository is not rechecked');
      continue;
    }
    const compare = await ctx.read(gate, () => ctx.github.get(`/repos/${ctx.repo}/compare/${component.revision}...${ctx.base}`));
    if (!compare.ok) continue;
    if (!['ahead', 'identical'].includes(compare.value.status)) {
      gate.unresolved(`policy revision ${short(component.revision)} is not an ancestor of the base ${short(ctx.base)}`);
      continue;
    }
    const changed = (compare.value.files || []).map(file => file.filename);
    if (changed.length >= COMPARE_FILE_LIMIT) {
      gate.unresolved(`cannot confirm policy freshness: at least ${COMPARE_FILE_LIMIT} files changed since ${short(component.revision)}`);
      continue;
    }
    const policy = changed.filter(file => POLICY_PATHS.includes(file));
    if (policy.length) gate.unresolved(`policy changed after review: ${policy.join(', ')} changed since ${short(component.revision)}`);
  }
}

async function evaluateFeedback(ctx, comments) {
  const feedback = ctx.gates.feedback;
  const reviews = await ctx.read(feedback, () => ctx.github.getAll(`/repos/${ctx.repo}/pulls/${ctx.pr.number}/reviews?per_page=100`));
  if (reviews.ok) {
    const latestByUser = new Map();
    for (const item of reviews.value) {
      if (!['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(item.state) || !item.user) continue;
      latestByUser.set(item.user.login, item);
    }
    for (const [login, item] of latestByUser) {
      if (item.state === 'CHANGES_REQUESTED') feedback.unresolved(`changes requested by ${login} (${item.html_url})`);
    }
  }
  if (ctx.prState.ok) {
    const open = ctx.prState.value.threads.filter(thread => !thread.isResolved);
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
      providerResults.push({ provider: 'codex-security-review', head: data.headSha ?? null, status: data.status ?? null, coversHead: data.headSha === ctx.head, url: item.html_url });
    } else if (item.user && item.user.login !== ctx.publisher) {
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

function evaluateUi(ctx) {
  // Retain the schema-1 entry for readers of older reports. Neither path nor
  // legacy CLI declarations create a human approval requirement.
  ctx.gates.ui.notApplicable('human UI approval is not required; applicable browser/accessibility checks, independent reviews and CI remain required');
}

async function evaluateProof(ctx) {
  const proof = ctx.gates.proof;
  const proofs = [];
  const receipts = ctx.declaration.receipts || [];
  if (!receipts.length) {
    proof.notApplicable('no proof artifact declared (--receipt)');
    return proofs;
  }
  proof.evidence.receipts = [];
  for (const location of receipts) {
    const receipt = await ctx.read(proof, async () => readAppReceipt(location, { repository: ctx.repo, head: ctx.head }));
    if (!receipt.ok) continue;
    proof.evidence.receipts.push(receipt.value.evidence);
    proofs.push(receipt.value.evidence);
    for (const reason of receipt.value.reasons) proof.unresolved(reason);
  }
  return proofs;
}

async function evaluateCounterparts(ctx) {
  const { github, repo, owner, declaration } = ctx;
  const counterparts = ctx.gates.counterparts;
  counterparts.evidence.items = [];
  const declared = declaration.counterparts || [];
  if (ctx.work) {
    const blockers = await ctx.read(counterparts, () => github.getAll(`/repos/${repo}/issues/${ctx.work.number}/dependencies/blocked_by?per_page=100`));
    if (blockers.ok) {
      for (const item of blockers.value) {
        const blockerRepo = String(item.repository_url || '').replace('https://api.github.com/repos/', '');
        const ref = `${blockerRepo}#${item.number}`;
        counterparts.evidence.items.push({ ref, kind: 'blocked-by', state: item.state, stateReason: item.state_reason ?? null, url: item.html_url });
        if (!blockerRepo.startsWith(`${owner}/`)) counterparts.unresolved(`blocked by ${ref}, outside owned repositories; verify it manually`);
        else if (item.state !== 'closed') counterparts.unresolved(`blocked by ${ref}, which is open`);
        else if (item.state_reason !== 'completed') counterparts.unresolved(`blocked by ${ref}, closed as ${item.state_reason}`);
      }
      if (!blockers.value.length && !declared.length) counterparts.note(`${ctx.work.reference} has no native blockers and no counterpart is declared`);
    }
  } else if (ctx.guideRefresh && !declared.length) {
    counterparts.notApplicable('the nightly guide refresh has no work issue and no counterpart is declared');
  } else if (!ctx.guideRefresh) {
    counterparts.unresolved('blockers were not read: no single work issue; declare --issue');
  }
  for (const ref of declared) {
    const match = ref.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
    if (!match) {
      counterparts.unresolved(`${ref} is not an owner/repository#number reference`);
      continue;
    }
    if (match[1] !== owner) {
      counterparts.unresolved(`${ref} is not an owned repository; this preflight reads only ${owner} counterparts`);
      continue;
    }
    const itemRepo = `${match[1]}/${match[2]}`;
    const found = await ctx.read(counterparts, () => github.get(`/repos/${itemRepo}/issues/${match[3]}`));
    if (!found.ok) continue;
    if (found.value.pull_request) {
      const pull = await ctx.read(counterparts, () => github.get(`/repos/${itemRepo}/pulls/${match[3]}`));
      if (!pull.ok) continue;
      const merged = Boolean(pull.value.merged || pull.value.merged_at);
      counterparts.evidence.items.push({ ref, kind: 'pull-request', state: merged ? 'merged' : pull.value.state, head: pull.value.head ? pull.value.head.sha : null, mergeCommit: pull.value.merge_commit_sha ?? null, url: found.value.html_url });
      if (!merged) counterparts.unresolved(pull.value.state === 'open' ? `${ref} is open (head ${short(pull.value.head && pull.value.head.sha)})` : `${ref} closed without merge`);
    } else {
      counterparts.evidence.items.push({ ref, kind: 'issue', state: found.value.state, stateReason: found.value.state_reason ?? null, url: found.value.html_url });
      if (found.value.state !== 'closed') counterparts.unresolved(`${ref} is open`);
      else if (found.value.state_reason !== 'completed') counterparts.unresolved(`${ref} closed as ${found.value.state_reason}`);
    }
  }
}

function evaluateLive(gate, declaration, proofs) {
  const line = declaration.finishLine;
  if (line === 'source') {
    gate.notApplicable('source-stage check only: installation, real-client and physical acceptance are not inspected; a satisfied report does not establish completed delivery');
    return;
  }
  gate.unresolved(`${line} acceptance needs the owner's evidence under its owning issue; this preflight reads no installation, client or device state, and CI, fixtures and simulator receipts cannot satisfy it`);
  for (const proof of proofs) {
    if (proof.simulated.length) gate.note(`proof ${proof.runId} is simulated: ${proof.simulated.join(', ')}; it does not count toward ${line} acceptance`);
  }
}
