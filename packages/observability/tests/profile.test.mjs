// Profile 1.2 (Hub #903) registers the B.U.N.N.Y. runtime: its service, its two scopes, its events and attributes.
// Each profile's additions are closed to the earlier profiles, and producers still default to profile 1.1.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ARTIFACT_VERSION, SCHEMA_VERSION, catalog, createRecord, projectRecord, validateRecord} from '../dist/index.js';
import {record as hub} from './sample.mjs';

const schema = JSON.parse(readFileSync(new URL('../src/record.schema.json', import.meta.url), 'utf8'));
const properties = schema.properties;
const versions = catalog.schema_versions;
const runtimeResource = {...hub.resource, 'service.name': 'runtime', 'service.version': '0.1.0'};
const runtime = {...hub, schema_version: '1.2', event_name: 'runtime.started', body: 'Runtime started',
  resource: runtimeResource, scope: {name: 'bunny.runtime', version: '1.0.0'}};
const module = {...hub, schema_version: '1.2', event_name: 'command.completed', body: 'Command completed',
  resource: runtimeResource, scope: {name: 'bunny.module', version: '1.0.0'},
  attributes: {'bunny.provenance': 'source', 'bunny.module': 'lamp', 'bunny.outcome': 'succeeded'}};
/** A valid value for each attribute that a profile after 1.0 adds. Adding an attribute needs an example here. */
const examples = {
  'bunny.queue.depth': 2,
  'bunny.module': 'lamp',
  'bunny.source': 'bunny/modules/lamp',
  'bunny.pattern': 'bunny.event.*.*',
  'bunny.code': 'internal',
  'bunny.phase': 'handler',
  'bunny.modules': 2,
  'bunny.timeout_ms': 5000,
  'bunny.exit_code': 1,
  'bunny.lag.ms': 10250,
  'bunny.lag.limit_ms': 10000,
  'bunny.dropped.count': 3,
  'bunny.message.id': '6f1c2d4e-8a9b-4c3d-9e2f-0a1b2c3d4e5f',
  'bunny.message.kind': 'outcome',
  'bunny.message.count': 3,
  'error.type': 'RuntimeError',
  'error.code': 'state-dir-relative',
};
const valid = value => validateRecord(value).ok;
const at = (value, version) => ({...value, schema_version: version});

test('artifact 1.2.0 adds profile 1.2, and producers still default to profile 1.1', () => {
  assert.equal(ARTIFACT_VERSION, '1.2.0');
  assert.equal(catalog.artifact_version, '1.2.0');
  assert.deepEqual(versions, ['1.0', '1.1', '1.2']);
  assert.equal(SCHEMA_VERSION, '1.1');
  assert.equal(catalog.default_schema_version, '1.1');
  const omitted = {...hub};
  delete omitted.schema_version;
  assert.equal(createRecord(omitted).value.schema_version, '1.1');
  assert.equal(valid(runtime), true);
  assert.equal(valid(module), true);
});

test('the schema and the catalog register the same vocabulary', () => {
  assert.deepEqual(properties.schema_version.enum, versions);
  const same = (listed, registered, what) => { assert.deepEqual([...listed].sort(), [...registered].sort(), what); };
  same(properties.event_name.enum, Object.keys(catalog.events), 'events');
  same(properties.body.enum, Object.values(catalog.events), 'bodies');
  same(properties.resource.properties['service.name'].enum, catalog.services, 'services');
  same(properties.scope.properties.name.enum, catalog.scopes, 'scopes');
  assert.deepEqual(properties.attributes.properties, catalog.attributes);
  assert.equal(new Set(Object.values(catalog.events)).size, Object.keys(catalog.events).length, 'every body is distinct');
});

