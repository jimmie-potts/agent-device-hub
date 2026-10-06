// CI evidence (docs/sdlc.md#ci-evidence) and the guide-only CI exception
// (docs/sdlc.md#guide-only-ci-exception) for one revision.
import { createHash } from 'node:crypto';

import { CI_PROVIDERS, GUIDE_ROOT, SDLC, short } from './context.mjs';
import { ReadFailure } from './github.mjs';
import { GUIDE_HTML_PATH, readGuideReceipt } from './receipts.mjs';
import { guideRecordResults, readRecord } from './records.mjs';
import { expectedJobs, parseWorkflow } from './workflows.mjs';

/** The revision's CI provider and parsed workflows: the first provider whose directory holds a workflow. */
async function readWorkflows(ctx, gate, sha) {
  const { github, repo } = ctx;
  return ctx.read(gate, async () => {
    for (const provider of CI_PROVIDERS) {
      let listing;
      try {
        listing = await github.get(`/repos/${repo}/contents/${provider.directory}?ref=${sha}`);
      } catch (error) {
        if (error instanceof ReadFailure && /^HTTP 404\b/.test(error.detail)) continue;
        throw error;
      }
      const files = (Array.isArray(listing) ? listing : []).filter(item => item.type === 'file' && /\.ya?ml$/.test(item.name));
      if (!files.length) continue;
      const workflows = [];
      for (const item of files) {
        const content = await github.get(`/repos/${repo}/contents/${item.path}?ref=${sha}`);
        const text = Buffer.from(content.content || '', 'base64').toString('utf8');
        try {
          workflows.push(parseWorkflow(item.name, text));
        } catch {
          gate.unresolved(`cannot parse workflow ${item.path} at ${short(sha)}`);
        }
      }
      return { provider, workflows };
    }
    return { provider: null, workflows: [] };
  });
}

const workflowPath = file => CI_PROVIDERS.some(provider => file.startsWith(`${provider.directory}/`));

/**
 * Evaluate one revision's CI. `checkBranch` is the check suite branch that
 * identifies the event: the PR head branch for pull_request, main for push.
 */
export async function evaluateCi(ctx, gate, { sha, event, branch, checkBranch, paths, filesComplete, requiredContexts, baseline }) {
  gate.evidence.revision = sha;
  gate.evidence.event = event;
  const read = await readWorkflows(ctx, gate, sha);
  if (!read.ok) return;
  const { provider, workflows } = read.value;
  if (!provider) {
    gate.unresolved(`${short(sha)} has no workflow in ${CI_PROVIDERS.map(item => item.directory).join(' or ')}`);
    return;
  }
  gate.evidence.provider = provider.id;
  const scope = { event, branch, files: paths, filesComplete };
  const expected = expectedJobs(workflows, scope, provider);
  for (const reason of expected.uncertain) gate.unresolved(`cannot enumerate expected jobs: ${reason}`);
  for (const reason of expected.notes) gate.note(reason);
  const names = [...new Set([...expected.jobs.map(job => job.name), ...requiredContexts])];
  gate.evidence.expected = names;
  gate.evidence.filtered = expected.filtered;

  // A candidate that edits its own workflows, or moves them to another provider,
  // cannot lower its gate silently. Jobs are compared by "<workflow> / <job>".
  if (baseline && paths.some(workflowPath)) {
    const before = await readWorkflows(ctx, gate, baseline);
    if (before.ok && before.value.provider) {
      const keys = new Set(expected.jobs.map(job => job.key));
      const dropped = expectedJobs(before.value.workflows, scope, before.value.provider).jobs.map(job => job.key).filter(key => !keys.has(key));
      for (const key of dropped) gate.unresolved(`${key}: expected at ${short(baseline)} but dropped by the candidate's workflow change; confirm the intended coverage`);
      const moved = before.value.provider.id === provider.id ? '' : ` and moves CI from ${before.value.provider.title} to ${provider.title}`;
      if (!dropped.length) gate.note(`the candidate changes its workflows${moved}; no job expected at ${short(baseline)} is dropped`);
    } else if (before.ok) {
      gate.note(`${short(baseline)} has no workflows, so there is no earlier coverage to compare`);
    }
  }

  const outside = paths.filter(file => !file.startsWith(GUIDE_ROOT));
  const guideOnly = filesComplete && paths.length > 0 && outside.length === 0;
  if (!names.length && !expected.uncertain.length) {
    if (guideOnly && expected.filtered.length) await evaluateGuideException(ctx, gate, { sha, provider });
    else gate.unresolved('no configured job applies and no exception covers this change');
    return;
  }
  gate.evidence.mode = provider.id;
  // Hub #861: Checks also ignores Markdown, so guide files that change together with other Markdown skip its suites.
  // The revision then needs the guide evidence, as a guide-only change does.
  const guidePaths = paths.filter(file => file.startsWith(GUIDE_ROOT));
  const guideRidesAlong = filesComplete && guidePaths.length > 0 && outside.length > 0 && expected.filtered.length > 0;
  const { guideReceipts = [], guideRecords = [] } = ctx.declaration;
  if (guideRidesAlong) {
    gate.note(`changed paths under ${GUIDE_ROOT} skip ${expected.filtered.map(item => item.workflow).join(', ')}; ${SDLC}#markdown-only-ci-routing requires the guide evidence`);
  } else if (guideReceipts.length || guideRecords.length) {
    let why;
    if (!filesComplete) why = 'the changed-file list is incomplete';
    else if (outside.length) why = `not guide-only: ${outside.slice(0, 5).join(', ')}`;
    else if (expected.jobs.length) why = 'configured jobs still run for this change';
    else why = `branch rules require ${requiredContexts.join(', ')}`;
    gate.note(`the guide-only exception does not apply: ${why}`);
  }
  await evaluateChecks(ctx, gate, { sha, names, checkBranch, provider });
  if (guideRidesAlong) await evaluateGuideEvidence(ctx, gate, { sha });
}

