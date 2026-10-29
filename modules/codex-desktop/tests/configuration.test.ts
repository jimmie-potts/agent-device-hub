// The Codex Desktop module's section and the cutover's conversion of the Hub's `codexDesktop` setting (Hub #926), with
// the Hub's own cases (apps/hub/tests/codex-desktop.test.mjs at main 8590332f).
import assert from 'node:assert/strict';
import {checkConfiguration} from '@jimmie-potts/sdk';
import {MAX_SOURCES, configureCodexDesktop, convertHubCodexDesktop, createCodexDesktopModule, remoteOnlySection, SimulatedMarker} from '../src/index.js';
import {it} from './support.js';

const VALID = {home: '/mnt/c/Users/person/.codex', hostId: 'host', sourceId: 'desktop'};

const LEGACY = {sources: [VALID], legacy: true};

it('the section is an absolute, normalized Codex home and the producer\'s neutral IDs, on a Windows mount or not', () => {
  assert.deepEqual(configureCodexDesktop(VALID), {config: LEGACY});
  assert.deepEqual(configureCodexDesktop({...VALID, home: '/home/person/.codex'}), {config: {sources: [{...VALID, home: '/home/person/.codex'}], legacy: true}});
  // The runtime's `secrets` member is the runtime's; the module reads none.
  assert.deepEqual(configureCodexDesktop({...VALID, secrets: {}}), {config: LEGACY});
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
  assert.deepEqual(checkConfiguration(module.manifest, VALID), {status: 'accepted', config: LEGACY, devices: [], secrets: new Map()});
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

it('the sources form names each producer once, read locally from its home or remotely without one (Hub #567)', () => {
  const remote = {hostId: 'pc', sourceId: 'desktop'};
  assert.deepEqual(configureCodexDesktop({sources: [remote]}), {config: {sources: [remote], legacy: false}});
  assert.deepEqual(configureCodexDesktop({sources: [VALID, remote], secrets: {}}), {config: {sources: [VALID, remote], legacy: false}});
  const four = configureCodexDesktop({sources: [{...remote, hostId: 'mac'}, remote, {...remote, sourceId: 'other'}, {...VALID, hostId: 'pc-2'}]});
  assert.equal('config' in four ? four.config.sources.length : four.error.detail, 4);
  for (const invalid of [
    {sources: []}, {sources: Array.from({length: MAX_SOURCES + 1}, (_, index) => ({...remote, hostId: `h${index}`}))}, {sources: {}}, {sources: [null]}, {sources: ['pc']},
    {sources: [{...remote, extra: true}]}, {sources: [{hostId: 'pc'}]}, {sources: [{...remote, home: 'relative/.codex'}]}, {sources: [{...remote, home: '/a/../b'}]},
    {sources: [{...remote, hostId: 'has space'}]}, {sources: [remote, {...remote, home: '/home/person/.codex'}]}, {sources: [remote, remote]},
    {...VALID, sources: [remote]}, {sources: [remote], hostId: 'pc'}, {sources: [remote], home: VALID.home},
  ]) {
    const answer = configureCodexDesktop(invalid);
    assert.ok('error' in answer, JSON.stringify(invalid));
    assert.equal(answer.error.code, 'invalid-request');
    for (const value of ['person', 'has space', 'relative', 'extra', 'pc']) assert.equal(answer.error.detail?.includes(value), false, answer.error.detail);
  }
  // Only a section without any home reaches no local file.
  assert.equal(remoteOnlySection({sources: [remote]}), true);
  assert.equal(remoteOnlySection({sources: [remote, {...remote, hostId: 'mac'}]}), true);
  assert.equal(remoteOnlySection({sources: [remote, VALID]}), false);
  assert.equal(remoteOnlySection(VALID), false);
  assert.equal(remoteOnlySection({sources: []}), false);
  // The settings show each source and how it is read, never a home; the released form shows as it did.
  const module = createCodexDesktopModule({transport: new SimulatedMarker()});
  assert.deepEqual(module.manifest.settings?.show({sources: [VALID, remote], legacy: false}), {sources: [{hostId: 'host', sourceId: 'desktop', remote: false}, {hostId: 'pc', sourceId: 'desktop', remote: true}]});
  assert.deepEqual(module.manifest.settings?.show({sources: [VALID], legacy: true}), {hostId: 'host', sourceId: 'desktop'});
  assert.equal(JSON.stringify(module.manifest.settings?.show({sources: [VALID, remote], legacy: false})).includes('person'), false);
  // The Hub's conversion keeps the released form only.
  const converted = convertHubCodexDesktop({codexDesktop: {sources: [remote]}});
  assert.ok(converted !== undefined && 'error' in converted);
});
