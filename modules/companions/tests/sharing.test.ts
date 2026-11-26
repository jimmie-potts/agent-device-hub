import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bindCodingRequirements, codingRequirements} from '../src/assistant/coding-request.js';
import {accessFor, codingShareDestination, parseSharingGrants, recordedSupervisorField, sharing, supervisorFields} from '../src/assistant/sharing.js';

void test('the supervisor receives only selected current and same-conversation fields', () => {
  const messages = new Map([
    ['same', {conversationId: 'current'}],
    ['other', {conversationId: 'other-conversation'}],
  ]);
  for (const companion of ['bunny', 'reachy', 'microduck'] as const) {
    const scope = {companion, conversationId: 'current', requestId: 'owner-request', messages, devices: new Set(['plug', 'other-plug']),
      requestedHistory: new Set(['plug'])};
    const retrieve = supervisorFields(undefined, {...scope, purpose: 'supervisor'});
    assert.equal(retrieve('conversation', 'request', 'owner-request'), true);
    assert.equal(retrieve('conversation', 'request', 'same'), false);
    assert.equal(retrieve('conversation', 'excerpt', 'same'), true);
    assert.equal(retrieve('conversation', 'excerpt', 'other'), false);
    assert.equal(retrieve('conversation', 'label', 'same'), false);
    assert.equal(retrieve('conversation', 'index', 'same'), false);
    assert.equal(retrieve('artwork', 'attachment', 'same'), false);
    assert.equal(retrieve('coding', 'brief', 'same'), false);
    assert.equal(retrieve('sessions', 'details', 'plug'), false);
    assert.equal(retrieve('devices', 'summary', 'plug'), true);
    assert.equal(retrieve('devices', 'summary', 'other-plug'), false);
    assert.equal(retrieve('devices', 'status', 'unrelated'), false);
    assert.equal(retrieve('devices', 'details', 'plug'), false);
    const title = supervisorFields(undefined, {...scope, purpose: 'title'});
    assert.equal(title('conversation', 'excerpt', 'same'), true);
    assert.equal(title('devices', 'summary', 'plug'), false);
    assert.equal(title('conversation', 'label', 'same'), false);
  }
});

void test('revocations survive rebuilding policy and a different caller or purpose conveys no worker share', () => {
  const stored = JSON.stringify([{caller: 'companion', companion: 'bunny', destination: 'openai-supervisor', purpose: 'supervisor',
    source: 'conversation', field: 'excerpt', record: 'deny', allow: false},
  {caller: 'owner', companion: 'bunny', destination: 'coding-worker', purpose: 'brief', source: 'devices', field: 'details', record: 'plug', allow: true}]);
  const grants = parseSharingGrants(JSON.parse(stored));
  assert.ok(grants);
  const policy = sharing(grants);
  const read = supervisorFields(policy, {companion: 'bunny', conversationId: 'current', requestId: 'request', purpose: 'supervisor',
    messages: new Map([['deny', {conversationId: 'current'}], ['allow', {conversationId: 'current'}]]), devices: new Set()});
  assert.equal(read('conversation', 'excerpt', 'allow'), true);
  assert.equal(read('conversation', 'excerpt', 'deny'), false);
  assert.equal(accessFor(policy, {caller: 'companion', companion: 'bunny', destination: 'coding-worker', purpose: 'brief'})('coding', 'brief'), false);
  const worker = accessFor(policy, {caller: 'owner', companion: 'bunny', destination: 'coding-worker', purpose: 'brief'});
  assert.equal(worker('coding', 'brief', 'repo'), true);
  assert.equal(worker('coding', 'details', 'repo'), false);
  assert.equal(worker('devices', 'details', 'plug'), false);
});

