// Exact-revision CI evidence. The only path-specific allowance is the affected-check selection (Hub #1080): a job
// that selection deliberately leaves out may be skipped, and is reported as not run.
import { NOTICE_TITLE, readNotice } from '../ci-selection/selection.mjs';
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
  const selectors = expected.jobs.filter(job => job.selector);
  await evaluateChecks(ctx, gate, { sha, event, names, unselected, selectors, selection: expected.selection, checkBranch, provider });
}

/** Compare the selection a select job published with this report's own: the hosted one must cover it. */
function checkPublishedSelection(gate, name, annotations, selection) {
  const notices = annotations.filter(item => item.annotation_level === 'notice' && item.title === NOTICE_TITLE);
  const hosted = notices.length === 1 ? readNotice(notices[0].message) : null;
  if (!hosted) {
    gate.unresolved(`${name}: publishes no single readable selection, so the groups its jobs ran are unknown`);
    return;
  }
  gate.evidence.hostedSelection = hosted;
  const missing = selection.groups.filter(group => !hosted.groups.includes(group));
  if (missing.length) {
    gate.unresolved(`${name}: the hosted selection (${hosted.groups.join(', ') || 'no group'}) omits ${missing.join(', ')}, which this change selects`);
  } else if (hosted.groups.length > selection.groups.length) {
    gate.note(`${name}: the hosted selection ran more groups (${hosted.groups.join(', ')}) than this report selects`);
  }
}

function actionJob(repo, check) {
  let url;
  try { url = new URL(check.details_url); } catch { return null; }
  const match = url.pathname.match(/^\/([^/]+\/[^/]+)\/actions\/runs\/([1-9]\d*)\/job\/([1-9]\d*)$/);
  if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash || !match || match[1] !== repo) return null;
  const runId = Number(match[2]);
  const jobId = Number(match[3]);
  return Number.isSafeInteger(runId) && Number.isSafeInteger(jobId) ? { runId, jobId } : null;
}

const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** Only completed, recorded steps can identify a copied execution; missing fields are not equal evidence. */
function executionSteps(job) {
  if (!timestamp(job.started_at) || !timestamp(job.completed_at) || Date.parse(job.completed_at) < Date.parse(job.started_at)
    || !Array.isArray(job.steps) || !job.steps.length || !job.steps.every(step => step && typeof step.name === 'string' && step.name
      && Number.isSafeInteger(step.number) && step.number > 0 && step.status === 'completed'
      && ['success', 'skipped'].includes(step.conclusion)
      && ['started_at', 'completed_at'].every(key => timestamp(step[key]) || (step.conclusion === 'skipped' && step[key] === null)))) return null;
  return JSON.stringify(job.steps.map(step => [step.number, step.name, step.status, step.conclusion, step.started_at, step.completed_at]));
}

