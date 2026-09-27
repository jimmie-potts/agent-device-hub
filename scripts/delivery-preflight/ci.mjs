// Depot CI evidence (docs/sdlc.md#depot-ci-evidence) and the guide-only CI
// exception (docs/sdlc.md#guide-only-ci-exception) for one revision.
import { createHash } from 'node:crypto';

import { DEPOT_APP, GUIDE_ROOT, SDLC, short } from './context.mjs';
import { GUIDE_HTML_PATH, readGuideReceipt } from './receipts.mjs';
import { guideRecordResults, readRecord } from './records.mjs';
import { expectedJobs, parseWorkflow } from './workflows.mjs';

async function readWorkflows(ctx, gate, sha) {
  const { github, repo } = ctx;
  return ctx.read(gate, async () => {
    const listing = await github.get(`/repos/${repo}/contents/.depot/workflows?ref=${sha}`);
    const files = (Array.isArray(listing) ? listing : []).filter(item => item.type === 'file' && /\.ya?ml$/.test(item.name));
    const parsed = [];
    for (const item of files) {
      const content = await github.get(`/repos/${repo}/contents/${item.path}?ref=${sha}`);
      const text = Buffer.from(content.content || '', 'base64').toString('utf8');
      try {
        parsed.push(parseWorkflow(item.name, text));
      } catch {
        gate.unresolved(`cannot parse workflow ${item.name} at ${short(sha)}`);
      }
    }
    return parsed;
  });
}

/**
 * Evaluate one revision's CI. `checkBranch` is the check suite branch that
 * identifies the event: the PR head branch for pull_request, main for push.
 */
export async function evaluateCi(ctx, gate, { sha, event, branch, checkBranch, paths, filesComplete, requiredContexts, baseline }) {
  gate.evidence.revision = sha;
  gate.evidence.event = event;
  const workflows = await readWorkflows(ctx, gate, sha);
  if (!workflows.ok) return;
  const scope = { event, branch, files: paths, filesComplete };
  const expected = expectedJobs(workflows.value, scope);
  for (const reason of expected.uncertain) gate.unresolved(`cannot enumerate expected jobs: ${reason}`);
  for (const reason of expected.notes) gate.note(reason);
  const names = [...new Set([...expected.jobs.map(job => job.name), ...requiredContexts])];
  gate.evidence.expected = names;
  gate.evidence.filtered = expected.filtered;

  // A candidate that edits its own workflows cannot lower its gate silently.
  if (baseline && paths.some(file => file.startsWith('.depot/workflows/'))) {
    const before = await readWorkflows(ctx, gate, baseline);
    if (before.ok) {
      const dropped = expectedJobs(before.value, scope).jobs.map(job => job.name).filter(name => !names.includes(name));
      for (const name of dropped) gate.unresolved(`${name}: expected at ${short(baseline)} but dropped by the candidate's workflow change; confirm the intended coverage`);
      if (!dropped.length) gate.note(`the candidate changes .depot/workflows/; no job expected at ${short(baseline)} is dropped`);
    }
  }

  const outside = paths.filter(file => !file.startsWith(GUIDE_ROOT));
  const guideOnly = filesComplete && paths.length > 0 && outside.length === 0;
  if (!names.length && !expected.uncertain.length) {
    if (guideOnly && expected.filtered.length) await evaluateGuideException(ctx, gate, { sha });
    else gate.unresolved('no configured job applies and no exception covers this change');
    return;
  }
  gate.evidence.mode = 'depot';
  const { guideReceipts = [], guideRecords = [] } = ctx.declaration;
  if (guideReceipts.length || guideRecords.length) {
    let why;
    if (!filesComplete) why = 'the changed-file list is incomplete';
    else if (outside.length) why = `not guide-only: ${outside.slice(0, 5).join(', ')}`;
    else if (expected.jobs.length) why = 'configured jobs still run for this change';
    else why = `branch rules require ${requiredContexts.join(', ')}`;
    gate.note(`the guide-only exception does not apply: ${why}`);
  }
  await evaluateChecks(ctx, gate, { sha, names, checkBranch });
}