test('each profile\'s additions are registered, and every earlier profile rejects them', () => {
  const added = Object.entries(catalog.additions);
  assert.deepEqual(added.map(([version]) => version), versions.slice(1));
  assert.deepEqual(Object.keys(examples).sort(), added.flatMap(([, addition]) => addition.attributes ?? []).sort());
  for (const [version, addition] of added) {
    const earlier = versions.slice(0, versions.indexOf(version));
    for (const name of addition.attributes ?? []) {
      assert.ok(catalog.attributes[name], name);
      const uses = {...hub, attributes: {...hub.attributes, [name]: examples[name]}};
      assert.equal(valid(at(uses, version)), true, `${name} in ${version}`);
      for (const old of earlier) assert.equal(valid(at(uses, old)), false, `${name} in ${old}`);
    }
    for (const name of addition.services ?? []) {
      assert.ok(catalog.services.includes(name), name);
      for (const old of earlier) assert.equal(valid(at(runtime, old)), false, `${name} in ${old}`);
    }
    for (const name of addition.scopes ?? []) {
      assert.ok(catalog.scopes.includes(name), name);
      const uses = name === 'bunny.module' ? module : runtime;
      assert.equal(valid(at(uses, version)), true, `${name} in ${version}`);
      for (const old of earlier) assert.equal(valid(at(uses, old)), false, `${name} in ${old}`);
    }
    for (const name of addition.events ?? []) {
      assert.ok(catalog.events[name], name);
      const uses = Object.entries(catalog.scope_rules).find(([, rule]) => rule.events.includes(name));
      assert.ok(uses, `${name} belongs to a scope`);
      const [scope] = uses;
      const base = scope === 'bunny.module' ? module : runtime;
      const record = {...base, event_name: name, body: catalog.events[name]};
      assert.equal(valid(at(record, version)), true, `${name} in ${version}`);
      for (const old of earlier) assert.equal(valid(at(record, old)), false, `${name} in ${old}`);
    }
  }
});

test('the runtime\'s scopes allow only their own service and events, and a module record names its module', () => {
  const runtimeEvents = catalog.scope_rules['bunny.runtime'].events;
  const moduleEvents = catalog.scope_rules['bunny.module'].events;
  assert.deepEqual(catalog.scope_rules['bunny.module'].required_attributes, ['bunny.module']);
  assert.ok(runtimeEvents.every(name => name.startsWith('runtime.')));
  assert.ok(moduleEvents.every(name => !name.startsWith('runtime.')));
  for (const name of runtimeEvents) {
    const record = {...runtime, event_name: name, body: catalog.events[name]};
    assert.equal(valid(record), true, name);
    assert.equal(valid({...record, scope: module.scope, attributes: module.attributes}), false, `${name} under bunny.module`);
    assert.equal(valid({...record, scope: hub.scope}), false, `${name} under ${hub.scope.name}`);
  }
  for (const name of moduleEvents) {
    const record = {...module, event_name: name, body: catalog.events[name]};
    assert.equal(valid(record), true, name);
    assert.equal(valid({...record, scope: runtime.scope}), false, `${name} under bunny.runtime`);
  }
  const {['bunny.module']: _name, ...unnamed} = module.attributes;
  assert.equal(valid({...module, attributes: unnamed}), false, 'a module record names its module');
  assert.equal(valid({...module, resource: hub.resource}), false, 'only the runtime hosts modules');
  assert.equal(valid({...runtime, resource: hub.resource}), false, 'only the runtime writes bunny.runtime records');
  assert.equal(valid({...module, event_name: 'lamp.switched', body: 'Lamp switched'}), false, 'an unregistered event');
});

test('a profile 1.2 record projects to 1.1 only without 1.2 vocabulary, and a 1.1 record projects to 1.2', () => {
  assert.equal(projectRecord(runtime, '1.1').ok, false);
  assert.equal(projectRecord(module, '1.0').ok, false);
  assert.equal(projectRecord(at(hub, '1.2'), '1.1').value.schema_version, '1.1');
  const raised = projectRecord(hub, '1.2');
  assert.equal(raised.ok, true);
  assert.equal(raised.value.schema_version, '1.2');
  assert.equal(projectRecord(hub, '1.3').ok, false);
});

test('construction keeps an explicit profile 1.2 and discards what the catalog does not register', () => {
  const built = createRecord({...module, attributes: {...module.attributes, 'error.message': 'SECRET token=abc', detail: 'SECRET'}});
  assert.equal(built.ok, true);
  assert.equal(built.value.schema_version, '1.2');
  assert.equal(JSON.stringify(built.value).includes('SECRET'), false);
  assert.equal(validateRecord({...module, attributes: {...module.attributes, 'error.message': 'SECRET'}}).ok, false);
  assert.equal(createRecord({...module, attributes: {...module.attributes, 'bunny.source': 'https://example.invalid/?token=SECRET'}}).ok, false,
    'a registered attribute never carries a URL or a token');
});
