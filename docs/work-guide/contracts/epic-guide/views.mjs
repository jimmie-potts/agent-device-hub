// Offline contract reference for guide-views/1.0; never imported by a production consumer.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Ajv from 'ajv';
import { VERSION as RECORDS_VERSION, WORKFLOW, LABELS, isEpic, isFresh, validateDataset, eligibility,
  publicProjection, dependents, primaryPage, recentlyDone, recentWindow, prerequisiteState } from './records.mjs';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const schema = read('./views.schema.json');
const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(schema);
export const VERSION = 'guide-views/1.0';
export const CATALOG = read('./catalog.json');

// A rejection code is stable vocabulary; the detail after it is diagnostic.
const reject = (code, detail) => { throw new Error(`${code}: ${detail}`); };
const check = (condition, code, detail) => { if (!condition) reject(code, detail); };

// Catalog arrays are authored order, so identity keeps them in place.
export function catalogIdentity(catalog) {
  const canonical = x => {
    if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
    if (x !== null && typeof x === 'object') return '{' + Object.keys(x).sort()
      .map(key => JSON.stringify(key) + ':' + canonical(x[key])).join(',') + '}';
    return JSON.stringify(x);
  };
  return 'sha256:' + createHash('sha256').update(canonical(catalog)).digest('hex');
}

const open = issue => issue.state === 'OPEN';
const workflow = issue => issue.labels.filter(x => WORKFLOW.includes(x));
// Each predicate receives the record and its context: section, enclosing epic, lookup and dataset.
export const PREDICATES = {
  none: () => true,
  open,
  active: issue => open(issue) && workflow(issue).some(x => ['status:in-progress', 'status:review'].includes(x)),
  'open-bug': issue => open(issue) && issue.labels.includes(LABELS.bug),
  // Blocked covers open, missing or unknown blockers and prerequisites whose outcome needs reconciliation.
  blocked: (issue, { dataset }) => {
    if (!open(issue)) return false;
    const state = prerequisiteState(dataset, issue);
    return issue.labels.includes('blocked') || state.noOpenBlocker !== true || state.outcomesAccepted !== true;
  },
  later: issue => open(issue) && issue.labels.some(x => ['deferred', LABELS.idea].includes(x)),
  closed: issue => !open(issue),
  recent: (issue, { dataset }) => recentlyDone(dataset, issue),
  descendant: (issue, { section }) => issue.placement.path.includes(section.record),
  'root-epic': issue => isEpic(issue) && issue.placement.state === 'root',
  'nested-epic': (issue, { epic }) => isEpic(issue) && issue.placement.state === 'epic' && issue.placement.epic === epic,
  'not-in-epic': issue => ['standalone', 'unresolved'].includes(issue.placement.state),
};

const identityKey = x => [x.kind, x.group ?? '', x.record ?? '', x.by ?? '', x.direction ?? '', x.scope ?? ''].join(':');

function hasEdge(issue, relation, other) {
  const field = { blocks: other.blockedBy, 'blocked-by': issue.blockedBy,
    'parent-of': issue.children, 'child-of': issue.parent }[relation];
  return field.ids?.includes(relation === 'blocks' ? issue.id : other.id) ?? false;
}

