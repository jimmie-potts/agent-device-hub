// Offline contract reference; never imported by a production consumer.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Ajv from 'ajv';
import { validateDataset, eligibility, publicProjection, dependents, VERSION as RECORDS_VERSION } from '../reference.mjs';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const schema = read('./guide-views.schema.json');
const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(schema);
export const VERSION = 'guide-views/1.0';
export const CATALOG = read('./catalog.json');

// A rejection code is stable wire vocabulary; the detail after it is diagnostic.
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

// The default view is a constant: no dataset, catalog selection or provider call.
export function fullGuideView() {
  return { schemaVersion: VERSION, layout: 'full-guide' };
}

function recordFor(dataset, component) {
  return component.kind === 'subguide-panel'
    ? dataset.subguides.find(x => x.id === component.subguide)
    : dataset.issues.find(x => x.id === component.record);
}

function hasEdge(issue, relation, other) {
  const field = { blocks: other.blockedBy, 'blocked-by': issue.blockedBy,
    'parent-of': issue.children, 'child-of': issue.parent }[relation];
  const target = relation === 'blocks' ? issue.id : other.id;
  return field.ids?.includes(target) ?? false;
}

export function validateView(value, { dataset, catalog = CATALOG } = {}) {
  check(value?.schemaVersion === VERSION, 'unsupported-version', String(value?.schemaVersion));
  check(validate(value), 'schema', ajv.errorsText(validate.errors, { separator: '; ' }));
  if (value.layout === 'full-guide') return value;
  check(catalog.catalogVersion === VERSION && catalog.recordsVersion === RECORDS_VERSION,
    'catalog-mismatch', 'unsupported catalog version');
  check(value.catalogId === catalogIdentity(catalog), 'catalog-mismatch', value.catalogId);
  check(dataset?.schemaVersion === value.recordsVersion, 'records-mismatch', String(dataset?.schemaVersion));
  try { validateDataset(dataset); } catch (error) { reject('records-invalid', error.message); }
  check(value.datasetId === dataset.datasetId, 'dataset-mismatch', value.datasetId);

  const { bounds, components: kinds, groups, reasons: reasonKinds } = catalog;
  check(value.components.length <= bounds.maxComponents && value.root.length <= bounds.maxRootSections,
    'size-exceeded', 'component or section count');
  const byId = new Map();
  for (const component of value.components) {
    check(!byId.has(component.id), 'duplicate-instance', component.id);
    byId.set(component.id, component);
  }

  // Walk from the root; a revisit on the current path is a cycle, elsewhere a second parent.
  const visited = new Set();
  const visit = (id, parent, depth, path) => {
    const component = byId.get(id);
    check(component, 'unknown-component', id);
    check(!path.has(id), 'cycle', id);
    check(!visited.has(id), 'multiple-parents', id);
    visited.add(id);
    check(depth <= bounds.maxDepth, 'depth-exceeded', id);
    const parentKind = parent?.kind ?? 'root';
    check(kinds[component.kind].parents.includes(parentKind), 'nesting-not-allowed', `${component.kind} in ${parentKind}`);
    if (parent?.kind === 'section') check(groups[parent.group].children.includes(component.kind), 'nesting-not-allowed', `${component.kind} in ${parent.group}`);
    const children = component.children ?? [];
    check(children.length <= bounds.maxChildren, 'size-exceeded', id);
    const siblings = children.map(child => byId.get(child)).filter(Boolean)
      .map(child => child.kind + ':' + (child.record ?? child.subguide ?? child.group));
    check(new Set(siblings).size === siblings.length, 'duplicate-sibling', id);
    const next = new Set([...path, id]);
    for (const child of children) visit(child, component, depth + 1, next);
  };
  const sections = value.root.map(id => byId.get(id)?.group);
  check(new Set(sections).size === sections.length, 'duplicate-sibling', 'root');
  for (const id of value.root) visit(id, null, 1, new Set());
  for (const id of byId.keys()) check(visited.has(id), 'orphan', id);

  const projection = publicProjection(dataset);
  const parents = new Map(value.components.flatMap(c => (c.children ?? []).map(child => [child, c])));
  for (const component of value.components) {
    if (component.kind === 'section') {
      const rule = groups[component.group];
      for (const child of component.children.map(id => byId.get(id))) {
        if (rule.requiresReason) check(child.reasons.some(x => x.code === rule.requiresReason), 'group-requirement', child.id);
        if (rule.requiresHighlight) check(recordFor(dataset, child)?.guide.highlight?.kind === rule.requiresHighlight, 'group-requirement', child.id);
      }
      continue;
    }
    const record = recordFor(dataset, component);
    check(record, 'unknown-record', component.record ?? component.subguide);
    const parent = parents.get(component.id);
    if (parent.kind === 'subguide-panel') {
      const guide = dataset.subguides.find(x => x.id === parent.subguide);
      check(guide.members.includes(record.id), 'membership', `${record.id} in ${guide.id}`);
    }
    const codes = (component.reasons ?? []).map(x => x.code);
    check(new Set(codes).size === codes.length, 'duplicate-reason', component.id);
    for (const reason of component.reasons ?? []) {
      check(reasonKinds[reason.code].components.includes(component.kind), 'reason-not-allowed', `${reason.code} on ${component.kind}`);
      for (const evidence of reason.evidence) {
        if (reason.code === 'question-match') {
          const entries = component.kind === 'subguide-panel' ? projection.subguides : projection.issues;
          const entry = entries.find(x => x.id === record.id);
          check(entry && evidence.field in entry.fields, 'evidence-not-public', `${record.id} ${evidence.field}`);
        } else if (reason.code === 'guide-member') {
          const guide = dataset.subguides.find(x => x.id === evidence.subguide);
          check(guide?.members.includes(record.id), 'evidence-unverified', `${record.id} in ${evidence.subguide}`);
        } else if (reason.code === 'guide-contains') {
          check(record.members.includes(evidence.record), 'evidence-unverified', `${record.id} contains ${evidence.record}`);
        } else {
          const other = dataset.issues.find(x => x.id === evidence.record);
          check(other && other.id !== record.id, 'evidence-unverified', evidence.record);
          check(reason.code === 'idea-extends'
            ? record.guide.highlight?.kind === 'idea' && record.guide.extends.includes(other.id)
            : hasEdge(record, evidence.relation, other), 'evidence-unverified', `${evidence.relation} ${other.id}`);
        }
      }
    }
  }
  return value;
}

