// Affected PR checks (Hub #1080). A small explicit mapping from changed paths to broad check groups, including the
// groups of their known consumers. The Checks workflow's select job, its final gate, the delivery preflight and the
// local `npm run ci:select` command all use it, so they agree on what a change runs. Anything shared, unknown or
// uncertain selects every group; the mapping accepts extra work to stay simple.
// This module has no dependencies, because the select and gate jobs run it without `npm ci`.

/** Check groups, in the order reports list them. Each conditional step in checks.yml names exactly one. */
export const GROUPS = Object.freeze(['runtime', 'maintenance', 'modules', 'chompi', 'shared']);

/** Jobs that run only when one of their groups is selected; core always runs build, typecheck and lint. */
export const JOBS = Object.freeze({
  firmware: Object.freeze(['chompi']),
  'app-verify': Object.freeze(['runtime', 'chompi', 'shared']),
});

const FULL = null;
// First match wins. `prefix/**` matches everything below prefix, `**/*.ext` every path with that extension, and any
// other pattern one exact path. Everything unmatched selects every group.
const RULES = Object.freeze([
  ['**/*.md', [], 'Markdown: no Checks suite reads it (docs/sdlc.md, Markdown-only CI routing)'],
  // The runtime composes every module, and maintenance imports the runtime.
  ['apps/runtime/**', ['runtime', 'maintenance'], 'the runtime and its maintenance consumer'],
  ['modules/**', ['modules', 'runtime', 'maintenance'], 'a module, the runtime that composes it and maintenance'],
  ['apps/bb8-windows/**', ['modules', 'runtime', 'maintenance'], 'the BB-8 link, the runtime that composes it and maintenance'],
  ['apps/maintenance/**', ['maintenance'], 'maintenance, which nothing imports'],
  // The bridge, its protocol fixtures and the controller firmware use only one another.
  ['apps/chompi-bridge/**', ['chompi'], 'the CHOMPI bridge'],
  ['packages/chompi-protocol/**', ['chompi'], 'the CHOMPI protocol, used only by the bridge and firmware'],
  ['firmware/**', ['chompi'], 'the CHOMPI controller firmware'],
  // These Roborock consumer tests import the built runtime registry.
  ['tests/roborock_consumer.test.mjs', ['runtime'], 'a runtime consumer test'],
  ['tests/roborock_transport_consumer.test.mjs', ['runtime'], 'a runtime consumer test'],
  ['docs/skins/**', FULL, 'shared by both dashboards'],
  // The retained documentation checks in the Workflow workflow, which runs for every change, read these.
  ['docs/**', [], 'documentation tooling that only the Workflow workflow reads'],
  ['openspec/**', [], 'OpenSpec, which only the Workflow workflow validates'],
  ['packages/**', FULL, 'a shared package or contract'],
  ['apps/hub/**', FULL, 'the old system, which the runtime and kept suites import'],
  ['apps/dashboard/**', FULL, 'the old system, which the runtime and kept suites import'],
  ['apps/local-controllers/**', FULL, 'the old system, which the runtime and kept suites import'],
  ['apps/wispr-collector/**', FULL, 'the old system, which the runtime and kept suites import'],
  ['controllers/**', FULL, 'the old system, which the runtime and kept suites import'],
  ['.github/**', FULL, 'CI configuration'],
  ['scripts/**', FULL, 'a repository script, including the CI selector and delivery preflight'],
  ['tests/**', FULL, 'shared test support'],
].map(([pattern, groups, reason]) => Object.freeze({ pattern, groups, reason })));

function matches(pattern, file) {
  if (pattern.startsWith('**/*.')) return file.endsWith(pattern.slice('**/*'.length));
  if (pattern.endsWith('/**')) return file.startsWith(pattern.slice(0, -2));
  return file === pattern;
}

function checkPath(file) {
  if (typeof file !== 'string' || !file || file.startsWith('/') || file.split('/').some(part => part === '..' || part === '.' || part === '')) {
    throw new Error(`changed paths must be relative repository paths: ${JSON.stringify(file)}`);
  }
}

const ordered = groups => GROUPS.filter(group => groups.has(group));
const jobsFor = groups => Object.fromEntries(Object.entries(JOBS).map(([id, needs]) => [id, needs.some(group => groups.has(group))]));

function result(mode, groups, reasons, full) {
  const set = new Set(groups);
  return {
    mode,
    groups: ordered(set),
    omitted: GROUPS.filter(group => !set.has(group)),
    jobs: jobsFor(set),
    reasons,
    full,
  };
}

/**
 * Select the check groups for one event.
 * `paths` holds every path the comparison touches, both sides of a rename included; `complete` is false when the list
 * may be missing paths. Only a complete pull-request comparison can narrow the selection.
 * Returns {mode: 'full' | 'selected', groups, omitted, jobs, reasons: [{path, groups, reason}], full: [{path?, reason}]}.
 */