export function validateView(value, { dataset, catalog = CATALOG } = {}) {
  check(value?.schemaVersion === VERSION, 'unsupported-version', String(value?.schemaVersion));
  check(validate(value), 'schema', ajv.errorsText(validate.errors, { separator: '; ' }));
  check(catalog.catalogVersion === VERSION && catalog.recordsVersion === RECORDS_VERSION, 'catalog-mismatch', 'unsupported catalog version');
  check(value.catalogId === catalogIdentity(catalog), 'catalog-mismatch', value.catalogId);
  check(dataset?.schemaVersion === value.recordsVersion, 'records-mismatch', String(dataset?.schemaVersion));
  try { validateDataset(dataset); } catch (error) { reject('records-invalid', error.message); }
  check(value.datasetId === dataset.datasetId, 'dataset-mismatch', value.datasetId);

  const lookup = new Map(dataset.issues.map(x => [x.id, x]));
  const page = catalog.pages[value.page.kind];
  check(page.origin === value.origin, 'page-not-allowed', `${value.origin} ${value.page.kind}`);
  check((page.record === 'none') === (value.page.record === null), 'page-not-allowed', 'page record');
  if (value.page.record !== null) {
    const record = lookup.get(value.page.record);
    check(record, 'unknown-record', value.page.record);
    if (page.record === 'epic') check(isEpic(record), 'page-not-allowed', `${record.id} is not an epic`);
  }
  const composed = value.origin === 'composed';
  const { maxDepth, composed: limits } = catalog.bounds;
  if (composed) check(value.components.length <= limits.maxComponents && value.root.length <= limits.maxRootComponents,
    'size-exceeded', 'component or root count');
  const byId = new Map();
  for (const component of value.components) {
    check(!byId.has(component.id), 'duplicate-instance', component.id);
    byId.set(component.id, component);
  }
  // An epic page is exactly one full epic component for the page's epic.
  if (page.record === 'epic') {
    const root = byId.get(value.root[0]);
    check(value.root.length === 1 && root?.kind === 'epic' && root.record === value.page.record && root.presentation === 'full',
      'page-not-allowed', 'an epic page is one full epic component');
  }

  // Walk from the root; a revisit on the current path is a cycle, elsewhere a second parent.
  const visited = new Set(); const context = new Map();
  const visit = (id, parent, epic, depth, path) => {
    const component = byId.get(id);
    check(component, 'unknown-component', id);
    check(!path.has(id), 'cycle', id);
    check(!visited.has(id), 'multiple-parents', id);
    visited.add(id); context.set(id, { parent, epic });
    check(depth <= maxDepth, 'depth-exceeded', id);
    const kind = catalog.components[component.kind];
    const parentKind = parent?.kind ?? 'root';
    check(kind.parents.includes(parentKind), 'nesting-not-allowed', `${component.kind} in ${parentKind}`);
    if (!parent) check(page.root.includes(component.kind), 'page-not-allowed', `${component.kind} at the root of ${value.page.kind}`);
    if (component.kind === 'task-brief') check(component.record === value.page.record, 'nesting-not-allowed', 'task brief outside its issue page');
    if (component.kind === 'section') {
      const groups = parent?.kind === 'epic' ? catalog.components.epic.groups : page.groups;
      check(groups.includes(component.group), 'page-not-allowed', `${component.group} in ${parent?.kind ?? value.page.kind}`);
    }
    if (component.kind === 'epic' && component.presentation === 'summary') check(component.children.length === 0, 'nesting-not-allowed', `${id} summary with groups`);
    if (parent?.kind === 'section') check(catalog.groups[parent.group].children.includes(component.kind), 'nesting-not-allowed', `${component.kind} in ${parent.group}`);
    if (parent) check(catalog.components[parent.kind].children.includes(component.kind), 'nesting-not-allowed', `${component.kind} in ${parent.kind}`);
    const children = component.children ?? [];
    if (composed) check(children.length <= limits.maxChildren, 'size-exceeded', id);
    // Two components are duplicates only when they would show the same thing; a dependency list
    // differs by direction and scope, and a section by its group and record.
    const siblings = children.map(child => byId.get(child)).filter(Boolean).map(identityKey);
    check(new Set(siblings).size === siblings.length, 'duplicate-sibling', id);
    const next = new Set([...path, id]);
    for (const child of children) visit(child, component, component.kind === 'epic' ? component.record : epic, depth + 1, next);
  };
  const rootKeys = value.root.map(id => byId.get(id)).filter(Boolean).map(identityKey);
  check(new Set(rootKeys).size === rootKeys.length, 'duplicate-sibling', 'root');
  for (const id of value.root) visit(id, null, null, 1, new Set());
  for (const id of byId.keys()) check(visited.has(id), 'orphan', id);

  const projection = publicProjection(dataset);
  for (const component of value.components) {
    if (component.kind === 'board') continue;
    const { epic } = context.get(component.id);
    if (component.kind === 'section') {
      const rule = catalog.groups[component.group];
      check(Boolean(rule.record) === (component.record !== null), 'group-requirement', `${component.id} record`);
      if (component.record !== null) check(lookup.has(component.record), 'unknown-record', component.record);
      for (const child of component.children.map(id => byId.get(id))) {
        if (child.kind === 'board' || child.kind === 'dependency-list') continue;
        const record = lookup.get(child.record);
        check(record, 'unknown-record', child.record);
        check(PREDICATES[rule.requires](record, { section: component, epic, lookup, dataset }), 'group-requirement', `${child.id} in ${component.group}`);
        if (rule.requiresReason) check(child.reasons?.some(x => x.code === rule.requiresReason), 'group-requirement', child.id);
        // Inside an epic component, cards and nested epics must belong to that epic.
        if (epic !== null) check(record.placement.epic === epic, 'membership', `${record.id} in ${epic}`);
      }
      continue;
    }
    const record = lookup.get(component.record);
    check(record, 'unknown-record', component.record);
    if (component.kind === 'epic') check(isEpic(record), 'group-requirement', `${record.id} is not an epic`);
    if (component.kind === 'issue-card' && composed) check(!component.primary, 'coverage', `${component.id} composed views never define placement`);
    if (composed && ['issue-card', 'epic'].includes(component.kind)) check(component.reasons, 'reason-required', component.id);
    const codes = (component.reasons ?? []).map(x => x.code);
    check(new Set(codes).size === codes.length, 'duplicate-reason', component.id);
    for (const reason of component.reasons ?? []) {
      check(catalog.reasons[reason.code].components.includes(component.kind), 'reason-not-allowed', `${reason.code} on ${component.kind}`);
      for (const evidence of reason.evidence) {
        if (reason.code === 'question-match') {
          const entry = projection.issues.find(x => x.id === record.id);
          check(entry && evidence.field in entry.fields, 'evidence-not-public', `${record.id} ${evidence.field}`);
        } else if (reason.code === 'epic-member') {
          check(record.placement.epic === evidence.epic, 'evidence-unverified', `${record.id} in ${evidence.epic}`);
        } else {
          const other = lookup.get(evidence.record);
          check(other && other.id !== record.id && hasEdge(record, evidence.relation, other), 'evidence-unverified', `${evidence.relation} ${evidence.record}`);
        }
      }
    }
  }

  // Ordinary placement pages list each placed open issue exactly once; repeats elsewhere are not primary.
  const same = (shown, expected, what) => check(JSON.stringify(shown.sort()) === JSON.stringify(expected.sort()), 'coverage',
    `${value.page.kind} ${what} lists ${shown.length} of ${expected.length}`);
  if (page.coverage !== 'none') {
    const inGroup = (x, group) => byId.get(context.get(x.id).parent?.id)?.group === group;
    const placed = value.components.filter(x => (x.kind === 'issue-card' && (x.primary || page.coverage === 'complete'))
      || (x.kind === 'epic' && inGroup(x, 'sub-epics')));
    const target = value.page.kind === 'epic' ? `epic:${value.page.record}` : 'not-in-epic';
    same(placed.map(x => x.record), dataset.issues.filter(x => open(x) && x.id !== value.page.record
      && (page.coverage === 'complete' || primaryPage(x) === target)).map(x => x.id), 'placements');
    if (page.coverage === 'complete') check(placed.every(x => !x.primary), 'coverage', 'All issues repeats placements');
    // Epic and Not in an epic pages also show every issue whose page they are that was completed in
    // the seven-day window, so a completion that cannot be placed in an epic is still shown.
    if (page.coverage === 'primary') same(value.components.filter(x => x.kind === 'issue-card' && inGroup(x, 'recently-done')).map(x => x.record),
      dataset.issues.filter(x => recentlyDone(dataset, x) && x.id !== value.page.record && primaryPage(x) === target).map(x => x.id), 'recently done');
  } else check(value.components.every(x => !x.primary), 'coverage', `${value.page.kind} cannot hold primary placements`);
  return value;
}

