// Core payload families (Hub #842): every family against the shared fixtures, and removal, expiry and sync.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {MessageValidator, errorCodes} from '../dist/v2/index.js';
import {coreFamilies, registerCoreFamilies, sessionEntityId, sessionTitle} from '../dist/v2/families.js';
import {consumerCopy, familyOf} from './consumer.mjs';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/v2/families.json', import.meta.url), 'utf8'));
const validator = () => {
  const v = new MessageValidator();
  registerCoreFamilies(v);
  return v;
};
// Sets each JSON pointer on a copy of a valid message; null removes the member.
function patched(base, set) {
  const value = structuredClone(fixtures.valid[base]);
  for (const [pointer, change] of Object.entries(set)) {
    const path = pointer.slice(1).split('/');
    const last = path.pop();
    const parent = path.reduce((node, part) => node[part], value);
    if (change === null) delete parent[last];
    else parent[last] = change;
  }
  return value;
}

test('every valid fixture passes, and every core family and the kinds they use have one', () => {
  const v = validator();
  const families = new Set(), kinds = new Set();
  for (const [name, message] of Object.entries(fixtures.valid)) {
    const result = v.validate(message, {nowMs: Date.parse(message.time)});
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.error)}`);
    families.add(familyOf(message));
    kinds.add(message.kind);
  }
  assert.deepEqual(coreFamilies.map(({family}) => family).filter(family => !families.has(family)), []);
  assert.deepEqual([...kinds].sort(), ['command', 'occurrence', 'outcome', 'removal', 'reply', 'state', 'sync-completed', 'sync-request']);
  const removals = fixtures.scenarios.flatMap(scenario => scenario.steps).map(step => fixtures.valid[step]).filter(message => message.kind === 'removal');
  assert.deepEqual([...new Set(removals.map(message => message.data.reason))].sort(), ['deleted', 'expired', 'retired'], 'the scenarios cover every removal reason');
});

test('every invalid fixture fails where it says', () => {
  const v = validator();
  for (const {name, base, set, expect, detail} of fixtures.invalid) {
    const message = patched(base, set);
    const result = v.validate(message, {nowMs: Date.parse(message.time)});
    assert.equal(result.ok, false, name);
    assert.deepEqual([result.error.code, result.error.detail], [expect, detail], name);
    assert.equal(result.error.retryable, errorCodes[expect].retryable);
  }
});

test('each family has one kind and one type, and its schema is built from the shared blocks', () => {
  const v = validator();
  const types = new Map();
  const refs = schema => [...JSON.stringify(schema).matchAll(/"\$ref":"(https:[^"#]+)/g)].map(match => match[1]);
  const profile = uri => uri.endsWith('/blocks/2.0') || uri.endsWith('/kinds/2.0');
  const usesBlocks = schema => refs(schema).some(uri => uri.endsWith('/blocks/2.0') ||
    usesBlocks(coreFamilies.find(family => family.dataschema === uri)?.schema ?? {}));
  for (const {family, kind, type, dataschema, schema} of coreFamilies) {
    assert.equal(schema.$id, dataschema, family);
    assert.ok(dataschema === `https://bunny.invalid/events/${family}/2.0` || (family === 'inbox-item' && dataschema === 'https://bunny.invalid/events/inbox-item/2.1'));
    assert.ok(usesBlocks(schema), `${family} uses the blocks`);
    for (const uri of refs(schema)) assert.ok(profile(uri) || coreFamilies.some(other => other.dataschema === uri), `${family}: ${uri}`);
    assert.ok(['state', 'occurrence', 'command'].includes(kind), family);
    assert.ok(!types.has(type) || types.get(type) === family, `${type} belongs to one family across versions`);
    types.set(type, family);
  }
  assert.throws(() => registerCoreFamilies(v), /already registered/);
});

test('session labels admit 80 Unicode scalars and clear, and refuse invalid scalars, controls and recognizable credentials', () => {
  const v = validator();
  for (const label of ['🐰'.repeat(80), null]) {
    const message = structuredClone(fixtures.valid['session-label-set']);
    message.data.label = label;
    assert.equal(v.validate(message).ok, true);
  }
  for (const label of ['🐰'.repeat(81), '\ud800', '\udc00', 'line\nline', 'password=synthetic-secret', 'sk-' + 'x'.repeat(20)]) {
    const message = structuredClone(fixtures.valid['session-label-set']);
    message.data.label = label;
    assert.equal(v.validate(message).ok, false, JSON.stringify(label));
  }
});

