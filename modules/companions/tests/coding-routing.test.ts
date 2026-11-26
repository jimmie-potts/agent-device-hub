import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {CodingHarnessReadiness, CodingLimitWindow} from '@jimmie-potts/event-contracts/v2/coding';
import {chooseCodingHarness} from '../src/coding/routing.js';

const health = (harness: string, limits: CodingLimitWindow[] | null = null): CodingHarnessReadiness => ({
  harness, installed: 'yes', signedIn: 'yes', version: '1.0', plan: 'plus', limits, limitsObservedAtMs: null, checkedAtMs: 1,
  capabilities: {steering: 'unsupported', resume: 'unsupported', review: true},
});
const exhausted = (resetsAtMs: number | null): CodingLimitWindow[] => [{window: 'primary', status: 'rejected', resetsAtMs, utilization: null}];

void test('Auto preserves the uncertainty of quotas and uses the other eligible subscription', () => {
  assert.deepEqual(chooseCodingHarness('auto', [health('claude-code', exhausted(null)), health('codex')], 100),
    {harness: 'codex', reason: 'Claude Code quota exhausted (reset unknown). Codex quota unknown.'});
  assert.deepEqual(chooseCodingHarness('auto', [health('claude-code'), health('codex', exhausted(200))], 100),
    {harness: 'claude-code', reason: 'Preferred Claude Code selected. Claude Code quota unknown.'});
  assert.match(chooseCodingHarness('auto', [health('claude-code', exhausted(null)), health('codex', exhausted(200))], 100).reason,
    /Claude Code quota exhausted \(reset unknown\).*Codex quota exhausted/);
});

void test('pinning a harness never falls back and an elapsed reset does not assert quota availability', () => {
  assert.deepEqual(chooseCodingHarness('codex', [health('claude-code')], 100), {reason: 'Codex is not advertised.'});
  assert.deepEqual(chooseCodingHarness('claude-code', [health('claude-code', exhausted(50)), health('codex')], 100),
    {harness: 'claude-code', reason: 'Claude Code selected explicitly. Claude Code quota unknown.'});
});

void test('route a test by destination grant, exact revision, platform, test slots and pressure', async () => {
  const {selectCodingWorker} = await import('../src/coding/routing.js');
  const revision = 'a'.repeat(40);
  const make = (destination: 'mac' | 'pc', pressure: 'high' | 'normal', testSlots: number) => ({
    destination, endpointId: destination, selectionId: destination, receivedAt: 100, running: 0,
    harnesses: [health('codex')], declaration: {os: destination === 'mac' ? 'macos' as const : 'windows' as const,
      repositories: [{name: 'sample', revision}], toolchains: ['node24'], pressure, testSlots},
  });
  const mac = make('mac', 'high', 2), pc = make('pc', 'normal', 8);
  const request = {choice: 'codex' as const, destination: 'auto' as const, repository: 'sample',
    requirements: {revision, toolchains: ['node24'], testSlots: 2 as const}, now: 100, allowed: () => true};
  assert.equal(selectCodingWorker([mac, pc], request).worker?.destination, 'pc');
  assert.equal(selectCodingWorker([make('mac', 'normal', 5), make('pc', 'high', 8)], request).worker?.destination, 'mac');
  assert.equal(selectCodingWorker([mac, pc], {...request, requirements: {os: 'windows'}}).worker?.destination, 'pc');
  const legacyMac = {destination: mac.destination, endpointId: mac.endpointId, receivedAt: mac.receivedAt, running: mac.running, harnesses: mac.harnesses};
  assert.equal(selectCodingWorker([legacyMac], {...request, requirements: {standardTests: true}}).worker?.destination, 'mac');
  assert.equal(selectCodingWorker([legacyMac], {...request, requirements: {testSlots: 1}}).worker, undefined);
  assert.equal(selectCodingWorker([legacyMac], {...request, requirements: {os: 'macos'}}).worker, undefined);
  assert.equal(selectCodingWorker([make('mac', 'normal', 0), pc], {...request, requirements: {standardTests: true}}).worker?.destination, 'pc');
  const conflict = selectCodingWorker([mac, pc], {...request, destination: 'pc', allowed: worker => worker === 'mac'});
  assert.equal(conflict.worker, undefined);
  assert.match(conflict.reason, /permission.*mac/iu);
  assert.equal(selectCodingWorker([mac, pc], {...request, destination: 'cloud'}).worker, undefined);
  assert.equal(selectCodingWorker([mac, pc], {...request, requirements: {revision: 'b'.repeat(40)}}).worker, undefined);
  const otherRevision = {...pc, declaration: {...pc.declaration, repositories:[{name:'sample', revision:'b'.repeat(40)}]}};
  assert.match(selectCodingWorker([mac,otherRevision],{...request,requirements:{}}).reason,/different repository revisions/);
  assert.equal(selectCodingWorker([mac,otherRevision],request).worker?.destination,'mac');
});