// Only the view already on screen may move to changed records, and only if it fully revalidates.
export function rebindView(value, { dataset, catalog = CATALOG } = {}) {
  return validateView({ ...structuredClone(value), datasetId: dataset?.datasetId }, { dataset, catalog });
}

// Browser links come only from referenced records, to GitHub pages or computed Guide routes.
export function allowedLink(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'https://github.com' && !parsed.username && !parsed.password ? url : null;
  } catch { return null; }
}
const parts = id => { const [path, number] = id.split('#'); const [owner, repo] = path.split('/'); return { owner, repo, number }; };
const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key]);
// Guide routes are computed from placement; views and model output never supply them.
export function route(issue, catalog = CATALOG) {
  const key = primaryPage(issue);
  const page = key === 'not-in-epic' ? catalog.routes['not-in-epic'] : fill(catalog.routes.epic, parts(key.slice(5)));
  return { epic: isEpic(issue) ? fill(catalog.routes.epic, parts(issue.id)) : null,
    issue: fill(catalog.routes.issue, { page, ...parts(issue.id) }) };
}

// Renderers show record text literally; this is the minimum escaping a browser needs.
export function literalText(value) {
  return String(value).replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x]);
}

function dependencyList(dataset, component, policy) {
  const issue = dataset.issues.find(x => x.id === component.record);
  if (component.direction === 'dependents') {
    const primary = dataset.repositories.find(x => x.name === issue.repository)?.scope === 'primary';
    if (!primary || !open(issue)) return { ids: null, complete: false, reasons: [{ code: 'dependents-unavailable', source: issue.url }] };
    const result = dependents(dataset, issue.id, policy);
    return result.direct === null ? { ids: null, complete: false, reasons: result.reasons }
      : { ids: result[component.scope], complete: true, reasons: [] };
  }
  if (component.scope === 'direct') {
    const complete = issue.blockedBy.ids !== null && isFresh(issue.blockedBy.evidence, policy);
    return { ids: issue.blockedBy.ids === null ? null : [...issue.blockedBy.ids].sort(), complete,
      reasons: complete ? [] : [{ code: 'dependency-evidence-unavailable', source: issue.blockedBy.evidence.source }] };
  }
  // Observed transitive edges stop at closed prerequisites, as in guide-records.
  const lookup = new Map(dataset.issues.map(x => [x.id, x]));
  const seen = new Set(); const pending = [...(issue.blockedBy.ids ?? [])];
  while (pending.length) {
    const id = pending.shift();
    if (seen.has(id) || id === issue.id) continue;
    seen.add(id);
    const next = lookup.get(id);
    if (next && open(next)) pending.push(...(next.blockedBy.ids ?? []));
  }
  const gate = eligibility(dataset, issue.id, 'prerequisites', policy);
  return { ids: [...seen].sort(), complete: gate.allowed, reasons: gate.reasons };
}

