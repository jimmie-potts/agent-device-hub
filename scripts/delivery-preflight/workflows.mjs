// Expected CI jobs from a revision's workflow directory (context.mjs CI_PROVIDERS).
// GitHub Actions reports each job as a check run named after the job; Depot
// named it "<workflow> / <job>". Matrix values are substituted either way.
// Each job also gets the provider-independent key "<workflow> / <job>", which
// compares coverage across a provider change. Anything this module cannot
// evaluate exactly is returned as uncertain so the caller keeps the normal gate.
// A job whose condition is the affected-check selection (Hub #1080) stays expected; the shared mapping in
// scripts/ci-selection/selection.mjs decides whether it must succeed or was deliberately left out.
import YAML from 'yaml';

import { conditionJob, selectChecks } from '../ci-selection/selection.mjs';

const MATRIX_REF = /\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}/g;
const HAS_MATRIX_REF = /\$\{\{\s*matrix\./;

function normalizeTriggers(on) {
  if (typeof on === 'string') return { [on]: {} };
  if (Array.isArray(on)) return Object.fromEntries(on.map(event => [event, {}]));
  if (on && typeof on === 'object') {
    return Object.fromEntries(Object.entries(on).map(([event, config]) => [event, config || {}]));
  }
  return {};
}

export function parseWorkflow(file, text) {
  const document = YAML.parse(text);
  if (!document || typeof document !== 'object') throw new Error(`${file}: not a workflow document`);
  // YAML 1.1 readers turn a bare `on` key into true; the yaml package keeps "on".
  const on = document.on ?? document.true;
  const jobs = Object.entries(document.jobs || {}).map(([id, job]) => ({ id, ...job }));
  return { file, name: document.name ?? null, triggers: normalizeTriggers(on), jobs };
}

// GitHub filter patterns: `*` matches within one path segment and `**` across
// segments, dot-files included. Negation, `?` and `+` (zero-or-one and
// one-or-more of the preceding character) and character classes are not
// evaluated; a filter using any of them keeps every job expected.
const UNSUPPORTED = /^!|[[\]+?]/;

export function filterPattern(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      index += 1;
      if (pattern[index + 1] === '/') {
        index += 1;
        source += '(?:.*/)?';
      } else {
        source += '.*';
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else {
      source += char.replace(/[.^$|(){}\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

const matches = (value, patterns) => patterns.some(pattern => filterPattern(String(pattern)).test(value));
const unsupported = patterns => patterns && patterns.some(pattern => UNSUPPORTED.test(String(pattern)));

/** Decide whether a trigger fires for this event, or why that is uncertain. */
function triggerApplies(trigger, { branch, files, filesComplete }) {
  const notes = [];
  const branches = trigger.branches;
  const ignoredBranches = trigger['branches-ignore'];
  if (trigger.tags && !branches && !ignoredBranches) return { applies: false, reason: 'tag-only push trigger' };
  if (unsupported(branches) || unsupported(ignoredBranches)) {
    return { applies: true, notes: ['branch patterns with negation, ?, + or [] are not evaluated; every job stays expected'] };
  }
  if (branches && !matches(branch, branches)) return { applies: false, reason: `branch ${branch} not in branches` };
  if (ignoredBranches && matches(branch, ignoredBranches)) return { applies: false, reason: `branch ${branch} in branches-ignore` };
  const paths = trigger.paths;
  const ignored = trigger['paths-ignore'];
  if (paths && ignored) return { applies: true, notes: ['both paths and paths-ignore are set; every job stays expected'] };
  const patterns = paths || ignored;
  if (unsupported(patterns)) {
    return { applies: true, notes: ['path patterns with negation, ?, + or [] are not evaluated; every job stays expected'] };
  }
  if (!filesComplete && patterns) {
    notes.push('the changed-file list is incomplete, so path filters are not applied and every job stays expected');
    return { applies: true, notes };
  }
  if (paths && !files.some(file => matches(file, paths))) return { applies: false, reason: 'no changed path matches paths' };
  if (ignored && files.length && files.every(file => matches(file, ignored))) {
    return { applies: false, reason: `every changed path matches paths-ignore (${ignored.join(', ')})` };
  }
  return { applies: true, notes };
}

function expandMatrix(job) {
  const matrix = job.strategy && job.strategy.matrix;
  if (matrix === undefined) return { combos: [{}] };
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) return { error: 'matrix is an expression' };
  if (matrix.include !== undefined) return { error: 'matrix include is not evaluated' };
  const keys = Object.keys(matrix).filter(key => key !== 'exclude');
  let combos = [{}];
  for (const key of keys) {
    if (!Array.isArray(matrix[key])) return { error: `matrix ${key} is an expression` };
    combos = combos.flatMap(combo => matrix[key].map(value => ({ ...combo, [key]: value })));
  }
  const excluded = Array.isArray(matrix.exclude) ? matrix.exclude : [];
  combos = combos.filter(combo => !excluded.some(rule => Object.entries(rule).every(([key, value]) => combo[key] === value)));
  return { combos, keys };
}

function jobNames(workflow, job, provider) {
  const { combos, keys, error } = expandMatrix(job);
  if (error) return { error: `${workflow.file} job ${job.id}: cannot expand (${error})` };
  // GitHub Actions adds matrix values to a job name that names none; that form is not evaluated.
  if (!provider.qualifiedNames && keys && keys.length && job.name !== undefined && !HAS_MATRIX_REF.test(String(job.name))) {
    return { error: `${workflow.file} job ${job.id}: a matrix job whose name has no matrix value is not evaluated` };
  }
  const names = [];
  for (const combo of combos) {
    let name;
    if (job.name !== undefined) {
      name = String(job.name).replace(MATRIX_REF, (whole, key) => (key in combo ? String(combo[key]) : whole));
    } else {
      name = keys && keys.length ? `${job.id} (${keys.map(key => combo[key]).join(', ')})` : job.id;
    }
    if (name.includes('${{')) return { error: `${workflow.file} job ${job.id}: cannot expand name ${JSON.stringify(job.name)}` };
    const key = `${workflow.name} / ${name}`;
    names.push({ name: provider.qualifiedNames ? key : name, key });
  }
  return { names };
}

/**
 * Enumerate the check names `provider` should report for one event.
 * Returns {jobs, filtered, uncertain, notes, selection}; each job has its check `name`, its `key` and `selected`,
 * which is false only for a job the affected-check selection deliberately leaves out, and `selector`, true for the
 * `select` job of a workflow that selects jobs or steps. Uncertain entries mean the expected set may be missing jobs;
 * notes record conservative choices.
 */
export function expectedJobs(workflows, { event, branch, files, filesComplete }, provider) {
  if (!provider) throw new Error('expectedJobs needs the CI provider');
  const jobs = [];
  const filtered = [];
  const uncertain = [];
  const notes = [];
  let selection = null;
  let selectionError = null;
  try {
    selection = selectChecks({ event, paths: files, complete: filesComplete });
  } catch (error) {
    selectionError = error.message;
  }
  for (const workflow of workflows) {
    const trigger = workflow.triggers[event];
    if (!trigger) continue;
    const decision = triggerApplies(trigger, { branch, files, filesComplete });
    notes.push(...(decision.notes || []).map(reason => `${workflow.file}: ${reason}`));
    if (!decision.applies) {
      filtered.push({ workflow: workflow.file, reason: decision.reason });
      continue;
    }
    if (!workflow.name) {
      uncertain.push(`${workflow.file}: workflow has no name, so its check names are unknown`);
      continue;
    }
    // A workflow that selects affected checks publishes the selection from its `select` job.
    const selects = workflow.jobs.some(job => conditionJob(job.if) || /needs\.select\.outputs/.test(JSON.stringify(job.steps ?? [])));
    for (const job of workflow.jobs) {
      if (job.uses) {
        uncertain.push(`${workflow.file} job ${job.id}: reusable workflow jobs are not enumerated`);
        continue;
      }
      let selected = true;
      const selectedBy = conditionJob(job.if);
      if (selectedBy) {
        if (!selection) {
          uncertain.push(`${workflow.file} job ${job.id}: cannot select affected checks (${selectionError})`);
          continue;
        }
        if (!Object.hasOwn(selection.jobs, selectedBy)) {
          uncertain.push(`${workflow.file} job ${job.id}: the selection has no job ${selectedBy}`);
          continue;
        }
        selected = selection.jobs[selectedBy];
      } else if (job.if !== undefined) {
        notes.push(`${workflow.file} job ${job.id}: its condition is not evaluated; it stays expected`);
      }
      const result = jobNames(workflow, job, provider);
      if (result.error) {
        uncertain.push(result.error);
        continue;
      }
      for (const { name, key } of result.names) jobs.push({ name, key, workflow: workflow.file, job: job.id, selected, selector: selects && job.id === 'select' });
    }
  }
  // Two jobs with one check name cannot be told apart in the check runs.
  const counts = new Map();
  for (const job of jobs) counts.set(job.name, (counts.get(job.name) ?? 0) + 1);
  for (const [name, count] of counts) if (count > 1) uncertain.push(`check name ${JSON.stringify(name)} belongs to ${count} jobs`);
  return { jobs, filtered, uncertain, notes, selection };
}