void test('a remote coding grant belongs to the exact destination and field', () => {
  const grants = parseSharingGrants([
    {caller: 'owner', companion: 'bunny', purpose: 'brief', destination: 'coding-worker:cloud-fixture',
      source: 'coding', field: 'brief', record: 'fixture-repo', allow: true},
    {caller: 'owner', companion: 'bunny', purpose: 'brief', destination: 'coding-worker:pc',
      source: 'sessions', field: 'label', allow: true},
    {caller: 'owner', companion: 'bunny', purpose: 'brief', destination: 'coding-worker:pc',
      source: 'sessions', field: 'label', record: 'hidden-session', allow: false},
  ]);
  assert.ok(grants);
  const policy = sharing(grants);
  const fields = (destination: Parameters<typeof codingShareDestination>[0]) =>
    accessFor(policy, {caller: 'owner', companion: 'bunny', purpose: 'brief', destination: codingShareDestination(destination)});
  assert.equal(fields('mac')('coding', 'brief', 'fixture-repo'), true, 'the installed Mac keeps the original grant');
  assert.equal(fields('pc')('coding', 'brief', 'fixture-repo'), false);
  assert.equal(fields('cloud-fixture')('coding', 'brief', 'fixture-repo'), true);
  assert.equal(fields('cloud-fixture')('coding', 'repository', 'fixture-repo'), false);
  assert.equal(fields('cloud-other')('coding', 'brief', 'fixture-repo'), false);
  assert.equal(fields('pc')('sessions', 'label', 'visible-session'), true);
  assert.equal(fields('pc')('sessions', 'label', 'hidden-session'), false);
});

void test('trusted coding requirements constrain owner input without granting resources', () => {
  const installation = {kind: 'installation', id: 'runtime/upgrade'} as const;
  assert.equal(codingRequirements({resource: installation, os: 'macos', testSlots: 2}), true);
  assert.equal(codingRequirements({resource: {...installation, destinations: ['mac']}}), false);
  assert.equal(codingRequirements({refusal: 'unknown-resource'}), false);
  assert.equal(codingRequirements({refusal: 'unknown-resource'}, true), true);
  assert.deepEqual(bindCodingRequirements({os: 'windows', toolchains: ['node-24'], testSlots: 1},
    {os: 'macos', resource: installation, toolchains: ['python-3.14'], testSlots: 2}),
  {os: 'macos', resource: installation, toolchains: ['node-24', 'python-3.14'], testSlots: 2, refusal: 'conflicting-platform'});
});

void test('a common external grant honors legacy provider denials and preserves the original configuration', () => {
  const original = [
    {caller: 'companion', companion: 'bunny', destination: 'anthropic', purpose: 'prompt',
      source: 'conversation', field: 'text', record: 'thread', allow: false},
    {caller: 'companion', companion: 'bunny', destination: 'openai-supervisor', purpose: 'supervisor',
      source: 'conversation', field: 'request', allow: true},
    {caller: 'companion', companion: 'bunny', destination: 'anthropic', purpose: 'read',
      source: 'devices', field: 'details', record: 'plug', allow: false},
    {caller: 'companion', companion: 'bunny', destination: 'openai-supervisor', purpose: 'supervisor',
      source: 'devices', field: 'summary', record: 'plug', allow: true},
  ];
  const raw = JSON.stringify(original);
  const grants = parseSharingGrants(original);
  assert.ok(grants);
  const policy = sharing(grants);
  const scope = {companion: 'bunny', conversationId: 'thread', requestId: 'request', purpose: 'supervisor',
    messages: new Map([['same', {conversationId: 'thread'}]]), devices: new Set(['plug']),
    requestedHistory: new Set(['plug'])} as const;
  const read = supervisorFields(policy, scope);
  assert.equal(read('conversation', 'request', 'request'), false);
  assert.equal(read('conversation', 'excerpt', 'same'), false);
  assert.equal(read('devices', 'summary', 'plug'), false);
  assert.equal(read('devices', 'label', 'plug'), true);
  assert.equal(supervisorFields(policy, {...scope, purpose: 'title'})('conversation', 'excerpt', 'same'), true);
  assert.equal(policy.conflicts, 2);
  assert.equal(JSON.stringify(original), raw);
  assert.deepEqual(grants, JSON.parse(raw));
});

void test('absent and matching provider grants permit the same bounded fields', () => {
  const scope = {companion: 'bunny', conversationId: 'current', requestId: 'request', purpose: 'supervisor',
    messages: new Map([['same', {conversationId: 'current'}]]), devices: new Set(['plug'])} as const;
  const matching = [
    {caller: 'companion', companion: 'bunny', destination: 'anthropic', purpose: 'prompt',
      source: 'conversation', field: 'text', record: 'same', allow: true},
    {caller: 'companion', companion: 'bunny', destination: 'openai-supervisor', purpose: 'supervisor',
      source: 'conversation', field: 'excerpt', record: 'same', allow: true},
  ];
  for (const raw of [undefined, [], matching]) {
    const grants = parseSharingGrants(raw);
    assert.ok(grants);
    const policy = sharing(grants);
    const read = supervisorFields(policy, scope);
    assert.equal(read('conversation', 'request', 'request'), true);
    assert.equal(read('conversation', 'excerpt', 'same'), true);
    assert.equal(read('devices', 'index', 'plug'), true);
    assert.equal(read('devices', 'summary', 'plug'), false);
    assert.equal(read('devices', 'details', 'plug'), false);
    assert.equal(policy.conflicts, 0);
  }
});