function resolveReason(dataset, record, reason, policy) {
  const result = { code: reason.code, evidence: structuredClone(reason.evidence), state: 'supported', withheld: [] };
  if (reason.code === 'ready-candidate') {
    const gate = eligibility(dataset, record.id, 'ready', policy);
    if (!gate.allowed) Object.assign(result, { state: 'withheld', withheld: gate.reasons });
  } else if (reason.code === 'recorded-relation') {
    for (const evidence of reason.evidence) {
      const owner = evidence.relation === 'blocks' ? dataset.issues.find(x => x.id === evidence.record) : record;
      const field = { blocks: 'blockedBy', 'blocked-by': 'blockedBy', 'parent-of': 'children', 'child-of': 'parent' }[evidence.relation];
      if (!isFresh(owner[field].evidence, policy)) {
        result.state = 'stale';
        result.withheld.push({ code: 'relation-evidence-stale', source: owner[field].evidence.source });
      }
    }
  }
  return result;
}

// The seven-day list is complete only when every primary repository's closed-in-window read is
// complete and every recent completion could be placed.
function recentEvidence(dataset) {
  const reasons = [...dataset.repositories.filter(x => x.scope === 'primary' && !x.recentClosures.complete)
    .map(x => ({ code: 'recent-closures-incomplete', source: x.recentClosures.source })),
  ...dataset.issues.filter(x => recentlyDone(dataset, x) && x.placement.state === 'unresolved')
    .map(x => ({ code: 'recent-placement-unresolved', source: x.url }))];
  return { window: recentWindow(dataset), complete: reasons.length === 0, reasons };
}

// Counts come from placement, so repeated cards never change them.
export function epicCounts(dataset, epicId, policy) {
  const members = dataset.issues.filter(x => open(x) && x.id !== epicId && primaryPage(x) === `epic:${epicId}`);
  return { open: members.length, active: members.filter(PREDICATES.active).length,
    blocked: members.filter(x => PREDICATES.blocked(x, { dataset })).length,
    ready: members.filter(x => eligibility(dataset, x.id, 'ready', policy).allowed).length,
    recentlyDone: dataset.issues.filter(x => recentlyDone(dataset, x) && x.placement.epic === epicId).length };
}

