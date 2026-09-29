// Offline contract reference; never imported by a production consumer.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import Ajv from 'ajv';

const schema = JSON.parse(readFileSync(new URL('./guide-records.schema.json', import.meta.url)));
const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(schema);
export const VERSION = 'guide-records/1.0';
export const TOPICS = ['shared-codex', 'bunny-controls', 'nanoleaf-presentation',
  'nanoleaf-devices', 'pixoo-media', 'controls-music', 'desktop-controls',
  'work-guide', 'assistant-access', 'hosting-migrations', 'development-workflow', 'steam-deck'];
const PRIMARY = ['jimmie-potts/agent-device-hub', 'jimmie-potts/codex-nanoleaf',
  'jimmie-potts/divoom-app-upgrade'];
const WORKFLOW = ['status:backlog', 'status:ready', 'status:in-progress', 'status:review'];
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

// Content identity ignores fetch receipts and diagnostic build metadata, not facts.
// Arrays in this schema are sets; canonical order does not depend on API pagination.
export function datasetIdentity(value) {
  const content = structuredClone(value);
  delete content.datasetId;
  delete content.producerRevision;
  const observations = [...content.repositories.map(x => x.inventory),
    ...content.issues.flatMap(x => [x.facts, x.parent.evidence, x.children.evidence, x.blockedBy.evidence])];
  for (const evidence of observations) {
    delete evidence.observedAt;
    if (evidence.pagination) delete evidence.pagination.pages;
  }
  const canonical = x => {
    if (Array.isArray(x)) return '[' + x.map(canonical).sort().join(',') + ']';
    if (x !== null && typeof x === 'object') return '{' + Object.keys(x).sort()
      .map(key => JSON.stringify(key) + ':' + canonical(x[key])).join(',') + '}';
    return JSON.stringify(x);
  };
  return 'sha256:' + createHash('sha256').update(canonical(content)).digest('hex');
}

