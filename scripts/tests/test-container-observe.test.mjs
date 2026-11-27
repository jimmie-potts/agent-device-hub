import assert from 'node:assert/strict';
import {test} from 'node:test';
import {observeTestResources} from '../test-container/observe.mjs';

const health = (status = 'healthy') => JSON.stringify({
  Status: status, Log: [{Start: '2026-11-25T01:00:00.000Z', End: '2026-11-25T01:00:00.050Z'}],
});
const macCore = 'bunny-mac-personal-core-1\trunning\tbunny-core:stable';
const sample = ({destination = 'mac', host = {platform: 'darwin'}, load = 1, listing = macCore,
  core = health(), memories = '', processList = ''} = {}) => {
  const reads = [];
  const observation = observeTestResources(destination, {host, load, processes: () => processList,
    docker: args => {
      reads.push(args[0]);
      if (args[0] === 'ps') return listing;
      if (args[0] === 'inspect' && args.includes('--type')) return memories;
      if (args[0] === 'inspect') return core;
      return assert.fail('the observer performs only Docker list and inspect');
    }});
  return {observation, reads};
};

test('Mac observes host pressure, native suites, occupied slots and operator weight without starting work', () => {
  assert.deepEqual(sample(), {observation: {pressure: 'normal', testSlots: 5}, reads: ['ps', 'inspect']});
  const listing = [macCore, 'bunny-gh2170-wide\tpaused\tbase', 'synthetic-operator\trunning\tbunny-core:stable',
    'bunny-diagnostics-tempo\trunning\tbase', 'unrelated-stopped\texited\tbase'].join('\n');
  assert.deepEqual(sample({listing, memories: '4294967296',
    processList: '/usr/local/bin/node --test sample.js\nnode --test-isolation=process samples.js\n'}).observation,
    {pressure: 'normal', testSlots: 0});
  assert.deepEqual(sample({load: 8}), {observation: {pressure: 'elevated', testSlots: 0}, reads: []});
  assert.deepEqual(sample({load: 13}), {observation: {pressure: 'high', testSlots: 0}, reads: []});
  assert.deepEqual(sample({core: health('unhealthy')}).observation, {pressure: 'normal', testSlots: 0});
  assert.deepEqual(sample({listing: ''}).observation, {pressure: 'normal', testSlots: null});
  assert.deepEqual(sample({listing: null}).observation, {pressure: 'normal', testSlots: null});
  assert.deepEqual(sample({processList: null}).observation, {pressure: 'normal', testSlots: null});
});

test('the PC uses its measured profile only under WSL', () => {
  const pc = {destination: 'pc', host: {platform: 'linux', osRelease: 'synthetic-microsoft-standard-WSL2'}};
  assert.deepEqual(sample({...pc, load: 10, listing: 'bunny-gh2170-wide\trunning\tbase'}), {
    observation: {pressure: 'normal', testSlots: 6}, reads: ['ps'],
  });
  assert.deepEqual(sample({...pc, load: 24}).observation, {pressure: 'elevated', testSlots: 0});
  assert.deepEqual(sample({...pc, host: {platform: 'linux'}}), {
    observation: {pressure: 'unknown', testSlots: null}, reads: [],
  });
});