void test('resource eligibility comes from exact trusted step policy and preserves host-specific test limits', async () => {
  const {selectCodingWorker, CODING_DECLARATION_TTL_MS} = await import('../src/coding/routing.js');
  const {codingResourceGrants} = await import('../src/coding/resource-policy.js');
  const revision = 'e'.repeat(40), now = 1000;
  const candidate = (destination: 'pc' | 'mac' | 'cloud-fixture') => ({destination, endpointId: destination, selectionId: destination,
    receivedAt: now, running: 0, harnesses: [health('codex')], declaration: {os: 'linux' as const, toolchains: ['git'],
      repositories: [{name: 'sample', revision}], pressure: 'normal' as const, testSlots: 8}});
  const workers = [candidate('pc'),candidate('mac'),candidate('cloud-fixture')];
  const grant = codingResourceGrants([{kind:'installation',id:'bunny-runtime',destinations:['mac']},
    {kind:'device-proximity',id:'fixture-display',destinations:['pc']}, {kind:'device-route',id:'fixture-display',destinations:['pc','mac']}]);
  assert.ok(grant);
  assert.equal(codingResourceGrants([{kind:'installation',id:'bunny-runtime',destinations:['pc']}]),undefined);
  const request = {choice:'codex' as const,destination:'auto' as const,repository:'sample',now,allowed:()=>true};
  const select = (kind: 'installation' | 'device-route' | 'device-proximity', id: string) => selectCodingWorker(workers,{...request,
    requirements:{resource:{kind,id}}, resourceAllowed:(resource,dest)=>grant.some(g=>g.kind===resource.kind && g.id===resource.id && g.destinations.includes(dest))});
  assert.equal(select('installation','bunny-runtime').worker?.destination,'mac');
  assert.equal(select('device-proximity','fixture-display').worker?.destination,'pc');
  assert.equal(select('device-route','fixture-display').worker?.destination,'mac');
  assert.equal(select('device-route','unknown-target').worker,undefined);
  assert.equal(selectCodingWorker(workers,{...request,destination:'cloud'}).worker,undefined);
  assert.equal(selectCodingWorker(workers,{...request,now:now+CODING_DECLARATION_TTL_MS+1}).worker,undefined);
  assert.equal(selectCodingWorker(workers.map(worker=>({...worker,declaration:{...worker.declaration,testSlots:null}})),
    {...request,requirements:{testSlots:1}}).worker,undefined);
  assert.equal(selectCodingWorker(workers.map(worker=>({...worker,running:1000})),request).worker?.destination,'mac');
});

void test('only an owner execution clause binds a known operation or asks to clarify its missing route', async () => {
  const {codingRequirementsFromOwner} = await import('../src/coding/resource-policy.js');
  const grants = [
    {kind:'installation' as const,id:'bunny-runtime',destinations:['mac' as const]},
    {kind:'device-route' as const,id:'fixture-display',destinations:['pc' as const]},
    {kind:'device-proximity' as const,id:'fixture-display',destinations:['mac' as const]},
  ];
  const pick = (message: string) => codingRequirementsFromOwner(message,grants);
  assert.deepEqual(pick('Run the installed Mac operation for bunny-runtime.'),{resource:{kind:'installation',id:'bunny-runtime'}});
  assert.deepEqual(pick('Run the installed Mac operation and write the result to a file.'),{resource:{kind:'installation',id:'bunny-runtime'}});
  assert.deepEqual(pick('Run the fixture-display check through the authorized edge and report the result.'),{resource:{kind:'device-route',id:'fixture-display'}});
  assert.deepEqual(pick('Run the tests.'), {standardTests: true});
  assert.equal(pick('Implement and test an installer for the Mac.'),undefined);
  assert.equal(pick('Please explain how the Mac install works.'),undefined);
  assert.equal(pick('Check how the Mac installation works.'),undefined);
  assert.deepEqual(pick('Implement the installer, then verify the installed runtime.'),{resource:{kind:'installation',id:'bunny-runtime'}});
  assert.deepEqual(pick('Run a Windows-only check.'),{os:'windows',testSlots:1});
  assert.deepEqual(pick('Run the fixture-display check through the authorized edge.'),{resource:{kind:'device-route',id:'fixture-display'}});
  assert.deepEqual(pick('Run a proximity check for fixture-display.'),{resource:{kind:'device-proximity',id:'fixture-display'}});
  assert.deepEqual(pick('Run a proximity check for another-device.'),{refusal:'unknown-resource'});
  assert.deepEqual(pick('Run the fixture-display check.'),{refusal:'ambiguous-resource'});
});
