// The Codex Desktop module's section and the cutover's conversion of the Hub's `codexDesktop` setting (Hub #926), with
// the Hub's own cases (apps/hub/tests/codex-desktop.test.mjs at main 8590332f).
import assert from 'node:assert/strict';
import {checkConfiguration} from '@jimmie-potts/sdk';
import {configureCodexDesktop, convertHubCodexDesktop, createCodexDesktopModule, SimulatedMarker} from '../src/index.js';
import {it} from './support.js';

const VALID = {home: '/mnt/c/Users/person/.codex', hostId: 'host', sourceId: 'desktop'};

it('the section is an absolute, normalized Codex home and the producer\'s neutral IDs, on a Windows mount or not', () => {
  assert.deepEqual(configureCodexDesktop(VALID), {config: VALID});
  assert.deepEqual(configureCodexDesktop({...VALID, home: '/home/person/.codex'}), {config: {...VALID, home: '/home/person/.codex'}});
  // The runtime's `secrets` member is the runtime's; the module reads none.
  assert.deepEqual(configureCodexDesktop({...VALID, secrets: {}}), {config: VALID});
  for (const invalid of [null, [], 'home', {...VALID, extra: true}, {hostId: 'host', sourceId: 'desktop'}, {...VALID, home: 'relative/.codex'}, {...VALID, home: '/a/../b'},
    {...VALID, home: '/a\0b'}, {...VALID, home: `/${'a'.repeat(1024)}`}, {...VALID, hostId: 'has space'}, {...VALID, sourceId: ''}, {...VALID, sourceId: 'x'.repeat(129)}]) {
    const answer = configureCodexDesktop(invalid);
    assert.ok('error' in answer, JSON.stringify(invalid));
    assert.equal(answer.error.code, 'invalid-request');
    // A refusal's detail is fixed text: it never repeats the section, which health shows.
    for (const value of ['person', 'has space', 'relative', 'extra']) assert.equal(answer.error.detail?.includes(value), false, answer.error.detail);
  }
});

it('the runtime admits the module with its section, and refuses it without one', () => {
  const module = createCodexDesktopModule({transport: new SimulatedMarker()});
  assert.deepEqual(checkConfiguration(module.manifest, VALID), {status: 'accepted', config: VALID, devices: [], secrets: new Map()});
  const missing = checkConfiguration(module.manifest, undefined);
  assert.equal(missing.status === 'refused' ? missing.problem.code : missing.status, 'not-found');
});

it('the cutover converts the Hub\'s codexDesktop setting as it is, and a Hub without one leaves the module unconfigured', () => {
  assert.deepEqual(convertHubCodexDesktop({ownerId: 'owner', consumers: [], codexDesktop: VALID}), {section: VALID});
  assert.equal(convertHubCodexDesktop({ownerId: 'owner', consumers: []}), undefined);
  for (const invalid of [null, 'hub', {codexDesktop: {...VALID, home: 'relative'}}, {codexDesktop: {...VALID, secrets: {}}}, {codexDesktop: []}]) {
    const answer = convertHubCodexDesktop(invalid);
    assert.ok(answer !== undefined && 'error' in answer, JSON.stringify(invalid));
    assert.equal(answer.error.code, 'invalid-request');
  }
});
