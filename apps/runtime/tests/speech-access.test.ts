import assert from 'node:assert/strict';
import test from 'node:test';
import {edgePermissions, BROWSER_SOURCE, type Principal} from '../src/gateway/access.js';

void test('only an authorized dashboard browser receives the narrow speech endpoint grant', () => {
  const browser: Principal = {id: 'browser-test', kind: 'browser', source: BROWSER_SOURCE, scopes: new Set(['read', 'control'])};
  const granted = edgePermissions(browser);
  assert.deepEqual(granted.endpoint, {
    respond: ['companion-speech-output'], publish: ['companion-speech-playback'], request: ['companion-speech-endpoint'],
  });
  assert.equal(granted.calls?.includes('respond'), false);
  assert.equal(granted.calls?.includes('publish'), false);
  assert.equal(granted.keys?.some(key => key.includes('speech')), false, 'ordinary calls receive no speech routing authority');
  const refused: Principal[] = [
    {...browser, scopes: new Set(['read'])}, {...browser, scopes: new Set(['control'])},
    {...browser, kind: 'credential'}, {...browser, source: 'bunny/parts/other'},
    {...browser, kind: 'credential', source: 'bunny/parts/operator', scopes: new Set(['read', 'control', 'admin'])},
    {...browser, kind: 'credential', source: 'bunny/parts/hook', scopes: new Set(['ingest'])},
    {id: 'robot-link', kind: 'credential', source: 'bunny/parts/bb8-windows', role: 'bb8-link', robotId: 'bb8', scopes: new Set()},
  ];
  for (const principal of refused) assert.equal(edgePermissions(principal).endpoint, undefined);
});
