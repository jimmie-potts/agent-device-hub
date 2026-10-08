// Profile 1.2 (Hub #903) registers the B.U.N.N.Y. runtime: its service, its two scopes, its events and attributes.
// Profile 1.3 (Hub #949) adds the runtime's decision records, the outbox's and a device's records, and two span names.
// Profile 1.4 (Hub #835) adds the gateway's route and method to the edge's refusal records, and the credentials reload.
// Profile 1.5 (Hub #976) adds a store's costly saves: the state block's size and one save's time.
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
/**
 * Profile 1.0's vocabulary, pinned here: each later profile is the one before plus its `additions`, so a name the catalog
 * registers without listing it as an addition fails this test instead of silently joining every profile.
 */
const PROFILE_1_0 = {
  services: ['hub', 'hub-dashboard', 'local-controllers', 'tidbyt', 'lifx', 'pixoo', 'pixoo-web', 'pixoo-media-worker', 'nanoleaf-controller',
    'nanoleaf-worker', 'nanoleaf-wall', 'nanoleaf-wall-ui', 'nanoleaf-mcp', 'bunny-tool'],
  scopes: ['bunny.host', 'bunny.http', 'bunny.mcp', 'bunny.state', 'bunny.provider', 'bunny.controller', 'bunny.queue', 'bunny.status', 'bunny.feed',
    'bunny.automation', 'bunny.playback', 'bunny.media', 'bunny.storage', 'bunny.browser', 'bunny.helper', 'bunny.verification', 'bunny.telemetry'],
  events: ['process.started', 'process.stopped', 'process.failed', 'command.admitted', 'command.rejected', 'command.queued', 'command.executing',
    'command.completed', 'command.cancelled', 'lifecycle.observed', 'feed.changed', 'operation.completed', 'operation.failed', 'telemetry.dropped'],
  attributes: ['bunny.controller.id', 'bunny.device.id', 'bunny.source.id', 'bunny.request.id', 'bunny.ticket.epoch', 'bunny.operation.id',
    'bunny.task.epoch', 'bunny.effect.epoch', 'bunny.clock.epoch', 'bunny.ticket.sequence', 'bunny.state.revision', 'bunny.source.revision',
    'bunny.generation', 'bunny.telemetry.dropped_count', 'bunny.telemetry.failure_count', 'bunny.duration_ms', 'bunny.queue.wait_ms',
    'bunny.execution.duration_ms', 'bunny.operation', 'bunny.outcome', 'bunny.reason', 'bunny.provenance', 'bunny.observed.service',
    'bunny.write.possible', 'bunny.build.revision'],
  span_names: ['bunny.command.request', 'bunny.command.queue', 'bunny.command.execute', 'bunny.lifecycle.observe', 'bunny.feed.read',
    'bunny.process.start', 'bunny.helper.run'],
};
const KINDS = ['services', 'scopes', 'events', 'attributes', 'span_names'];
/** Each profile's vocabulary: profile 1.0's, then each later profile's additions on top of the one before. */
function profiles() {
  const result = {'1.0': PROFILE_1_0};
  for (const [index, version] of versions.entries()) {
    if (index === 0) continue;
    const previous = result[versions[index - 1]], addition = catalog.additions[version] ?? {};
    result[version] = Object.fromEntries(KINDS.map(kind => [kind, [...previous[kind], ...(addition[kind] ?? [])]]));
  }
  return result;
}
/** A valid value for each attribute that a profile after 1.0 adds. Adding an attribute needs an example here. */
const examples = {
  'bunny.queue.depth': 2,
  'bunny.module': 'lamp',
  'bunny.participant': 'bunny/modules/lamp',
  'bunny.pattern': 'bunny.event.*.*',
  'bunny.code': 'internal',
  'bunny.phase': 'handler',
  'bunny.module_count': 2,
  'bunny.timeout_ms': 5000,
  'bunny.exit_code': 1,
  'bunny.lag.duration_ms': 10250,
  'bunny.lag.limit_ms': 10000,
  'bunny.delivery.dropped_count': 3,
  'bunny.message.id': '6f1c2d4e-8a9b-4c3d-9e2f-0a1b2c3d4e5f',
  'bunny.message.kind': 'outcome',
  'bunny.outbox.republished_count': 3,
  'bunny.simulate': true,
  'bunny.edge': true,
  'bunny.grant_count': 1,
  'bunny.route': 'stream',
  'server.port': 41000,
  'error.type': 'RuntimeError',
  'error.code': 'state-dir-relative',
  'bunny.routing.key': 'bunny.cmd.lamp.lamp-1',
  'bunny.outbox.waiting_count': 3,
  'bunny.attempt_count': 12,
  'http.route': '/api/v2/families/{family}',
  'http.request.method': 'GET',
  'bunny.state.bytes': 8_388_609,
  'bunny.save.duration_ms': 150,
};
const valid = value => validateRecord(value).ok;
const at = (value, version) => ({...value, schema_version: version});

