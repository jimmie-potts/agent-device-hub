// Offline contract reference for guide-records/2.0; never imported by a production consumer.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import Ajv from 'ajv';

const schema = JSON.parse(readFileSync(new URL('./records.schema.json', import.meta.url)));
const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(schema);
export const VERSION = 'guide-records/2.0';
export const LABELS = { epic: 'epic', idea: 'idea', bug: 'bug' };
const PRIMARY = ['jimmie-potts/agent-device-hub', 'jimmie-potts/codex-nanoleaf',
  'jimmie-potts/divoom-app-upgrade'];
export const WORKFLOW = ['status:backlog', 'status:ready', 'status:in-progress', 'status:review'];
const HEADINGS = {
  outcome: ['Outcome and real setup', 'Outcome and scope'],
  implementation: ['Smallest useful implementation'],
  protections: ['Behavior and protections to preserve'],
  acceptance: ['Observable acceptance and planned evidence', 'Acceptance criteria'],
  deferrals: ['Meaningful deferrals'],
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const get = (value, path) => path.split('.').reduce((part, key) => part?.[key], value);
const unique = (values, name) => assert(new Set(values).size === values.length, `duplicate ${name}`);
const instant = value => {
  assert(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'invalid timestamp');
  // Date.parse normalizes February 30; compare the date to reject that input.
  assert(new Date(value).toISOString().slice(0, 19) === value.slice(0, 19), 'invalid calendar timestamp');
  return Date.parse(value);
};
export const isEpic = issue => issue.labels.includes(LABELS.epic);

// Recently done is a fixed UTC window ending at the dataset's as-of time, both ends inclusive.
export const RECENT_DAYS = 7;
export function recentWindow(dataset) {
  const end = Date.parse(dataset.asOf);
  return { start: new Date(end - RECENT_DAYS * 86_400_000).toISOString().replace('.000Z', 'Z'), end: dataset.asOf };
}
const inWindow = (dataset, time) => {
  const { start, end } = recentWindow(dataset);
  return time !== null && Date.parse(time) >= Date.parse(start) && Date.parse(time) <= Date.parse(end);
};
// Only a current completed closure counts; not planned, other reasons and reopened issues do not.
export const recentlyDone = (dataset, issue) => issue.state === 'CLOSED' && issue.stateReason === 'completed'
  && inWindow(dataset, issue.closedAt);

// Lists are unordered sets unless declared here; these keep owner or ancestry order.
export const ORDERED = ['project.phases', 'project.commitments', 'issues[].placement.path'];

// Content identity ignores fetch receipts, collection time and build metadata, not facts.
export function datasetIdentity(value) {
  const content = structuredClone(value);
  delete content.datasetId;
  delete content.producerRevision;
  delete content.asOf;
  const observations = [content.project.evidence, ...content.repositories.flatMap(x => [x.inventory, x.recentClosures]),
    ...content.issues.flatMap(x => [x.facts, x.parent.evidence, x.children.evidence, x.blockedBy.evidence])];
  for (const evidence of observations) {
    delete evidence.observedAt;
    if (evidence.pagination) delete evidence.pagination.pages;
  }
  const canonical = (x, path) => {
    if (Array.isArray(x)) {
      const items = x.map(item => canonical(item, path + '[]'));
      return '[' + (ORDERED.includes(path) ? items : items.sort()).join(',') + ']';
    }
    if (x !== null && typeof x === 'object') return '{' + Object.keys(x).sort()
      .map(key => JSON.stringify(key) + ':' + canonical(x[key], path ? `${path}.${key}` : key)).join(',') + '}';
    return JSON.stringify(x);
  };
  return 'sha256:' + createHash('sha256').update(canonical(content, '')).digest('hex');
}

// Nearest containing epic through the native parent chain; a parent alone is never an epic.
export function placementOf(dataset, issue) {
  const lookup = new Map(dataset.issues.map(x => [x.id, x]));
  const above = []; const seen = new Set([issue.id]);
  const result = (state, epic, reason = null) => ({ state, epic, path: [...above].reverse(), reason });
  for (let current = issue; ;) {
    const ids = current.parent.ids;
    if (ids === null) return result('unresolved', null, 'parent-unknown');
    if (ids.length === 0) return result(isEpic(issue) ? 'root' : 'standalone', null);
    const parent = lookup.get(ids[0]);
    if (!parent) return result('unresolved', null, 'ancestor-missing');
    if (seen.has(parent.id)) return result('unresolved', null, 'parent-cycle');
    seen.add(parent.id);
    if (isEpic(parent)) return result('epic', parent.id);
    above.push(parent.id);
    current = parent;
  }
}

// Project values are owner intent: an epic's Phase is authoritative and its members derive it.
export function projectOf(dataset, issue, depth = 0) {
  const { project } = dataset;
  const available = project.public && project.evidence.complete && ['fresh', 'stale'].includes(project.evidence.state);
  const raw = issue.project;
  if (!available || raw.member === null) return { member: null,
    phase: { state: 'unknown', value: null, recorded: null, from: null }, commitment: { state: 'unknown', value: null } };
  const recorded = raw.member ? raw.phase.recorded : null;
  const value = raw.member ? raw.commitment.value : null;
  const commitment = { state: value === null ? 'unselected' : 'selected', value };
  const own = { state: recorded === null ? 'unassigned' : 'assigned', value: recorded, recorded, from: null };
  if (isEpic(issue) || ['root', 'standalone'].includes(issue.placement.state)) return { member: raw.member, phase: own, commitment };
  const epic = issue.placement.state === 'epic' && dataset.issues.find(x => x.id === issue.placement.epic);
  const derived = epic && depth < dataset.issues.length ? projectOf(dataset, epic, depth + 1).phase : null;
  let phase;
  if (!derived || ['unknown', 'conflict'].includes(derived.state)) phase = { state: 'unknown', value: null, recorded, from: epic ? epic.id : null };
  else if (recorded === null) phase = { state: derived.value === null ? 'unassigned' : 'inherited', value: derived.value, recorded, from: epic.id };
  else if (recorded === derived.value) phase = { state: 'inherited', value: recorded, recorded, from: epic.id };
  else phase = { state: 'conflict', value: null, recorded, from: epic.id };
  return { member: raw.member, phase, commitment };
}

export function validateDataset(value, expectedDatasetId = value?.datasetId) {
  assert(value?.schemaVersion === VERSION, 'unsupported schemaVersion');
  assert(validate(value), ajv.errorsText(validate.errors, { separator: '; ' }));
  assert(value.datasetId === expectedDatasetId, 'dataset mismatch');
  unique(value.repositories.map(x => x.name), 'repository');
  unique(value.issues.map(x => x.id), 'issue id');
  unique(value.issues.map(x => x.nodeId), 'issue nodeId');
  assert(JSON.stringify(value.repositories.filter(x => x.scope === 'primary').map(x => x.name).sort())
    === JSON.stringify([...PRIMARY].sort()), 'primary repository scope mismatch');
  const repositories = new Map(value.repositories.map(x => [x.name, x]));
  const issues = new Map(value.issues.map(x => [x.id, x]));
  const asOf = instant(value.asOf);
  const observation = evidence => {
    if (evidence.observedAt !== null) assert(instant(evidence.observedAt) <= asOf, 'observation after dataset asOf');
    if (evidence.state === 'fresh') assert(evidence.observedAt !== null, 'fresh without observation');
    if (evidence.state !== 'fresh' || !evidence.complete) assert(evidence.reason !== null, 'missing evidence reason');
    if (['unknown', 'failed'].includes(evidence.state)) assert(!evidence.complete, 'unavailable evidence marked complete');
    if (evidence.pagination && evidence.complete) {
      assert(!evidence.pagination.hasNextPage, 'incomplete pagination marked complete');
      assert(evidence.pagination.totalCount === null || evidence.pagination.itemCount === evidence.pagination.totalCount,
        'pagination count mismatch');
    }
  };
  const { project } = value;
  observation(project.evidence);
  // A private Project is never collected, so its values cannot reach a public artifact.
  if (!project.public) assert(project.evidence.state !== 'fresh' && !project.evidence.complete
    && value.issues.every(x => x.project.member === null), 'private project values present');
  for (const repository of value.repositories) {
    observation(repository.inventory);
    if (repository.inventory.complete) {
      assert(repository.inventory.pagination !== null, 'inventory pagination missing');
      assert(repository.inventory.pagination.itemCount === value.issues.filter(x => x.repository === repository.name && (repository.scope === 'reference' || x.state === 'OPEN')).length,
        'inventory pagination count mismatch');
    }
    // The collector reads every issue closed in the window, whatever its reason, so the count is checkable.
    observation(repository.recentClosures);
    if (repository.recentClosures.complete) {
      assert(repository.recentClosures.pagination !== null, 'recent closure pagination missing');
      assert(repository.recentClosures.pagination.itemCount === value.issues.filter(x => x.repository === repository.name
        && x.state === 'CLOSED' && inWindow(value, x.closedAt)).length, 'recent closure count mismatch');
    }
  }
  for (const issue of value.issues) {
    assert(repositories.has(issue.repository), 'unregistered repository');
    assert(issue.id === `${issue.repository}#${issue.number}`, 'identity mismatch');
    assert(issue.url === `https://github.com/${issue.repository}/issues/${issue.number}`, 'URL identity mismatch');
    assert(instant(issue.createdAt) <= instant(issue.updatedAt), 'issue timestamp order');
    if (issue.closedAt !== null) assert(instant(issue.closedAt) <= instant(issue.updatedAt), 'closure timestamp order');
    if (issue.state === 'OPEN') assert(issue.closedAt === null && [null, 'reopened'].includes(issue.stateReason), 'open closure mismatch');
    observation(issue.facts);
    if (issue.facts.observedAt !== null) assert(instant(issue.facts.observedAt) >= instant(issue.updatedAt), 'observation predates issue');
    for (const [key, section] of Object.entries(issue.story)) {
      if (section.state === 'present') {
        assert(section.text !== null && section.heading !== null, 'present section lacks content');
        assert(HEADINGS[key].includes(section.heading), 'unsupported story heading');
      }
      else assert(section.reason !== null && section.text === null, 'unavailable section content');
    }
    for (const kind of ['parent', 'children', 'blockedBy']) {
      const relation = issue[kind];
      observation(relation.evidence);
      if (relation.evidence.complete) assert(relation.ids !== null, 'complete collection is unknown');
      if (relation.evidence.complete) assert(relation.evidence.pagination !== null, 'relationship pagination missing');
      if (relation.evidence.pagination && relation.ids !== null) assert(relation.evidence.pagination.itemCount === relation.ids.length, 'relationship pagination count mismatch');
      if (kind === 'parent') assert(relation.ids === null || relation.ids.length <= 1, 'multiple parents');
      if (relation.ids !== null) for (const id of relation.ids) {
        assert(id !== issue.id, 'self relationship');
        if (relation.evidence.complete) assert(issues.has(id), 'complete collection has unresolved reference');
      }
    }
    for (const option of [issue.project.phase.recorded, issue.project.phase.value].filter(x => x !== null))
      assert(project.phases.includes(option), 'unknown phase option');
    if (issue.project.commitment.value !== null) assert(project.commitments.includes(issue.project.commitment.value), 'unknown commitment option');
  }
  // Placement and Project states are producer-computed; recompute so consumers never re-derive them.
  for (const issue of value.issues) {
    assert(isDeepStrictEqual(issue.placement, placementOf(value, issue)), `placement mismatch ${issue.id}`);
    assert(isDeepStrictEqual(issue.project, projectOf(value, issue)), `project mismatch ${issue.id}`);
  }
  assert(value.datasetId === datasetIdentity(value), 'content identity mismatch');
  return value;
}

function policyTime(policy) {
  assert(policy && Number.isFinite(policy.maxAgeMs) && policy.maxAgeMs > 0, 'positive maxAgeMs required');
  return instant(policy.asOf);
}
export function isFresh(evidence, policy) {
  const age = policyTime(policy) - Date.parse(evidence.observedAt);
  return evidence.state === 'fresh' && evidence.complete && evidence.observedAt !== null
    && age >= 0 && age <= policy.maxAgeMs;
}

// A prerequisite's outcome is accepted only by a completed closure of that issue's own scope.
// Further gates (installation, physical or owner acceptance) are separate blocking issues.
export function prerequisiteOutcome(blocker) {
  if (blocker.state === 'OPEN') return 'open';
  if (blocker.stateReason === 'completed') return 'accepted';
  return blocker.stateReason === null ? 'closure-unknown' : 'not-completed';
}

// Two separate facts: whether any native blocker is still open or unknown, and whether every
// closed prerequisite's outcome is accepted. Neither implies the other.
export function prerequisiteState(dataset, issue) {
  const lookup = new Map(dataset.issues.map(x => [x.id, x]));
  const ids = issue.blockedBy.ids;
  if (ids === null) return { noOpenBlocker: null, outcomesAccepted: null, open: [], unaccepted: [], missing: [] };
  const targets = ids.map(id => [id, lookup.get(id)]);
  const missing = targets.filter(([, x]) => !x).map(([id]) => id);
  const open = targets.filter(([, x]) => x?.state === 'OPEN').map(([id]) => id);
  const unaccepted = targets.filter(([, x]) => x && x.state === 'CLOSED' && prerequisiteOutcome(x) !== 'accepted').map(([id]) => id);
  return { noOpenBlocker: missing.length ? null : open.length === 0,
    outcomesAccepted: missing.length ? null : unaccepted.length === 0, open, unaccepted, missing };
}

// Reference decision only. No scheduler, renderer, normalizer or provider call.
export function eligibility(dataset, id, operation, policy) {
  validateDataset(dataset);
  assert(['browse', 'discover', 'prerequisites', 'ready'].includes(operation), 'unknown operation');
  const issue = dataset.issues.find(x => x.id === id);
  assert(issue, 'unknown issue');
  const reasons = [];
  const add = (code, source = issue.url) => reasons.push({ code, source });
  if (operation === 'browse') return { allowed: true, reasons };
  if (operation === 'discover') {
    if (!dataset.publicationPolicy || !issue.publicFields.length) add('public-selection-missing');
    else if (!issue.publicFields.some(field => typeof get(issue, field) === 'string')) add('public-text-missing');
    return { allowed: reasons.length === 0, reasons };
  }
  policyTime(policy);
  const lookup = new Map(dataset.issues.map(x => [x.id, x]));
  const visited = new Set();
  const visit = (record, path) => {
    if (path.has(record.id)) { add('dependency-cycle', record.url); return; }
    if (visited.has(record.id)) return;
    visited.add(record.id);
    if (!isFresh(record.facts, policy)) add('issue-evidence-unavailable', record.facts.source);
    // A closed prerequisite stops the active prerequisite path.
    if (record.id !== id && record.state === 'CLOSED') return;
    if (!isFresh(record.blockedBy.evidence, policy) || record.blockedBy.ids === null) add('dependency-evidence-unavailable', record.blockedBy.evidence.source);
    const next = new Set([...path, record.id]);
    for (const target of record.blockedBy.ids ?? []) {
      const blocker = lookup.get(target);
      if (!blocker) add('dependency-target-missing', record.blockedBy.evidence.source);
      else {
        if (operation === 'ready') {
          const outcome = prerequisiteOutcome(blocker);
          if (outcome !== 'accepted') add(outcome === 'open' ? 'open-prerequisite' : `prerequisite-${outcome}`, blocker.url);
        }
        visit(blocker, next);
      }
    }
  };
  visit(issue, new Set());
  if (operation === 'ready') {
    if (issue.state !== 'OPEN') add('issue-closed');
    const statuses = issue.labels.filter(x => WORKFLOW.includes(x));
    if (statuses.length !== 1 || statuses[0] !== 'status:ready') add('explicit-ready-status-required');
    if (issue.labels.some(x => ['blocked', 'deferred'].includes(x))) add('workflow-hold');
    if (issue.labels.includes(LABELS.idea)) add('idea-hold');
    // Outcome and acceptance are the mandatory intake sections; the others are conditional.
    if (['outcome', 'acceptance'].some(key => issue.story[key].state !== 'present')
      || /^(?:tbd|todo|pending|n\/a|none)[.!]?$/i.test(issue.story.acceptance.text ?? '')) add('story-evidence-incomplete');
  }
  return { allowed: reasons.length === 0, reasons };
}

// Compact model input is literal, not a new author-maintained or model-written summary.
export const EXCERPT_CHARACTERS = 320;
export function publicProjection(dataset) {
  validateDataset(dataset);
  const issues = dataset.issues.filter(x => eligibility(dataset, x.id, 'discover').allowed)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(issue => {
      const fields = {}; const truncatedFields = [];
      for (const field of [...issue.publicFields].sort()) {
        const value = get(issue, field);
        if (value === null) continue;
        if (typeof value === 'string') {
          const characters = [...value];
          fields[field] = characters.slice(0, EXCERPT_CHARACTERS).join('');
          if (characters.length > EXCERPT_CHARACTERS) truncatedFields.push(field);
        } else fields[field] = structuredClone(value);
      }
      return { id: issue.id, fields, truncatedFields };
    });
  return { schemaVersion: VERSION, datasetId: dataset.datasetId, issues };
}

export function validateProjection(value, dataset) {
  // Exact producer allowlist also catches altered facts and extra nested fields.
  assert(isDeepStrictEqual(value, publicProjection(dataset)), 'projection mismatch');
  return value;
}

export function dependents(dataset, id, policy) {
  validateDataset(dataset);
  policyTime(policy);
  const primary = new Set(dataset.repositories.filter(x => x.scope === 'primary').map(x => x.name));
  const opened = dataset.issues.filter(x => primary.has(x.repository) && x.state === 'OPEN');
  const reasons = dataset.repositories.filter(x => x.scope === 'primary' && !isFresh(x.inventory, policy)).map(x => ({ code: 'inventory-incomplete-or-stale', source: x.inventory.source }));
  for (const issue of opened) if (!isFresh(issue.facts, policy) || !isFresh(issue.blockedBy.evidence, policy)) reasons.push({ code: 'graph-incomplete-or-stale', source: issue.url });
  if (reasons.length) return { direct: null, transitive: null, reasons };
  assert(opened.some(x => x.id === id), 'dependent counts require an open primary issue');
  const direct = target => opened.filter(x => x.id !== target && x.blockedBy.ids?.includes(target)).map(x => x.id).sort();
  const seen = new Set([id]); const pending = direct(id);
  while (pending.length) { const target = pending.pop(); if (!seen.has(target)) { seen.add(target); pending.push(...direct(target)); } }
  seen.delete(id);
  return { direct: direct(id), transitive: [...seen].sort(), reasons: [] };
}

// Every open primary issue has exactly one primary page: its nearest epic, or Not in an epic.
export function primaryPage(issue) {
  if (issue.placement.state === 'epic') return `epic:${issue.placement.epic}`;
  if (issue.placement.state === 'root') return `epic:${issue.id}`;
  return 'not-in-epic';
}

// The publication boundary: core issue collections must be complete; enrichment may degrade to gaps.
export function publicationGate(dataset) {
  const fatal = []; const gaps = [];
  const add = (list, code, source) => list.push({ code, source });
  try { validateDataset(dataset); } catch (error) { add(fatal, 'records-invalid', error.message); return { publishable: false, fatal, gaps }; }
  const primary = new Set(dataset.repositories.filter(x => x.scope === 'primary').map(x => x.name));
  for (const repository of dataset.repositories.filter(x => primary.has(x.name))) {
    const { inventory, recentClosures } = repository;
    if (inventory.state !== 'fresh' || !inventory.complete) add(fatal, 'inventory-incomplete', inventory.source);
    if (recentClosures.state !== 'fresh' || !recentClosures.complete) add(gaps, 'recent-closures-incomplete', recentClosures.source);
  }
  const lookup = new Map(dataset.issues.map(x => [x.id, x]));
  const repositoryOf = id => id.split('#')[0];
  for (const issue of dataset.issues.filter(x => x.state === 'OPEN' && primary.has(x.repository))) {
    for (const kind of ['parent', 'blockedBy']) {
      const relation = issue[kind];
      // A read that failed leaves the core graph unknown; a known edge to an outside issue is only a gap.
      if (relation.ids === null) { add(fatal, 'relationship-read-failed', relation.evidence.source); continue; }
      for (const id of relation.ids.filter(id => !lookup.has(id)))
        add(primary.has(repositoryOf(id)) ? fatal : gaps, primary.has(repositoryOf(id)) ? 'reference-missing' : 'reference-unresolved', `${issue.url} → ${id}`);
    }
    for (const key of ['implementation', 'protections', 'deferrals'])
      if (['conflict', 'unsupported'].includes(issue.story[key].state)) add(gaps, 'optional-section-malformed', issue.story[key].source);
    const execution = issue.planning.filter(x => x.kind === 'execution');
    // A missing recommendation is normal; one that exists but cannot be used is a visible gap.
    if (execution.length > 1 || (execution.length === 1 && execution[0].state !== 'current')) add(gaps, 'recommendation-unusable', issue.url);
  }
  const { project } = dataset;
  if (!project.public) add(gaps, 'project-not-public', project.source ?? 'no Project configured');
  else if (!project.evidence.complete || !['fresh', 'stale'].includes(project.evidence.state)) add(gaps, 'project-unavailable', project.evidence.source);
  else if (project.evidence.state === 'stale') add(gaps, 'project-cached', `${project.evidence.source} observed ${project.evidence.observedAt}`);
  // Unsafe projection is fatal: selections need a configured policy and must equal its allowlist exactly.
  if (!dataset.publicationPolicy && dataset.issues.some(x => x.publicFields.length)) add(fatal, 'projection-unsafe', 'public fields selected without a policy');
  try { validateProjection(publicProjection(dataset), dataset); } catch (error) { add(fatal, 'projection-unsafe', error.message); }
  return { publishable: fatal.length === 0, fatal, gaps };
}
