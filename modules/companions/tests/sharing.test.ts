import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bindCodingRequirements, codingRequirements} from '../src/assistant/coding-request.js';
import {accessFor, codingShareDestination, parseSharingGrants, sharing, supervisorFields} from '../src/assistant/sharing.js';

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