test('artifact 1.5.0 adds profile 1.5, and producers still default to profile 1.1', () => {
  assert.equal(ARTIFACT_VERSION, '1.5.0');
  assert.equal(catalog.artifact_version, '1.5.0');
  assert.deepEqual(versions, ['1.0', '1.1', '1.2', '1.3', '1.4', '1.5']);
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

test('the catalog registers exactly profile 1.0\'s vocabulary plus each later profile\'s additions', () => {
  const latest = profiles()[versions.at(-1)];
  const registered = {services: catalog.services, scopes: catalog.scopes, events: Object.keys(catalog.events), attributes: Object.keys(catalog.attributes),
    span_names: catalog.span_names};
  for (const kind of KINDS) {
    assert.deepEqual([...registered[kind]].sort(), [...latest[kind]].sort(), `${kind}: every name after profile 1.0 is some profile's addition`);
    assert.equal(new Set(latest[kind]).size, latest[kind].length, `${kind}: no name is added twice`);
  }
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
  const latest = versions.at(-1);
  for (const name of runtimeEvents) {
    const record = {...at(runtime, latest), event_name: name, body: catalog.events[name]};
    assert.equal(valid(record), true, name);
    assert.equal(valid({...record, scope: module.scope, attributes: module.attributes}), false, `${name} under bunny.module`);
    assert.equal(valid({...record, scope: hub.scope}), false, `${name} under ${hub.scope.name}`);
  }
  for (const name of moduleEvents) {
    const record = {...at(module, latest), event_name: name, body: catalog.events[name]};
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
  assert.equal(projectRecord(hub, '1.6').ok, false);
});

test('a profile 1.3 record projects to 1.2 only without 1.3 vocabulary, and a 1.2 record projects to 1.3', () => {
  const decided = {...runtime, schema_version: '1.3', event_name: 'runtime.command.refused', body: catalog.events['runtime.command.refused'],
    severity_text: 'WARN', severity_number: 13,
    attributes: {'bunny.provenance': 'source', 'bunny.routing.key': 'bunny.cmd.lamp.lamp-1', 'bunny.code': 'unavailable', 'bunny.reason': 'unavailable'}};
  assert.equal(valid(decided), true);
  assert.equal(projectRecord(decided, '1.2').ok, false);
  assert.equal(valid(at(decided, '1.2')), false, 'a 1.3 record labeled 1.2');
  const raised = projectRecord(runtime, '1.3');
  assert.equal(raised.ok, true);
  assert.equal(raised.value.schema_version, '1.3');
  assert.equal(projectRecord(at(runtime, '1.3'), '1.2').value.schema_version, '1.2');
});

test('profile 1.3 keeps the request ID\'s profile 1.0 pattern and bounds its own attributes', () => {
  const check = (attributes, version = '1.3') => valid({...module, schema_version: version, attributes: {...module.attributes, ...attributes}});
  assert.equal(check({'bunny.request.id': 'req-1'}), true);
  assert.equal(check({'bunny.request.id': '_leading'}), false, 'a 2.0 requestId with a leading underscore is not a 1.x request ID');
  assert.equal(check({'bunny.routing.key': 'bunny.cmd.lamp.*'}), false, 'a routing key is never a pattern');
  assert.equal(check({'bunny.routing.key': 'http://192.0.2.7/?token=tok_SYNTHETIC123'}), false);
  assert.equal(check({'bunny.routing.key': `bunny.cmd.lamp.${'a'.repeat(600)}`}), false, 'at most 512 characters');
  assert.equal(check({'bunny.outbox.waiting_count': -1}), false);
  assert.equal(check({'bunny.attempt_count': 1.5}), false);
  assert.ok(catalog.span_names.includes('bunny.outcome.publish') && catalog.span_names.includes('bunny.device.call'));
});

test('profile 1.4 names a gateway route by its template and method, never a path\'s values or a URL', () => {
  const refused = {...runtime, schema_version: '1.4', event_name: 'runtime.edge.refused', body: catalog.events['runtime.edge.refused'],
    attributes: {'bunny.provenance': 'source', 'bunny.route': 'other', 'http.route': '/api/monitor/v1/sessions', 'http.request.method': 'GET', 'bunny.code': 'not-found'}};
  const check = attributes => valid({...refused, attributes: {...refused.attributes, ...attributes}});
  assert.equal(valid(refused), true);
  assert.equal(check({'http.route': '/api/controllers/v1/{device}/integration/catalog/*'}), true);
  assert.equal(check({'http.route': '/api/v2/families/session?token=tok_SYNTHETIC123'}), false, 'no query');
  assert.equal(check({'http.route': 'http://127.0.0.1:8788/mcp'}), false, 'no URL');
  assert.equal(check({'http.route': `/${'a'.repeat(300)}`}), false, 'at most 256 characters');
  assert.equal(check({'http.request.method': 'TRACE'}), false);
  assert.equal(projectRecord(refused, '1.3').ok, false, 'the route is profile 1.4 vocabulary');
  const reloaded = {...refused, event_name: 'runtime.edge.reloaded', body: catalog.events['runtime.edge.reloaded'],
    attributes: {'bunny.provenance': 'source', 'bunny.outcome': 'succeeded', 'bunny.grant_count': 2}};
  assert.equal(valid(reloaded), true);
  assert.equal(valid(at(reloaded, '1.3')), false);
});

test('profile 1.5 records a costly save with only the state block\'s size or the save\'s time', () => {
  const costly = {...module, schema_version: '1.5', event_name: 'storage.cost.high', body: catalog.events['storage.cost.high'], severity_text: 'WARN',
    severity_number: 13, attributes: {'bunny.provenance': 'source', 'bunny.module': 'core', 'bunny.operation': 'storage', 'bunny.state.bytes': 8_388_609}};
  const check = (attributes, record = costly) => valid({...record, attributes: {...record.attributes, ...attributes}});
  assert.equal(valid(costly), true);
  assert.equal(check({'bunny.state.bytes': 16_777_216}), true);
  assert.equal(check({'bunny.state.bytes': 1.5}), false, 'a size is whole bytes');
  assert.equal(check({'bunny.state.bytes': -1}), false);
  assert.equal(check({'bunny.state.bytes': '{"sessions":[]}'}), false, 'never the state itself');
  const slow = {...costly, attributes: {'bunny.provenance': 'source', 'bunny.module': 'core', 'bunny.operation': 'storage', 'bunny.save.duration_ms': 150}};
  assert.equal(valid(slow), true);
  assert.equal(check({'bunny.save.duration_ms': 86_400_001}, slow), false, 'at most a day');
  assert.equal(check({'bunny.save.duration_ms': -1}, slow), false);
  const normal = {...slow, event_name: 'storage.cost.normal', body: catalog.events['storage.cost.normal'], severity_text: 'INFO', severity_number: 9};
  assert.equal(valid(normal), true);
  assert.equal(valid({...normal, scope: runtime.scope}), false, 'a module\'s record, never the runtime\'s own');
  for (const record of [costly, slow, normal]) {
    assert.equal(valid(at(record, '1.4')), false, `${record.event_name} labeled 1.4`);
    assert.equal(projectRecord(record, '1.4').ok, false, 'the save\'s cost is profile 1.5 vocabulary');
  }
  assert.equal(projectRecord(at(module, '1.4'), '1.5').value.schema_version, '1.5', 'a 1.4 record projects to 1.5');
});

test('construction keeps only the attributes the record\'s own profile registers', () => {
  const later = {...hub.attributes, 'error.type': 'TypeError', 'bunny.queue.depth': 2};
  const defaulted = {...hub, attributes: later};
  delete defaulted.schema_version;
  const built = createRecord(defaulted);
  assert.equal(built.ok, true, 'a default profile 1.1 record leaves out a profile 1.2 attribute rather than fail');
  assert.equal(built.value.schema_version, '1.1');
  assert.deepEqual(built.value.attributes, {'bunny.provenance': 'source', 'bunny.queue.depth': 2});
  assert.deepEqual(createRecord(at({...hub, attributes: later}, '1.0')).value.attributes, {'bunny.provenance': 'source'});
  assert.deepEqual(createRecord(at({...hub, attributes: later}, '1.2')).value.attributes, later);
});

test('construction keeps an explicit profile 1.2 and discards what the catalog does not register', () => {
  const built = createRecord({...module, attributes: {...module.attributes, 'error.message': 'SECRET token=abc', detail: 'SECRET'}});
  assert.equal(built.ok, true);
  assert.equal(built.value.schema_version, '1.2');
  assert.equal(JSON.stringify(built.value).includes('SECRET'), false);
  assert.equal(validateRecord({...module, attributes: {...module.attributes, 'error.message': 'SECRET'}}).ok, false);
  assert.equal(createRecord({...module, attributes: {...module.attributes, 'bunny.participant': 'https://example.invalid/?token=SECRET'}}).ok, false,
    'a registered attribute never carries a URL or a token');
});