function column(dataset, record, by) {
  if (by === 'commitment') return { selected: record.project.commitment.value, unselected: 'Unselected', unknown: 'Unknown' }[record.project.commitment.state];
  if (by === 'phase') return { unassigned: 'Unassigned', conflict: 'Conflict', unknown: 'Unknown' }[record.project.phase.state] ?? record.project.phase.value;
  if (!open(record)) return 'Closed';
  const statuses = workflow(record);
  return statuses.length === 1 ? statuses[0] : 'No single status';
}

// Resolution computes every claim from records at use, including after a fetch-only refresh.
export function resolveView(value, { dataset, policy, catalog = CATALOG } = {}) {
  validateView(value, { dataset, catalog });
  check(policy && Number.isFinite(policy.maxAgeMs) && policy.maxAgeMs > 0 && Number.isFinite(Date.parse(policy.asOf)),
    'policy-required', 'asOf and positive maxAgeMs');
  const lookup = new Map(dataset.issues.map(x => [x.id, x]));
  const byId = new Map(value.components.map(x => [x.id, x]));
  const pageRecord = value.page.record && lookup.get(value.page.record);
  const nodes = [];
  const walk = (id, parent, depth, position) => {
    const component = byId.get(id);
    const record = component.record ? lookup.get(component.record) : null;
    const node = { id, kind: component.kind, parent, depth, position, record: record?.id ?? null };
    if (component.kind === 'section') {
      Object.assign(node, { heading: catalog.groups[component.group].heading.replace('{record}', component.record ?? ''),
        disclosure: component.disclosure, sequence: component.sequence === 'suggested' ? catalog.sequences.suggested : null,
        total: component.children.length });
      if (component.group === 'recently-done') Object.assign(node, recentEvidence(dataset));
    } else if (component.kind === 'board') {
      const { columns, extra } = catalog.boards[component.by];
      const names = [...(Array.isArray(columns) ? columns : dataset.project[columns.split('.')[1]]), ...extra];
      const placed = component.children.map(child => [child, column(dataset, lookup.get(byId.get(child).record), component.by)]);
      Object.assign(node, { by: component.by, columns: names.map(name => ({ name, children: placed.filter(x => x[1] === name).map(x => x[0]) })) });
    } else if (component.kind === 'dependency-list') {
      Object.assign(node, { direction: component.direction, scope: component.scope,
        heading: catalog.dependencyHeadings[component.direction].replace('{record}', record.id), ...dependencyList(dataset, component, policy) });
    } else if (component.kind === 'task-brief') {
      const execution = record.planning.filter(x => x.kind === 'execution');
      const recommendation = execution.length === 1 ? { state: execution[0].state, source: execution[0].source }
        : { state: execution.length ? 'unsupported' : 'missing', source: null };
      Object.assign(node, { commands: [...catalog.components['task-brief'].commands], recommendation,
        useRecommendation: recommendation.state === 'current', link: allowedLink(record.url) });
    } else {
      Object.assign(node, { link: allowedLink(record.url), route: route(record, catalog),
        workflow: open(record) ? workflow(record) : [], state: record.state, stateReason: record.stateReason,
        closedAt: record.closedAt, placement: structuredClone(record.placement), phase: structuredClone(record.project.phase),
        commitment: structuredClone(record.project.commitment), prerequisites: prerequisiteState(dataset, record),
        reasons: (component.reasons ?? []).map(reason => resolveReason(dataset, record, reason, policy)),
        actions: ['open-brief', ...(allowedLink(record.url) ? ['open-source'] : [])] });
      if (component.kind === 'issue-card') Object.assign(node, { presentation: component.presentation, primary: component.primary });
      else Object.assign(node, { presentation: component.presentation, counts: epicCounts(dataset, record.id, policy) });
    }
    nodes.push(node);
    const sequenced = component.kind === 'section' && component.sequence === 'suggested';
    (component.children ?? []).forEach((child, index) => walk(child, id, depth + 1, sequenced ? index + 1 : null));
  };
  value.root.forEach(id => walk(id, null, 1, null));
  return { page: { kind: value.page.kind, record: pageRecord?.id ?? null, route: pageRecord ? route(pageRecord, catalog) : null },
    layout: value.layout, nodes };
}