async function evaluateChecks(ctx, gate, { sha, names, checkBranch, provider }) {
  const { github, repo } = ctx;
  const evidence = await ctx.read(gate, async () => ({
    runs: await github.getAll(`/repos/${repo}/commits/${sha}/check-runs?per_page=100&filter=all`, 'check_runs'),
    suites: await github.getAll(`/repos/${repo}/commits/${sha}/check-suites?per_page=100`, 'check_suites'),
  }));
  if (!evidence.ok) return;
  const suites = new Map(evidence.value.suites.map(item => [item.id, item]));
  const disqualified = run => {
    const suite = suites.get(run.check_suite && run.check_suite.id);
    if (!run.app || run.app.slug !== provider.app) return 'another app';
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
  // Runs from a provider this revision no longer uses do not gate it, but they still cost minutes.
  for (const other of CI_PROVIDERS.filter(item => item.id !== provider.id)) {
    const count = evidence.value.runs.filter(run => run.app && run.app.slug === other.app).length;
    if (count) gate.note(`${count} ${other.title} check runs also exist for ${short(sha)}; they do not gate this revision`);
  }
}

/**
 * The guide-only exception for one revision: no CI run, a guide receipt that
 * matches the committed guide HTML, and the delivery account's record naming
 * the revision, the HTML hash and passing local checks.
 */
async function evaluateGuideException(ctx, gate, { sha, provider }) {
  const { github, repo } = ctx;
  gate.evidence.mode = 'guide-only-exception';
  gate.note(`every changed path is under ${GUIDE_ROOT} and every workflow filters it; ${SDLC}#guide-only-ci-exception applies only with its evidence`);
  const runs = await ctx.read(gate, () => github.getAll(`/repos/${repo}/commits/${sha}/check-runs?per_page=100&filter=all`, 'check_runs'));
  if (runs.ok && runs.value.some(run => run.app && run.app.slug === provider.app)) {
    gate.unresolved(`${provider.title} runs exist for ${short(sha)} although the filters exclude this change; resolve that before using the exception`);
  }
  await evaluateGuideEvidence(ctx, gate, { sha });
}

/** The guide verification receipt and its PR record for the candidate's committed guide HTML. */
async function evaluateGuideEvidence(ctx, gate, { sha }) {
  const { github, repo, declaration } = ctx;
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
  for (const check of results.unverified) {
    gate.unresolved(`the guide record does not show ${check} in the form "<command>: exit 0" or "<command>: passed"; it remains unverified`);
  }
}