test('the session ID is the SHA-256 of the identity, whatever its key order', () => {
  const {identity, id} = fixtures.valid.session.data;
  assert.equal(sessionEntityId(identity), id);
  assert.equal(sessionEntityId(Object.fromEntries(Object.entries(identity).reverse())), id);
  assert.notEqual(sessionEntityId({...identity, sourceId: 'codex-cli'}), id);
  assert.match(id, /^[0-9a-f]{64}$/);
});

test('the title keeps its precedence: the winning label, then the title, then the consumer fallback', () => {
  const {session, 'session-child': child, 'session-claude': claude} = fixtures.valid;
  assert.equal(sessionTitle(session.data), 'Port Nanoleaf', 'a user label precedes the provider title');
  assert.equal(sessionTitle(child.data), 'Review the schema', 'an agent label precedes a missing title');
  assert.equal(sessionTitle(claude.data), 'Plan the cutover');
  assert.equal(sessionTitle({}), undefined, 'no label or title leaves the neutral fallback to the consumer');
});

test('removal, expiry and sync leave the consumer holding exactly the owner entities', () => {
  const v = validator();
  for (const {name, steps, expect} of fixtures.scenarios) {
    const copy = consumerCopy();
    for (const step of steps) {
      assert.equal(v.validate(fixtures.valid[step]).ok, true, `${name}: ${step}`);
      copy.apply(structuredClone(fixtures.valid[step]));
    }
    const expected = new Map(expect.map(step => [`${familyOf(fixtures.valid[step])}/${fixtures.valid[step].data.id}`, fixtures.valid[step].data]));
    assert.deepEqual(copy.held, expected, name);
  }
});

test('a sync request and its sync.completed carry the requested families, joined by commas, as their subject (Hub #883)', () => {
  const messages = JSON.parse(readFileSync(new URL('../fixtures/v2/messages.json', import.meta.url), 'utf8'));
  for (const set of [messages, fixtures]) {
    const valid = Object.values(set.valid);
    const families = new Map(valid.filter(message => message.kind === 'sync-request').map(message => [message.data.requestId, message.data.families]));
    const sync = valid.filter(message => message.kind === 'sync-request' || message.kind === 'sync-completed');
    assert.ok(sync.length > 0);
    for (const message of sync) assert.equal(message.subject, families.get(message.data.requestId)?.join(','), message.id);
  }
});

test('Desktop metadata observations use the lifecycle family without invented lifecycle evidence',()=>{
 const base=Object.values(fixtures.valid).find(m=>m.type==='org.bunny.lifecycle.observed');
 const message={...structuredClone(base),data:{identity:{provider:'codex',client:'desktop',hostId:'host',sourceId:'desktop',sessionId:'one'},turn:{status:'unknown'},parent:{status:'top-level'},ordering:{status:'unknown'},observedAtMs:1000,event:{kind:'metadata-observed',archived:true}}};
 message.subject=sessionEntityId(message.data.identity);
 const v=validator();assert.equal(v.validate(message).ok,true);
 message.data.event={kind:'metadata-observed'};assert.equal(v.validate(message).ok,false);
 message.data.title={value:'Desktop title',source:'provider'};assert.equal(v.validate(message).ok,true);
 message.data.identity.client='cli';assert.equal(v.validate(message).ok,false);
 message.data.identity.client='desktop';message.data.label={value:'Owner',origin:'user'};assert.equal(v.validate(message).ok,false);
});

test('inbox conflict is additive, preserves opposite evidence, and handling input is closed', () => {
  const v = validator();
  const conflict = structuredClone(fixtures.valid['inbox-item-conflict']);
  assert.equal(v.validate(conflict).ok, true);
  conflict.data.item.outcomes[1].result = 'succeeded';
  assert.equal(v.validate(conflict).ok, false, 'two successes are no conflict');
  delete conflict.data.item.outcomes;
  assert.equal(v.validate(conflict).ok, false, 'conflict requires both outcomes');
  conflict.data.item.result = 'succeeded';
  assert.equal(v.validate(conflict).ok, true, 'late success remains an open item');
  const handle = structuredClone(fixtures.valid['inbox-handle']);
  handle.data.actor = 'forged';
  assert.equal(v.validate(handle).ok, false, 'handling actor comes from authentication');
});
