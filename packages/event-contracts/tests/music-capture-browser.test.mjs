import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import * as browserData from '@jimmie-potts/event-contracts/v2/music-capture-data';
import * as serverContract from '@jimmie-potts/event-contracts/v2/music-capture';

test('the browser capture export preserves server constants without importing server registration', async () => {
  for (const [name, value] of Object.entries(browserData)) assert.equal(serverContract[name], value, name);
  const bundle = await build({stdin: {contents: "import * as data from '@jimmie-potts/event-contracts/v2/music-capture-data'; globalThis.captureData = data;", resolveDir: process.cwd()},
    bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true, logLevel: 'silent'});
  const inputs = Object.keys(bundle.metafile.inputs);
  assert.ok(inputs.some(path => path.endsWith('music-capture-data.js')));
  assert.equal(inputs.some(path => path.endsWith('/registry.js') || path.endsWith('/index.js') || path.startsWith('node:')), false);
});
