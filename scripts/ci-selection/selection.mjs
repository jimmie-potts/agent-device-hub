import {standaloneOwners,OWNERS} from './standalone.mjs';
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
  'runtime-verify': Object.freeze(['runtime']),
});

const FULL = null;
// First match wins. `prefix/**` matches everything below prefix, `**/*.ext` every path with that extension, and any
// other pattern one exact path. Everything unmatched selects every group.
const RULES = Object.freeze([
  ['AGENTS.md', FULL, 'delivery gate policy'],
  ['docs/sdlc.md', FULL, 'delivery gate policy'],
  ['docs/development.md', FULL, 'validation gate policy'],
  ['openspec/specs/focused-source-admission/**', FULL, 'source admission contract'],
  ['**/*.md', [], 'Markdown: no Checks test may depend on its content (docs/sdlc.md, Markdown-only CI routing)'],
  // Dormant source selects no product checks; root build/type/lint still protect active composition.
  ['modules/bb8/**', [], 'hibernated BB-8 source'],
  ['apps/bb8-windows/**', [], 'hibernated BB-8 helper source'],
  ['scripts/package-bb8.mjs.hibernated', [], 'hibernated BB-8 packaging source'],
  // The runtime composes active modules, and maintenance imports the runtime.
  // The collector's allowlist and entry, which the adapter's tests in the Volcano suite depend on.
  ['apps/runtime/src/collector/volcano.ts', ['modules', 'runtime', 'maintenance'], 'the Volcano collector, which the modules group tests with its adapter'],
  ['apps/runtime/bin/volcano-collector.mjs', ['modules', 'runtime', 'maintenance'], 'the Volcano collector, which the modules group tests with its adapter'],
  ['apps/runtime/**', ['runtime', 'maintenance'], 'the runtime and its maintenance consumer'],
  ['modules/**', ['modules', 'runtime', 'maintenance'], 'a module, the runtime that composes it and maintenance'],
  // The collector's Bluetooth binding: the Volcano suite holds its tests, and its interface is the runtime's.
  ['apps/volcano-collector/**', ['modules', 'runtime'], 'the Volcano collector binding'],
  ['apps/maintenance/**', ['maintenance'], 'maintenance, which nothing imports'],
  // The bridge, its protocol fixtures and the controller firmware use only one another.
  ['apps/chompi-bridge/**', ['chompi'], 'the CHOMPI bridge'],
  ['packages/chompi-protocol/**', ['chompi'], 'the CHOMPI protocol, used only by the bridge and firmware'],
  ['firmware/**', ['chompi'], 'the CHOMPI controller firmware'],
  // These Roborock consumer tests import the built runtime registry.
  ['tests/roborock_consumer.test.mjs', ['runtime'], 'a runtime consumer test'],
  ['tests/roborock_transport_consumer.test.mjs', ['runtime'], 'a runtime consumer test'],
  ['tests/volcano_consumer.test.mjs', ['runtime'], 'a runtime consumer test'],
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
const validOwners=owners=>Array.isArray(owners)&&owners.length>0&&new Set(owners).size===owners.length&&owners.every(id=>Object.hasOwn(OWNERS,id));
const jobsFor = (groups, mode) => Object.fromEntries(Object.entries(JOBS).map(([id, needs]) => [id,
  mode === 'standalone' || mode === 'focused' && id !== 'firmware' ? false : needs.some(group => groups.has(group)),
]));

// Only these existing style assets have reviewed presentation-only ownership. New paths and all executable
// frontend code retain conservative coverage, including renamed/new credential, durable-state and command owners.
const PRESENTATION_PATHS = new Set([
  'apps/runtime/dashboard/src/agent-status.css',
  'apps/runtime/dashboard/src/card-chrome.css',
  'apps/runtime/dashboard/src/habitat.css',
  'apps/runtime/dashboard/src/home-layout.css',
  'apps/runtime/dashboard/src/hub-control-cards.css',
  'apps/runtime/dashboard/src/lighting.css',
  'apps/runtime/dashboard/src/music.css',
  'apps/runtime/dashboard/src/room-models.css',
  'apps/runtime/dashboard/src/shell.css',
  'apps/runtime/dashboard/src/style.css',
  'apps/runtime/dashboard/src/timeline-card.css',
  'apps/runtime/dashboard/src/wemo.css',
  'apps/runtime/dashboard/src/skins/habitat.css',
  'apps/runtime/dashboard/src/skins/quiet-glass.css',
  'apps/runtime/dashboard/src/skins/neon-geometry-wars.css',
  'modules/companions/src/frontend/card.css',
  'modules/reachy-mini/src/frontend/reachy.css',
  'modules/onn/src/frontend/history.css',
  'modules/onn/src/frontend/onn-card.css',
  'modules/nanoleaf/src/frontend/wall.css',
  'modules/wispr/src/frontend/wispr.css',
  'modules/wispr/src/frontend/wispr-card.css',
  'modules/roborock/src/frontend/roborock-card.css',
]);
const presentationPath = file => PRESENTATION_PATHS.has(file);

function result(mode, groups, reasons, full) {
  const set = new Set(groups);
  return {
    mode,
    groups: ordered(set),
    omitted: GROUPS.filter(group => !set.has(group)),
    jobs: jobsFor(set, mode),
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
export function selectChecks({ event, paths, changes, complete, detail } = {}) {
  if (typeof event !== 'string' || !event) throw new Error('selectChecks needs the event name');
  if (!Array.isArray(paths)) throw new Error('selectChecks needs the changed paths');
  paths.forEach(checkPath);
  if (event !== 'pull_request') return result('full', GROUPS, [], [{ reason: `a ${event} event runs every check` }]);
  if (!complete) return result('full', GROUPS, [], [{ reason: `the changed-file list is incomplete${detail ? `: ${detail}` : ''}` }]);
  if (!paths.length) return result('full', GROUPS, [], [{ reason: 'the comparison lists no changed path' }]);
  const owners=standaloneOwners(paths,changes);
  if(owners)return {...result('standalone',[],changes.map(file=>({path:file.filename,groups:[],reason:'verified standalone test comparison'})),[]),owners};
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
  if (full.length) return result('full', GROUPS, reasons, full);
  const productPaths = reasons.filter(item => item.groups.length).map(item => item.path);
  const mode = productPaths.length && productPaths.every(presentationPath) ? 'focused' : 'selected';
  return result(mode, groups, reasons, []);
}

/** The title of the notice annotation in which the select job publishes its selection for the delivery preflight. */
export const NOTICE_TITLE = 'Affected checks';

/** The notice message that publishes a selection: compact JSON, so it needs no workflow-command escaping. */
export const noticeMessage = selection => JSON.stringify({ mode: selection.mode, groups: selection.groups,
  ...(['focused','standalone'].includes(selection.mode) ? { jobs: selection.jobs } : {}),
  ...(selection.mode==='standalone'?{owners:selection.owners}:{}) });

/** A published selection read back from its notice message, or null when the message is not one. */
export function readNotice(message) {
  let value;
  try {
    value = JSON.parse(message);
  } catch {
    return null;
  }
  if (!value || !['full', 'selected', 'focused', 'standalone'].includes(value.mode) || !Array.isArray(value.groups)
    || !value.groups.every(group => GROUPS.includes(group))) return null;
  if (['focused','standalone'].includes(value.mode)) {
    if(value.mode==='standalone'&&(!validOwners(value.owners)||value.groups.length))return null;
    const expected = jobsFor(new Set(value.groups), value.mode);
    if (!value.jobs || Object.keys(value.jobs).length !== Object.keys(JOBS).length
      || Object.entries(expected).some(([id, run]) => value.jobs[id] !== run)) return null;
    return { mode: value.mode, groups: ordered(new Set(value.groups)), jobs: expected, ...(value.mode==='standalone'?{owners:value.owners}:{}) };
  }
  return { mode: value.mode, groups: ordered(new Set(value.groups)) };
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
  if (condition === undefined || stepOwner(condition)) return null;
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
  if (!['full', 'selected', 'focused', 'standalone'].includes(outputs.mode)) return { problem: `the selection output has mode ${JSON.stringify(outputs.mode)}` };
  if (outputs.mode === 'full' && groups.length !== GROUPS.length) return { problem: 'a full selection must select every group' };
  let owners;
  if(outputs.mode==='standalone'){try{owners=JSON.parse(outputs.owners);}catch{}if(!validOwners(owners)||groups.length)return {problem:'the standalone owner selection is missing or invalid'};}
  const set = new Set(groups);
  const jobs = jobsFor(set, outputs.mode);
  for (const [id, run] of Object.entries(jobs)) {
    if (outputs[id] !== String(run)) return { problem: `the selection output for ${id} (${JSON.stringify(outputs[id])}) does not match its groups` };
  }
  return { mode: outputs.mode, groups: ordered(set), jobs, ...(owners?{owners}:{}) };
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
  if(selection.mode==='standalone'&&needs.core?.outputs?.owners!==JSON.stringify(selection.owners))problems.push('core: complete standalone command evidence is missing or differs from the selection');
  lines.push(`selection: ${selection.mode}; groups ${selection.groups.join(', ') || 'none'}`);
  if (!Object.hasOwn(needs, 'core')) problems.push('core: missing from the gate\'s needs');
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

/** The only owner-specific setup condition; unknown expressions never select setup. */
export const stepOwner=condition=>typeof condition==='string'&&condition.match(/^contains\(fromJSON\(needs\.select\.outputs\.owners\), '(wemo|microduck-browser)'\)$/)?.[1]||null;
