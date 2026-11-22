// The one supported-source definition (Hub #1865, design decision 2): the `Identity` type and every schema enum that
// names a provider or a client derive from it, and this test fails when one of them differs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {Ajv2020} from 'ajv/dist/2020.js';
import {contractSchemas} from '../dist/v2/bookkeeping.js';
import {CLIENTS, HOOK_CLIENTS, HOOK_PROVIDERS, NATIVE_SOURCE, PROVIDERS, SUPPORTED_SOURCES, supportedHook, supportedSource} from '../dist/v2/sources.js';

const BASE = 'https://bunny.invalid/events/';
// The contract schemas, plus lifecycle/2.1, which an adopting owner registers separately (read-receipts.ts).
const schemas = {
  ...contractSchemas(),
  [`${BASE}lifecycle/2.1`]: JSON.parse(readFileSync(new URL('../schemas/v2/families/lifecycle.2.1.schema.json', import.meta.url), 'utf8')),
};
const sorted = values => [...values].sort();

// Every identity a schema of these families admits: the session records, which define it, and the lifecycle
// observations and agent occurrences, which refer to a session record's definition. The versions before the native
// source (Hub #505) name the hook sources only; `session/3.1`, `lifecycle/2.2` and `2.3` and the 2.1 occurrences name every source.
const IDENTITIES = [
  ['session/2.0', '#/$defs/identity', 'hook'],
  ['session/2.1', '#/$defs/identity', 'hook'],
  ['session/3.0', '#/$defs/identity', 'hook'],
  ['lifecycle/2.0', '#/properties/identity', 'hook'],
  ['lifecycle/2.1', '#/oneOf/1/properties/identity', 'hook'],
  ['session/2.0', '#/$defs/occurrence/properties/identity', 'hook'],
  ['session/3.1', '#/$defs/identity', 'all'],
  ['session/3.1', '#/$defs/occurrence/properties/identity', 'all'],
  ['lifecycle/2.2', '#/properties/identity', 'all'],
  ['lifecycle/2.3', '#/properties/identity', 'all'],
];
const OCCURRENCES = ['attention-raised', 'attention-cleared', 'turn-ended'];

/** The schema at `pointer` in the document `id`, following one `$ref` to another document's definition. */
function definition(id, pointer) {
  let document = schemas[`${BASE}${id}`];
  assert.ok(document, `${id} is a contract schema`);
  let node = pointer.slice(2).split('/').reduce((value, token) => value?.[token], document);
  if (typeof node?.$ref === 'string') {
    const [uri, fragment] = node.$ref.split('#');
    document = uri === '' ? document : schemas[uri];
    node = fragment.slice(1).split('/').reduce((value, token) => value?.[token], document);
  }
  return node;
}

