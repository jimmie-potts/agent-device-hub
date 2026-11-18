// The one supported-source definition (Hub #1865, design decision 2): the `Identity` type and every schema enum that
// names a provider or a client derive from it, and this test fails when one of them differs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {Ajv2020} from 'ajv/dist/2020.js';
import {contractSchemas} from '../dist/v2/bookkeeping.js';
import {CLIENTS, PROVIDERS, SUPPORTED_SOURCES, supportedHook, supportedSource} from '../dist/v2/sources.js';

const BASE = 'https://bunny.invalid/events/';
// The contract schemas, plus lifecycle/2.1, which an adopting owner registers separately (read-receipts.ts).
const schemas = {
  ...contractSchemas(),
  [`${BASE}lifecycle/2.1`]: JSON.parse(readFileSync(new URL('../schemas/v2/families/lifecycle.2.1.schema.json', import.meta.url), 'utf8')),
};
const sorted = values => [...values].sort();

// Every identity a schema of these families admits: the session records, which define it, and the lifecycle
// observations, which refer to the session record's definition.
const IDENTITIES = [
  ['session/2.0', '#/$defs/identity'],
  ['session/2.1', '#/$defs/identity'],
  ['session/3.0', '#/$defs/identity'],
  ['lifecycle/2.0', '#/properties/identity'],
  ['lifecycle/2.1', '#/oneOf/1/properties/identity'],
];

/** The schema at `pointer` in the document `id`, following one `$ref` to another document's definition. */
function definition(id, pointer) {
  let document = schemas[`${BASE}${id}`];
  assert.ok(document, `${id} is a contract schema`);
  let node = pointer.slice(2).split('/').reduce((value, token) => value?.[token], document);
  if (typeof node?.$ref === 'string') {
    const [uri, fragment] = node.$ref.split('#');
    document = schemas[uri];
    node = fragment.slice(1).split('/').reduce((value, token) => value?.[token], document);
  }
  return node;
}

test('the definition names each provider once, with its clients and the hooks it maps', () => {
  assert.deepEqual(sorted(PROVIDERS), ['claude', 'codex']);
  assert.deepEqual(sorted(CLIENTS), ['cli', 'code', 'desktop', 'local']);
  assert.deepEqual(SUPPORTED_SOURCES.codex.clients, ['cli', 'desktop', 'local']);
  assert.deepEqual(SUPPORTED_SOURCES.claude.clients, ['code']);
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
});

test('every session and lifecycle schema enum names exactly the defined providers and clients', () => {
  for (const [id, pointer] of IDENTITIES) {
    const identity = definition(id, pointer);
    assert.deepEqual(sorted(identity.properties.provider.enum), sorted(PROVIDERS), `${id} ${pointer}/properties/provider/enum`);
    assert.deepEqual(sorted(identity.properties.client.enum), sorted(CLIENTS), `${id} ${pointer}/properties/client/enum`);
  }
});

test('every session and lifecycle schema admits exactly the defined provider and client pairs', () => {
  const ajv = new Ajv2020({strict: true});
  for (const schema of Object.values(schemas)) ajv.addSchema(schema);
  for (const [id, pointer] of IDENTITIES) {
    const valid = ajv.compile({$ref: `${BASE}${id}${pointer}`});
    for (const provider of [...PROVIDERS, 'gemini']) {
      for (const client of [...CLIENTS, 'web']) {
        const identity = {provider, client, hostId: 'synthetic-host', sourceId: 'synthetic-source', sessionId: 'synthetic-session'};
        assert.equal(valid(identity), supportedSource(provider, client), `${id}: ${provider}/${client}`);
      }
    }
  }
});