/** Recover a notice only from the same Actions execution retained in a later attempt of its verified run. */
async function retainedSelection(ctx, gate, { sha, event, checkBranch, workflow, latest, attempts, checkSuite }) {
  const { github, repo } = ctx;
  const refuse = reason => { gate.unresolved(`${latest.name}: cannot verify retained selection (${reason})`); return null; };
  const link = actionJob(repo, latest);
  if (!link || !workflow || checkSuite.head_sha !== sha || checkSuite.app?.slug !== 'github-actions') return refuse('missing workflow/job identity');
  const evidence = await ctx.read(gate, async () => ({
    run: await github.get(`/repos/${repo}/actions/runs/${link.runId}`),
    jobs: await github.getAll(`/repos/${repo}/actions/runs/${link.runId}/jobs?filter=all&per_page=100`, 'jobs'),
  }));
  if (!evidence.ok) return null;
  const { run, jobs } = evidence.value;
  if (!run || run.id !== link.runId || run.head_sha !== sha || run.head_branch !== checkBranch || run.event !== event
    || run.repository?.full_name !== repo || run.check_suite_id !== latest.check_suite.id || run.path !== `.github/workflows/${workflow}`
    || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 2) return refuse('workflow provenance differs');
  const jobFor = check => {
    const identity = actionJob(repo, check);
    if (!identity || identity.runId !== run.id) return null;
    const checkUrl = `https://api.github.com/repos/${repo}/check-runs/${check.id}`;
    const matching = jobs.filter(job => job?.id === identity.jobId || job?.check_run_url === checkUrl);
    if (matching.length !== 1) return null;
    const job = matching[0];
    return job.id === identity.jobId && job.check_run_url === checkUrl && job.run_id === run.id && job.head_sha === sha
      && job.name === check.name && job.status === 'completed' && job.conclusion === 'success'
      && check.status === 'completed' && check.conclusion === 'success'
      && job.started_at === check.started_at && job.completed_at === check.completed_at
      && Number.isSafeInteger(job.run_attempt) && job.run_attempt > 0 ? job : null;
  };
  const current = jobFor(latest);
  const steps = current && executionSteps(current);
  if (!current || current.run_attempt !== run.run_attempt || !steps) return refuse('current copy lacks execution evidence');
  const originals = attempts.filter(check => check.id !== latest.id && check.check_suite.id === latest.check_suite.id
    && check.started_at === latest.started_at && check.completed_at === latest.completed_at);
  if (!originals.length) return refuse('no original execution');
  let source;
  for (const check of originals) {
    const original = jobFor(check);
    if (!original || original.run_attempt >= current.run_attempt || executionSteps(original) !== steps) return refuse('original execution differs');
    const annotations = await ctx.read(gate, () => github.getAll(`/repos/${repo}/check-runs/${check.id}/annotations?per_page=100`));
    if (!annotations.ok) return null;
    if (annotations.value.some(item => item.annotation_level === 'failure')) return refuse('original has a failure annotation');
    const notices = annotations.value.filter(item => item.annotation_level === 'notice' && item.title === NOTICE_TITLE);
    if (!notices.length) continue;
    const hosted = notices.length === 1 && readNotice(notices[0].message);
    if (!hosted) return refuse('original notice is malformed or ambiguous');
    if (source && JSON.stringify(source.hosted) !== JSON.stringify(hosted)) return refuse('original notices conflict');
    source ??= { hosted, annotations: annotations.value, checkRunId: check.id, attempt: original.run_attempt };
  }
  if (!source) return refuse('no original selection notice');
  gate.note(`${latest.name}: selection retained from check ${source.checkRunId}, workflow run ${run.id}, attempt ${source.attempt}`);
  return { annotations: source.annotations, provenance: { checkRunId: source.checkRunId, workflowRunId: run.id,
    attempt: source.attempt, retainedAttempt: current.run_attempt } };
}

async function evaluateChecks(ctx, gate, { sha, event, names, unselected, selectors, selection, checkBranch, provider }) {
  const omitted = selection ? selection.omitted : [];
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
    const matchingSelectors = selectors.filter(item => item.name === name);
    const selector = matchingSelectors.length > 0 && selection;
    if (result === 'success' && latest.output && (latest.output.annotations_count > 0 || selector)) {
      const annotations = await ctx.read(gate, () => github.getAll(`/repos/${repo}/check-runs/${latest.id}/annotations?per_page=100`));
      if (annotations.ok) {
        job.annotations = annotations.value.length;
        if (annotations.value.some(item => item.annotation_level === 'failure')) {
          gate.unresolved(`${name}: success with a failure annotation; resolve the contradiction`);
        }
        if (selector) {
          let published = annotations.value;
          if (!published.length && latest.output.annotations_count === 0 && provider.id === 'github-actions' && attempts.length > 1) {
            const retained = await retainedSelection(ctx, gate, { sha, event, checkBranch, latest, attempts,
              workflow: matchingSelectors.length === 1 ? matchingSelectors[0].workflow : null,
              checkSuite: suites.get(latest.check_suite.id) });
            if (!retained) continue;
            published = retained.annotations;
            job.selectionSource = retained.provenance;
          }
          checkPublishedSelection(gate, name, published, selection);
        }
      }
    } else if (result === 'success' && selector) {
      gate.unresolved(`${name}: publishes no single readable selection, so the groups its jobs ran are unknown`);
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
