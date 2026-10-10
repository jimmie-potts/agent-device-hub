// Exact-revision CI evidence. The only path-specific allowance is the affected-check selection (Hub #1080): a job
// that selection deliberately leaves out may be skipped, and is reported as not run.
import { CI_PROVIDERS, short } from './context.mjs';
import { ReadFailure } from './github.mjs';
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
  // A required context or a second job with the same name keeps a check required.
  const unselected = new Set(expected.jobs.filter(job => !job.selected).map(job => job.name)
    .filter(name => !requiredContexts.includes(name) && expected.jobs.every(job => job.name !== name || !job.selected)));
  gate.evidence.expected = names;
  gate.evidence.filtered = expected.filtered;
  if (expected.selection) {
    const { mode, groups, omitted, full } = expected.selection;
    gate.evidence.selection = { mode, groups, omitted, full: full.map(item => (item.path ? `${item.path}: ${item.reason}` : item.reason)) };
  }

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

  if (!names.length && !expected.uncertain.length) {
    gate.unresolved('no configured job applies to this change');
    return;
  }
  gate.evidence.mode = provider.id;
  await evaluateChecks(ctx, gate, { sha, names, unselected, omitted: expected.selection ? expected.selection.omitted : [], checkBranch, provider });
}

async function evaluateChecks(ctx, gate, { sha, names, unselected, omitted, checkBranch, provider }) {
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
    if (unselected.has(name)) job.selected = false;
    jobs.push(job);
    if (result === 'pending') gate.unresolved(`${name}: pending (${latest.status})`);
    else if (unselected.has(name) && result === 'skipped') gate.note(`${name}: not selected for this change (omitted: ${omitted.join(', ')}); skipped, not run`);
    else if (result !== 'success') gate.unresolved(`${name}: ${result}${unselected.has(name) ? ' (not selected)' : ''}`);
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