test('the definition names each provider once, with its clients and the hooks it maps', () => {
  assert.deepEqual(sorted(PROVIDERS), ['bunny', 'claude', 'codex']);
  assert.deepEqual(sorted(CLIENTS), ['assistant', 'cli', 'code', 'desktop', 'local']);
  assert.deepEqual(sorted(HOOK_PROVIDERS), ['claude', 'codex']);
  assert.deepEqual(sorted(HOOK_CLIENTS), ['cli', 'code', 'desktop', 'local']);
  assert.deepEqual(SUPPORTED_SOURCES.codex.clients, ['cli', 'desktop', 'local']);
  assert.deepEqual(SUPPORTED_SOURCES.claude.clients, ['code']);
  // The native assistant (Hub #505) maps no hook: its one producer is the companions module.
  assert.deepEqual(SUPPORTED_SOURCES.bunny.clients, ['assistant']);
  assert.deepEqual(SUPPORTED_SOURCES.bunny.hooks, []);
  assert.deepEqual({...NATIVE_SOURCE}, {provider: 'bunny', client: 'assistant', hostId: 'core', sourceId: 'companions', producer: 'bunny/modules/companions'});
  assert.ok(Object.isFrozen(NATIVE_SOURCE));
  // Today's hook mapping (packages/agent-state/src/providers.ts): Interrupt is Codex's, tool results Claude's.
  assert.deepEqual(sorted(SUPPORTED_SOURCES.codex.hooks),
    ['Interrupt', 'PermissionRequest', 'SessionEnd', 'SessionStart', 'Stop', 'SubagentStart', 'SubagentStop', 'UserPromptSubmit']);
  assert.deepEqual(sorted(SUPPORTED_SOURCES.claude.hooks),
    ['PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'SessionEnd', 'SessionStart', 'Stop', 'SubagentStart', 'SubagentStop', 'UserPromptSubmit']);
  assert.ok(Object.isFrozen(SUPPORTED_SOURCES) && Object.values(SUPPORTED_SOURCES).every(source =>
    Object.isFrozen(source) && Object.isFrozen(source.clients) && Object.isFrozen(source.hooks)));
});

test('the source and hook checks follow the definition and nothing else', () => {
  for (const provider of [...PROVIDERS, 'gemini', '__proto__', 'constructor']) {
    for (const client of [...CLIENTS, 'web', 'toString']) {
      const expected = Object.hasOwn(SUPPORTED_SOURCES, provider) && SUPPORTED_SOURCES[provider].clients.includes(client);
      assert.equal(supportedSource(provider, client), expected, `${provider}/${client}`);
    }
  }
  assert.equal(supportedHook('codex', 'Interrupt'), true);
  assert.equal(supportedHook('claude', 'Interrupt'), false);
  assert.equal(supportedHook('claude', 'PostToolUse'), true);
  assert.equal(supportedHook('codex', 'PostToolUse'), false);
  assert.equal(supportedHook('gemini', 'Stop'), false);
  assert.equal(supportedHook('constructor', 'Stop'), false);
  for (const hook of [...SUPPORTED_SOURCES.codex.hooks, ...SUPPORTED_SOURCES.claude.hooks]) assert.equal(supportedHook('bunny', hook), false, `bunny ${hook}`);
});

test('every new occurrence version refers to the widened identity', () => {
  for (const family of OCCURRENCES) {
    assert.equal(schemas[`${BASE}${family}/2.1`].$ref, `${BASE}session/3.1#/$defs/occurrence`, family);
    assert.equal(schemas[`${BASE}${family}/2.0`].$ref, `${BASE}session/2.0#/$defs/occurrence`, family);
  }
});

test('every session and lifecycle schema enum names exactly the defined providers and clients', () => {
  for (const [id, pointer, sources] of IDENTITIES) {
    const identity = definition(id, pointer);
    assert.deepEqual(sorted(identity.properties.provider.enum), sorted(sources === 'all' ? PROVIDERS : HOOK_PROVIDERS), `${id} ${pointer}/properties/provider/enum`);
    assert.deepEqual(sorted(identity.properties.client.enum), sorted(sources === 'all' ? CLIENTS : HOOK_CLIENTS), `${id} ${pointer}/properties/client/enum`);
  }
});

test('every session and lifecycle schema admits exactly the defined provider and client pairs', () => {
  const ajv = new Ajv2020({strict: true});
  for (const schema of Object.values(schemas)) ajv.addSchema(schema);
  for (const [id, pointer, sources] of IDENTITIES) {
    const valid = ajv.compile({$ref: `${BASE}${id}${pointer}`});
    const named = provider => sources === 'all' || HOOK_PROVIDERS.includes(provider);
    for (const provider of [...PROVIDERS, 'gemini']) {
      for (const client of [...CLIENTS, 'web']) {
        // The native source has one host and source (Hub #505); every other source names its own.
        const native = provider === NATIVE_SOURCE.provider;
        const identity = {provider, client, hostId: native ? NATIVE_SOURCE.hostId : 'synthetic-host',
          sourceId: native ? NATIVE_SOURCE.sourceId : 'synthetic-source', sessionId: 'synthetic-session'};
        assert.equal(valid(identity), named(provider) && supportedSource(provider, client), `${id}: ${provider}/${client}`);
      }
    }
    if (sources === 'all') {
      assert.equal(valid({...NATIVE_SOURCE, producer: undefined, sessionId: 'task'}), false, `${id}: no extra member`);
      const {producer: _producer, ...native} = NATIVE_SOURCE;
      assert.equal(valid({...native, sessionId: 'task'}), true, `${id}: the native identity`);
      assert.equal(valid({...native, hostId: 'synthetic-host', sessionId: 'task'}), false, `${id}: another native host`);
      assert.equal(valid({...native, sourceId: 'synthetic-source', sessionId: 'task'}), false, `${id}: another native source`);
    }
  }
});
