// Expected Depot jobs from `.depot/workflows/` at a candidate revision.
// Depot reports each job as a GitHub check run named "<workflow> / <job>",
// with matrix values substituted. Anything this module cannot evaluate exactly
// is returned as uncertain so the caller keeps the normal gate.
import YAML from 'yaml';

const MATRIX_REF = /\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}/g;

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

function jobNames(workflow, job) {
  const { combos, keys, error } = expandMatrix(job);
  if (error) return { error: `${workflow.file} job ${job.id}: cannot expand (${error})` };
  const names = [];
  for (const combo of combos) {
    let name;
    if (job.name !== undefined) {
      name = String(job.name).replace(MATRIX_REF, (whole, key) => (key in combo ? String(combo[key]) : whole));
    } else {
      name = keys && keys.length ? `${job.id} (${keys.map(key => combo[key]).join(', ')})` : job.id;
    }
    if (name.includes('${{')) return { error: `${workflow.file} job ${job.id}: cannot expand name ${JSON.stringify(job.name)}` };
    names.push(`${workflow.name} / ${name}`);
  }
  return { names };
}

/**
 * Enumerate the check names Depot should report for one event.
 * Returns {jobs, filtered, uncertain, notes}. Uncertain entries mean the
 * expected set may be missing jobs; notes record conservative choices.
 */
export function expectedJobs(workflows, { event, branch, files, filesComplete }) {
  const jobs = [];
  const filtered = [];
  const uncertain = [];
  const notes = [];
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
    for (const job of workflow.jobs) {
      if (job.uses) {
        uncertain.push(`${workflow.file} job ${job.id}: reusable workflow jobs are not enumerated`);
        continue;
      }
      if (job.if !== undefined) notes.push(`${workflow.file} job ${job.id}: its condition is not evaluated; it stays expected`);
      const result = jobNames(workflow, job);
      if (result.error) {
        uncertain.push(result.error);
        continue;
      }
      for (const name of result.names) jobs.push({ name, workflow: workflow.file, job: job.id });
    }
  }
  return { jobs, filtered, uncertain, notes };
}