// Browser links come only from referenced records and only to GitHub pages.
export function allowedLink(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'https://github.com' && !parsed.username && !parsed.password ? url : null;
  } catch { return null; }
}

function fresh(evidence, policy) {
  const age = Date.parse(policy.asOf) - Date.parse(evidence.observedAt);
  return evidence.state === 'fresh' && evidence.complete && evidence.observedAt !== null
    && age >= 0 && age <= policy.maxAgeMs;
}

function dependencyList(dataset, component, policy) {
  const issue = dataset.issues.find(x => x.id === component.record);
  if (component.direction === 'dependents') {
    const primary = dataset.repositories.find(x => x.name === issue.repository)?.scope === 'primary';
    if (!primary || issue.state !== 'OPEN') return { ids: null, complete: false, reasons: [{ code: 'dependents-unavailable', source: issue.url }] };
    const result = dependents(dataset, issue.id, policy);
    return result.direct === null ? { ids: null, complete: false, reasons: result.reasons }
      : { ids: result[component.scope === 'direct' ? 'direct' : 'transitive'], complete: true, reasons: [] };
  }
  if (component.scope === 'direct') {
    const complete = issue.blockedBy.ids !== null && fresh(issue.blockedBy.evidence, policy);
    return { ids: issue.blockedBy.ids, complete,
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
    if (next && next.state === 'OPEN') pending.push(...(next.blockedBy.ids ?? []));
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
      if (!fresh(owner[field].evidence, policy)) {
        result.state = 'stale';
        result.withheld.push({ code: 'relation-evidence-stale', source: owner[field].evidence.source });
      }
    }
  }
  return result;
}

// Resolution computes every claim from records at use; motion is the only optional layer.
export function resolveView(value, { dataset, policy, reducedMotion = false, catalog = CATALOG } = {}) {
  validateView(value, { dataset, catalog });
  const motion = { transition: 'none', acknowledge: 'none' };
  if (value.layout === 'full-guide') return { layout: 'full-guide', motion, regions: structuredClone(catalog.fullGuide.regions),
    features: [...catalog.fullGuide.features], nodes: [] };
  check(policy && Number.isFinite(policy.maxAgeMs) && policy.maxAgeMs > 0 && Number.isFinite(Date.parse(policy.asOf)),
    'policy-required', 'asOf and positive maxAgeMs');
  if (!reducedMotion) Object.assign(motion, { transition: value.transition, acknowledge: 'acknowledge' });
  const byId = new Map(value.components.map(x => [x.id, x]));
  const nodes = [];
  const walk = (id, parent, depth, position) => {
    const component = byId.get(id);
    const node = { id, kind: component.kind, parent, depth, position, disclosure: component.disclosure ?? null };
    if (component.kind === 'section') {
      Object.assign(node, { heading: catalog.groups[component.group].heading,
        sequence: component.sequence === 'suggested' ? catalog.sequences.suggested : null, actions: ['toggle'] });
    } else if (component.kind === 'dependency-list') {
      const record = recordFor(dataset, component);
      Object.assign(node, { record: record.id, direction: component.direction, scope: component.scope,
        heading: catalog.dependencyHeadings[component.direction].replace('{record}', record.id),
        ...dependencyList(dataset, component, policy), actions: ['open-brief'] });
    } else {
      const record = recordFor(dataset, component);
      const link = allowedLink(component.kind === 'issue-card' ? record.url : record.source);
      Object.assign(node, { [component.kind === 'issue-card' ? 'record' : 'subguide']: record.id, link,
        emphasis: component.emphasis, density: component.density ?? null,
        reasons: component.reasons.map(reason => resolveReason(dataset, record, reason, policy)),
        actions: [...(component.kind === 'issue-card' ? ['open-brief'] : ['toggle']), ...(link ? ['open-source'] : [])],
        motion: !reducedMotion && component.emphasis === 'highlight' ? 'emphasize' : 'none' });
    }
    nodes.push(node);
    const sequenced = component.kind === 'section' && component.sequence === 'suggested';
    (component.children ?? []).forEach((child, index) => walk(child, id, depth + 1, sequenced ? index + 1 : null));
  };
  value.root.forEach(id => walk(id, null, 1, null));
  return { layout: value.layout, motion, nodes };
}

// Facts, reasons, order, focus targets and actions; everything except motion.
export function semanticContent(model) {
  const { motion, ...rest } = structuredClone(model);
  for (const node of rest.nodes) delete node.motion;
  return rest;
}