async function evaluateChecks(ctx, gate, { sha, names, checkBranch }) {
  const { github, repo } = ctx;
  const evidence = await ctx.read(gate, async () => ({
    runs: await github.getAll(`/repos/${repo}/commits/${sha}/check-runs?per_page=100&filter=all`, 'check_runs'),
    suites: await github.getAll(`/repos/${repo}/commits/${sha}/check-suites?per_page=100`, 'check_suites'),
  }));
  if (!evidence.ok) return;
  const suites = new Map(evidence.value.suites.map(item => [item.id, item]));
  const disqualified = run => {
    const suite = suites.get(run.check_suite && run.check_suite.id);
    if (!run.app || run.app.slug !== DEPOT_APP) return 'another app';
    if (run.head_sha !== sha) return 'another revision';
    if (!suite) return 'unknown check suite';
    if (!suite.repository || suite.repository.full_name !== repo) return 'another repository';
    if (suite.head_branch !== checkBranch) return `event on ${suite.head_branch}, expected ${checkBranch}`;
    return null;
  };
  const resultOf = run => (run.status === 'completed' ? run.conclusion : 'pending');
  const jobs = [];
  for (const name of names) {
    const attempts = evidence.value.runs.filter(run => run.name === name && !disqualified(run))
      .sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)) || a.id - b.id);
    if (!attempts.length) {
      jobs.push({ name, result: 'missing' });
      gate.unresolved(`${name}: missing`);
      continue;
    }
    const latest = attempts.at(-1);
    const result = resultOf(latest);
    const job = {
      name,
      result,
      checkRunId: latest.id,
      detailsUrl: latest.details_url ?? null,
      htmlUrl: latest.html_url ?? null,
      superseded: attempts.slice(0, -1).map(run => ({ checkRunId: run.id, result: resultOf(run) })),
    };
    jobs.push(job);
    if (result === 'pending') gate.unresolved(`${name}: pending (${latest.status})`);
    else if (result !== 'success') gate.unresolved(`${name}: ${result}`);
    else if (job.superseded.some(item => item.result === 'pending')) gate.unresolved(`${name}: an earlier attempt is still running`);
    if (result === 'success' && latest.output && latest.output.annotations_count > 0) {
      const annotations = await ctx.read(gate, () => github.getAll(`/repos/${repo}/check-runs/${latest.id}/annotations?per_page=100`));
      if (annotations.ok) {
        job.annotations = annotations.value.length;
        if (annotations.value.some(item => item.annotation_level === 'failure')) {
          gate.unresolved(`${name}: success with a failure annotation; resolve the contradiction`);
        }
      }
    }
  }
  gate.evidence.jobs = jobs;
  const unexpected = evidence.value.runs.filter(run => !disqualified(run) && !names.includes(run.name));
  if (unexpected.length) gate.evidence.unexpected = unexpected.map(run => ({ name: run.name, checkRunId: run.id, result: resultOf(run) }));
  const ignored = evidence.value.runs.map(run => [run, disqualified(run)]).filter(([, why]) => why);
  if (ignored.length) gate.evidence.ignoredRuns = ignored.map(([run, why]) => ({ checkRunId: run.id, name: run.name, why }));
}

/**
 * The guide-only exception for one revision: no Depot run, a guide receipt that
 * matches the committed guide HTML, and the delivery account's record naming
 * the revision, the HTML hash and passing local checks.
 */
async function evaluateGuideException(ctx, gate, { sha }) {
  const { github, repo, declaration } = ctx;
  gate.evidence.mode = 'guide-only-exception';
  gate.note(`every changed path is under ${GUIDE_ROOT} and every workflow filters it; ${SDLC}#guide-only-ci-exception applies only with its evidence`);
  const runs = await ctx.read(gate, () => github.getAll(`/repos/${repo}/commits/${sha}/check-runs?per_page=100&filter=all`, 'check_runs'));
  if (runs.ok && runs.value.some(run => run.app && run.app.slug === DEPOT_APP)) {
    gate.unresolved(`Depot runs exist for ${short(sha)} although the filters exclude this change; resolve that before using the exception`);
  }
  const receipts = declaration.guideReceipts || [];
  const records = declaration.guideRecords || [];
  if (!receipts.length || !records.length) {
    gate.unresolved('the guide-only exception needs the guide verification receipt (--guide-receipt) and its PR record (--guide-record); missing runs alone do not establish it');
    if (!receipts.length) return;
  }
  const html = await ctx.read(gate, async () => {
    const item = await github.get(`/repos/${repo}/contents/${GUIDE_HTML_PATH}?ref=${sha}`);
    if (item.encoding === 'base64' && item.content) return Buffer.from(item.content, 'base64');
    const blob = await github.get(`/repos/${repo}/git/blobs/${item.sha}`);
    return Buffer.from(blob.content || '', 'base64');
  });
  if (!html.ok) return;
  const digest = createHash('sha256').update(html.value).digest('hex');
  gate.evidence.committedHtmlSha256 = digest;

  const readable = [];
  for (const file of receipts) {
    const receipt = await ctx.read(gate, async () => readGuideReceipt(file));
    if (receipt.ok) readable.push(receipt.value);
  }
  const receipt = readable.find(item => item.evidence.htmlSha256 === digest);
  if (!receipt) {
    if (readable.length) gate.unresolved(`no guide receipt's HTML hash matches the candidate's committed guide HTML at ${short(sha)}`);
    return;
  }
  gate.evidence.guideReceipt = receipt.evidence;
  for (const reason of receipt.reasons) gate.unresolved(reason);
  if (!records.length) return;

  const naming = [];
  const problems = [];
  for (const url of records) {
    const found = await readRecord(ctx, gate, url, 'guide record');
    if (!found) continue;
    if (!found.record.body.includes(sha)) continue;
    if (found.problems.length) problems.push(...found.problems);
    else naming.push(found.record);
  }
  if (!naming.length) {
    for (const problem of problems) gate.unresolved(problem);
    gate.unresolved(`no guide record from ${ctx.publisher} names ${short(sha)} in full; record the exception evidence for this revision`);
    return;
  }
  const record = naming.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1);
  gate.evidence.guideRecord = { url: record.url, author: record.author, createdAt: record.createdAt };
  if (!record.body.includes(digest)) gate.unresolved(`the guide record for ${short(sha)} does not name the HTML sha256 ${short(digest)}`);
  const results = guideRecordResults(record.body);
  gate.evidence.guideRecord.checks = results;
  for (const check of results.failed) gate.unresolved(`the guide record reports ${check} failed`);
  for (const check of results.unverified) gate.unresolved(`the guide record does not show a passing result for ${check}; it remains unverified`);
}