export function selectChecks({ event, paths, complete, detail } = {}) {
  if (typeof event !== 'string' || !event) throw new Error('selectChecks needs the event name');
  if (!Array.isArray(paths)) throw new Error('selectChecks needs the changed paths');
  paths.forEach(checkPath);
  if (event !== 'pull_request') return result('full', GROUPS, [], [{ reason: `a ${event} event runs every check` }]);
  if (!complete) return result('full', GROUPS, [], [{ reason: `the changed-file list is incomplete${detail ? `: ${detail}` : ''}` }]);
  if (!paths.length) return result('full', GROUPS, [], [{ reason: 'the comparison lists no changed path' }]);
  const reasons = [];
  const full = [];
  const groups = new Set();
  for (const file of [...new Set(paths)].sort()) {
    const rule = RULES.find(item => matches(item.pattern, file));
    if (!rule || rule.groups === FULL) {
      full.push({ path: file, reason: rule ? rule.reason : 'a path the selector has not mapped' });
      continue;
    }
    rule.groups.forEach(group => groups.add(group));
    reasons.push({ path: file, groups: [...rule.groups], reason: rule.reason });
  }
  return full.length ? result('full', GROUPS, reasons, full) : result('selected', groups, reasons, []);
}

/** The `if` of a job in JOBS. */
export const jobCondition = id => `needs.select.outputs.${id} == 'true'`;
const JOB_CONDITION = /^needs\.select\.outputs\.([A-Za-z0-9_-]+) == 'true'$/;
/** The `if` of a conditional step: it runs when its one group is selected. */
export const STEP_CONDITION = /^contains\(fromJSON\(needs\.select\.outputs\.groups\), '([a-z-]+)'\)$/;

/** The job id a job condition names, or null when `condition` is not a selection condition. */
export function conditionJob(condition) {
  const match = typeof condition === 'string' ? condition.trim().replace(/^\$\{\{\s*(.*?)\s*\}\}$/, '$1').match(JOB_CONDITION) : null;
  return match ? match[1] : null;
}

/** The group a step condition names, or null for an unconditional step. Any other condition is an error. */
export function stepGroup(condition) {
  if (condition === undefined) return null;
  const match = typeof condition === 'string' ? condition.match(STEP_CONDITION) : null;
  if (!match || !GROUPS.includes(match[1])) throw new Error(`unsupported step condition: ${JSON.stringify(condition)}`);
  return match[1];
}

/** Read the select job's outputs back into a selection, or explain why they are unusable. */
function readOutputs(outputs) {
  if (!outputs || typeof outputs !== 'object') return { problem: 'the selection output is missing' };
  let groups;
  try {
    groups = JSON.parse(outputs.groups);
  } catch {
    return { problem: 'the selection output has no readable groups' };
  }
  if (!Array.isArray(groups)) return { problem: 'the selection output has no readable groups' };
  const unknown = groups.filter(group => !GROUPS.includes(group));
  if (unknown.length) return { problem: `the selection output names unknown group ${unknown.join(', ')}` };
  if (!['full', 'selected'].includes(outputs.mode)) return { problem: `the selection output has mode ${JSON.stringify(outputs.mode)}` };
  if (outputs.mode === 'full' && groups.length !== GROUPS.length) return { problem: 'a full selection must select every group' };
  const set = new Set(groups);
  const jobs = jobsFor(set);
  for (const [id, run] of Object.entries(jobs)) {
    if (outputs[id] !== String(run)) return { problem: `the selection output for ${id} (${JSON.stringify(outputs[id])}) does not match its groups` };
  }
  return { mode: outputs.mode, groups: ordered(set), jobs };
}

/**
 * The final gate's verdict over the workflow's `needs` context ({job: {result, outputs}}). Every job must have
 * succeeded, except a job in JOBS that the selection deliberately left out, which must have been skipped. A failed or
 * cancelled selection, an unreadable selection, a missing job, a failure, a cancellation or a skip of selected work
 * fails the gate. An unselected job that ran anyway is accepted and reported as executed.
 */
export function gateVerdict(needs) {
  const problems = [];
  const lines = [];
  if (!needs || typeof needs !== 'object') return { ok: false, problems: ['the needs context is missing'], lines };
  const select = needs.select;
  if (!select || select.result !== 'success') {
    problems.push(`the selection did not succeed: ${select ? select.result : 'missing'}`);
    return { ok: false, problems, lines };
  }
  const selection = readOutputs(select.outputs);
  if (selection.problem) return { ok: false, problems: [selection.problem], lines };
  lines.push(`selection: ${selection.mode}; groups ${selection.groups.join(', ') || 'none'}`);
  for (const id of Object.keys(JOBS)) if (!Object.hasOwn(needs, id)) problems.push(`${id}: missing from the gate's needs`);
  for (const [id, job] of Object.entries(needs)) {
    if (id === 'select') continue;
    const result = job && job.result;
    const selected = Object.hasOwn(JOBS, id) ? selection.jobs[id] : true;
    if (result === 'success') {
      lines.push(`${id}: success${selected ? '' : ' (ran although not selected)'}`);
    } else if (!selected && result === 'skipped') {
      lines.push(`${id}: skipped (not selected)`);
    } else {
      const problem = result === 'skipped' ? `${id}: skipped although selected` : `${id}: ${result ?? 'missing'}`;
      problems.push(problem);
      lines.push(problem);
    }
  }
  return { ok: problems.length === 0, problems, lines };
}