export function validateDataset(value, expectedDatasetId = value?.datasetId) {
  assert(value?.schemaVersion === VERSION, 'unsupported schemaVersion');
  assert(validate(value), ajv.errorsText(validate.errors, { separator: '; ' }));
  assert(value.datasetId === expectedDatasetId, 'dataset mismatch');
  unique(value.repositories.map(x => x.name), 'repository');
  unique(value.issues.map(x => x.id), 'issue id');
  unique(value.issues.map(x => x.nodeId), 'issue nodeId');
  unique(value.subguides.map(x => x.id), 'sub-guide id');
  assert(JSON.stringify(value.repositories.filter(x => x.scope === 'primary').map(x => x.name).sort())
    === JSON.stringify([...PRIMARY].sort()), 'primary repository scope mismatch');
  const repositories = new Map(value.repositories.map(x => [x.name, x]));
  const issues = new Map(value.issues.map(x => [x.id, x]));
  const observation = evidence => {
    if (evidence.observedAt !== null) instant(evidence.observedAt);
    if (evidence.state === 'fresh') assert(evidence.observedAt !== null, 'fresh without observation');
    if (evidence.state !== 'fresh' || !evidence.complete) assert(evidence.reason !== null, 'missing evidence reason');
    if (['unknown', 'failed'].includes(evidence.state)) assert(!evidence.complete, 'unavailable evidence marked complete');
    if (evidence.pagination && evidence.complete) {
      assert(!evidence.pagination.hasNextPage, 'incomplete pagination marked complete');
      assert(evidence.pagination.totalCount === null || evidence.pagination.itemCount === evidence.pagination.totalCount,
        'pagination count mismatch');
    }
  };
  for (const repository of value.repositories) {
    observation(repository.inventory);
    if (repository.inventory.complete) {
      assert(repository.inventory.pagination !== null, 'inventory pagination missing');
      assert(repository.inventory.pagination.itemCount === value.issues.filter(x => x.repository === repository.name && (repository.scope === 'reference' || x.state === 'OPEN')).length,
        'inventory pagination count mismatch');
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
    if (issue.guide.state === 'assigned') assert(TOPICS.includes(issue.guide.topic), 'unknown topic');
    else {
      assert(issue.guide.topic === null && issue.guide.reason !== null, 'unavailable guide topic');
      assert(issue.guide.note === null && issue.guide.workaround === null && issue.guide.highlight === null
        && issue.guide.extends.length === 0, 'unavailable guide contains parsed claims');
    }
    if (issue.guide.extends.length) assert(issue.guide.highlight?.kind === 'idea', 'Extends requires idea');
    for (const id of issue.guide.extends) assert(issues.has(id), 'unresolved Extends reference');
    for (const kind of ['parent', 'children', 'blockedBy']) {
      const relation = issue[kind];
      observation(relation.evidence);
      if (relation.evidence.complete) assert(relation.ids !== null, 'complete collection is unknown');
      if (relation.evidence.complete) assert(relation.evidence.pagination !== null, 'relationship pagination missing');
      if (relation.evidence.pagination && relation.ids !== null) assert(relation.evidence.pagination.itemCount === relation.ids.length, 'relationship pagination count mismatch');
      if (kind === 'parent') assert(relation.ids === null || relation.ids.length <= 1, 'multiple parents');
      if (relation.ids !== null) for (const id of relation.ids) {
        assert(id !== issue.id, 'self relationship');
        // Unknown target details are a supported incomplete record, not zero blockers.
        if (relation.evidence.complete) assert(issues.has(id), 'complete collection has unresolved reference');
      }
    }
  }
  for (const guide of value.subguides) {
    assert(TOPICS.includes(guide.topic), 'unknown sub-guide topic');
    instant(guide.asOf);
    for (const id of guide.members) assert(issues.has(id), 'unresolved sub-guide member');
  }
  assert(value.datasetId === datasetIdentity(value), 'content identity mismatch');
  return value;
}

function policyTime(policy) {
  assert(policy && Number.isFinite(policy.maxAgeMs) && policy.maxAgeMs > 0, 'positive maxAgeMs required');
  return instant(policy.asOf);
}
function isFresh(evidence, policy) {
  const age = policyTime(policy) - Date.parse(evidence.observedAt);
  return evidence.state === 'fresh' && evidence.complete && evidence.observedAt !== null
    && age >= 0 && age <= policy.maxAgeMs;
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
    // A closed prerequisite stops the active prerequisite path, as in the guide.
    if (record.id !== id && record.state === 'CLOSED') return;
    if (!isFresh(record.blockedBy.evidence, policy) || record.blockedBy.ids === null) add('dependency-evidence-unavailable', record.blockedBy.evidence.source);
    const next = new Set([...path, record.id]);
    for (const target of record.blockedBy.ids ?? []) {
      const blocker = lookup.get(target);
      if (!blocker) add('dependency-target-missing', record.blockedBy.evidence.source);
      else {
        if (operation === 'ready' && blocker.state !== 'CLOSED') add('open-prerequisite', blocker.url);
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
    if (issue.guide.state !== 'assigned') add('guide-placement-unavailable');
    if (issue.guide.highlight && ['idea', 'later', 'decision'].includes(issue.guide.highlight.kind)) add('editorial-hold');
    if (Object.values(issue.story).some(x => x.state !== 'present')
      || /^(?:tbd|todo|pending|n\/a|none)[.!]?$/i.test(issue.story.acceptance.text ?? '')) add('story-evidence-incomplete');
  }
  return { allowed: reasons.length === 0, reasons };
}

// Compact search text is literal, not a new author-maintained or model-written summary.
export const EXCERPT_CHARACTERS = 320;
export function publicProjection(dataset) {
  validateDataset(dataset);
  const excerpt = (record, paths) => {
    const fields = {}; const truncatedFields = [];
    for (const field of [...paths].sort()) {
      const value = get(record, field);
      if (value === null) continue;
      if (typeof value === 'string') {
        const characters = [...value];
        fields[field] = characters.slice(0, EXCERPT_CHARACTERS).join('');
        if (characters.length > EXCERPT_CHARACTERS) truncatedFields.push(field);
      } else fields[field] = structuredClone(value);
    }
    return { fields, truncatedFields };
  };
  const issues = dataset.issues.filter(x => eligibility(dataset, x.id, 'discover').allowed)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(issue => ({ id: issue.id, ...excerpt(issue, issue.publicFields) }));
  const publicIds = new Set(issues.map(x => x.id));
  const subguides = dataset.subguides.filter(x => dataset.publicationPolicy && x.publicFields.length)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(guide => ({ id: guide.id, members: guide.members.filter(id => publicIds.has(id)).sort(),
      ...excerpt(guide, guide.publicFields) }));
  return { schemaVersion: VERSION, datasetId: dataset.datasetId, issues, subguides };
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