void test('a canonical denial applies to an already selected field and is confined to its purpose', () => {
  const grants = parseSharingGrants([{caller: 'companion', companion: 'bunny', destination: 'external-model', purpose: 'title',
    source: 'conversation', field: 'excerpt', record: 'same', allow: false}]);
  assert.ok(grants);
  const policy = sharing(grants);
  const scope = {companion: 'bunny', conversationId: 'current', requestId: 'request',
    messages: new Map([['same', {conversationId: 'current'}]]), devices: new Set<string>()} as const;
  assert.equal(supervisorFields(policy, {...scope, purpose: 'title'})('conversation', 'excerpt', 'same'), false);
  assert.equal(recordedSupervisorField(policy, 'bunny', 'title', 'conversation', 'excerpt', 'same'), false);
  assert.equal(supervisorFields(policy, {...scope, purpose: 'supervisor'})('conversation', 'excerpt', 'same'), true);
});

void test('detailed historical evidence requires an explicit owner request for the selected history target', () => {
  const explicit = {caller: 'companion', companion: 'bunny', destination: 'external-model', purpose: 'supervisor',
    source: 'devices', field: 'details', record: 'plug', allow: true} as const;
  const legacy = {...explicit, destination: 'anthropic', purpose: 'read'} as const;
  const scope = {companion: 'bunny', conversationId: 'current', requestId: 'request', purpose: 'supervisor',
    messages: new Map(), devices: new Set(['plug', 'other-plug']), requestedHistory: new Set(['plug'])} as const;
  const withLegacy = sharing([legacy]);
  assert.equal(supervisorFields(withLegacy, scope)('devices', 'details', 'plug'), false);
  assert.equal(withLegacy.conflicts, 1);
  const allowed = sharing([explicit]);
  assert.equal(supervisorFields(allowed, scope)('devices', 'details', 'plug'), false);
  const evidence = {...scope, requestedHistoryDetails: new Set(['plug'])};
  assert.equal(supervisorFields(sharing(), evidence)('devices', 'details', 'plug'), true);
  assert.equal(supervisorFields(allowed, evidence)('devices', 'details', 'plug'), true);
  assert.equal(supervisorFields(allowed, evidence)('devices', 'details', 'other-plug'), false);
  assert.equal(supervisorFields(allowed, {...evidence, requestedHistoryDetails: new Set()})('devices', 'details', 'plug'), false);
  const revoked = sharing([explicit, {...legacy, allow: false}]);
  assert.equal(supervisorFields(revoked, evidence)('devices', 'details', 'plug'), false);
  assert.equal(revoked.conflicts, 1);
});

void test('approved auxiliary prompts require common permission for each field', () => {
  const scope = {caller: 'companion', companion: 'bunny', destination: 'external-model', purpose: 'prompt'} as const;
  const text = {...scope, source: 'preferences', field: 'text', record: 'note', allow: true} as const;
  const label = {...text, field: 'label'} as const;
  const legacy = {...text, destination: 'anthropic'} as const;
  const old = sharing([legacy]);
  assert.equal(accessFor(old, scope)('preferences', 'text', 'note'), false);
  assert.equal(old.conflicts, 1);
  const explicit = sharing([text, label]);
  const read = accessFor(explicit, scope);
  assert.equal(read('preferences', 'text', 'note'), true);
  assert.equal(read('preferences', 'label', 'note'), true);
  assert.equal(read('preferences', 'text', 'other'), false);
  assert.equal(read('knowledge', 'text', 'note'), false);
  assert.equal(accessFor(explicit, {...scope, purpose: 'title'})('preferences', 'text', 'note'), false);
  const denied = sharing([text, label, {...legacy, allow: false}]);
  assert.equal(accessFor(denied, scope)('preferences', 'text', 'note'), false);
  assert.equal(accessFor(denied, scope)('preferences', 'label', 'note'), true);
  assert.equal(denied.conflicts, 1);
});
