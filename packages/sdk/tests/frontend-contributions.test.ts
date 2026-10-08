// Module API 1.3 admission (Hub #932): trusted application assets remain separate from content references.
import assert from 'node:assert/strict';
import {
  ASSETS_PATH, MAX_ASSETS, MAX_ASSET_BYTES, checkContributions, checkManifest,
  type ModuleAsset, type ModuleAssetType, type ModuleManifest, type ModulePage,
} from '../src/index.js';
import {CHECKS, conformanceChecks} from '../src/testing/index.js';
import {it} from './support.js';

const declared = (changes: object = {}): ModuleManifest => ({name: 'editor', apiVersion: '1.3', ...changes});
const render = (): string => '<p>Editor</p>';
const read = (): Uint8Array => new Uint8Array();
const script: ModuleAsset = {id: 'wall.js', type: 'text/javascript; charset=utf-8', read};
const style: ModuleAsset = {id: 'wall.css', type: 'text/css; charset=utf-8', read};
const editor: ModulePage = {id: 'wall', title: 'Wall', presentation: 'trusted-editor', render, scripts: [script.id], styles: [style.id]};
const react: ModulePage = {id: 'library', title: 'Library', presentation: 'react'};
const refused = (changes: object): void => {
  const answer = checkManifest(declared(changes));
  assert.equal(answer?.code, 'invalid-request');
  assert.ok(answer?.detail !== undefined && answer.detail.length > 0);
};

it('passive, React and trusted editor pages coexist without calling renderers or asset readers at admission', async () => {
  let called = 0;
  const render = (): string => { called++; return '<p>Editor</p>'; };
  const read = (): Uint8Array => { called++; return new Uint8Array(); };
  const manifest = declared({
    pages: [
      {id: 'preview', title: 'Preview', render},
      {id: 'library', title: 'Library', presentation: 'react'},
      {id: 'wall', title: 'Wall', presentation: 'trusted-editor', render, scripts: ['wall.js'], styles: ['wall.css']},
    ],
    assets: [
      {id: 'wall.js', type: 'text/javascript; charset=utf-8', read},
      {id: 'wall.css', type: 'text/css; charset=utf-8', read},
      {id: 'connector.svg', type: 'image/svg+xml', read},
    ],
  });
  assert.equal(checkContributions(manifest), undefined);
  assert.equal(checkManifest(manifest), undefined);
  const check = conformanceChecks({create: () => ({manifest, start: () => {}, stop: () => {}})}).find(item => item.name === CHECKS.manifest);
  assert.ok(check);
  await check.run();
  assert.equal(called, 0, 'admission checks declarations without executing feature code');
});

it('legacy modules and passive pages retain their capabilities while interactive declarations require API 1.3', () => {
  for (const apiVersion of ['1.0', '1.1', '1.2', '1.3']) {
    assert.equal(checkManifest(declared({apiVersion})), undefined, apiVersion);
  }
  for (const presentation of [undefined, 'passive']) {
    assert.equal(checkManifest(declared({apiVersion: '1.2', pages: [{id: 'preview', title: 'Preview', render, ...presentation === undefined ? {} : {presentation}}]})), undefined);
  }
  for (const apiVersion of ['1.0', '1.1', '1.2']) {
    refused({apiVersion, pages: [react]});
    refused({apiVersion, pages: [editor], assets: [script, style]});
    refused({apiVersion, assets: []});
  }
  assert.equal(checkManifest(declared({apiVersion: '1.4'}))?.code, 'unsupported-version');
});

it('page presentations refuse mixed or malformed declarations and reserved routing IDs', () => {
  for (const page of [
    null, [], {id: 'wall', title: 'Wall', presentation: 'unknown', render},
    {...react, render}, {...react, render: undefined}, {...react, scripts: []}, {...react, styles: []},
    {id: 'preview', title: 'Preview', render, scripts: []},
    {id: 'preview', title: 'Preview', presentation: 'passive', render, styles: []},
    {...editor, render: undefined}, {...editor, scripts: undefined}, {...editor, styles: undefined},
    {...react, title: ''}, {...react, title: 'x'.repeat(81)}, {...editor, title: ''},
    {...react, id: 'content'}, {...react, id: ASSETS_PATH}, {...editor, id: ASSETS_PATH},
  ]) refused({pages: [page], assets: [script, style]});
  refused({pages: [react, react]});
  assert.equal(checkManifest(declared({pages: [{...editor, scripts: [], styles: []}]})), undefined, 'an editor may need no scripts or styles');
});

it('assets have finite exact IDs, allowed media types and readers, without arbitrary content or path lookup', () => {
  assert.equal(ASSETS_PATH, 'assets');
  assert.equal(MAX_ASSETS, 64);
  assert.equal(MAX_ASSET_BYTES, 16 * 1024 * 1024);
  for (const type of ['text/javascript; charset=utf-8', 'text/css; charset=utf-8', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'] satisfies ModuleAssetType[]) {
    assert.equal(checkManifest(declared({assets: [{id: 'asset', type, read}]})), undefined, type);
  }
  for (const id of ['', '.', '..', '../wall.js', '/wall.js', 'wall/a.js', 'wall%2f.js', 'a?b', 'a#b', 'x'.repeat(129), 'content', ASSETS_PATH]) {
    refused({assets: [{...script, id}]});
  }
  assert.equal(checkManifest(declared({assets: [{...script, id: 'A'.repeat(128)}]})), undefined);
  for (const asset of [null, [], {...script, read: undefined}, {...script, read: 'bytes'}, {...script, bytes: new Uint8Array()},
    {...script, type: 'text/html'}, {...script, type: 'application/javascript'}, {...script, type: 'application/json'}, {...script, type: 'image/svg+xml; charset=utf-8'}]) {
    refused({assets: [asset]});
  }
  for (const assets of [null, {}, [script, script], Array.from({length: MAX_ASSETS + 1}, (_, index) => ({...script, id: `asset-${index}`}))]) refused({assets});
  assert.equal(checkManifest(declared({assets: Array.from({length: MAX_ASSETS}, (_, index) => ({...script, id: `asset-${index}`}))})), undefined);
});

it('editor script and style links resolve distinct declared assets of the correct type', () => {
  for (const change of [
    {scripts: ['missing.js']}, {styles: ['missing.css']}, {scripts: [style.id]}, {styles: [script.id]},
    {scripts: [script.id, script.id]}, {styles: [style.id, style.id]}, {scripts: null}, {styles: {}},
    {scripts: [false]}, {styles: [1]}, {scripts: Array(MAX_ASSETS + 1).fill(script.id)},
  ]) refused({pages: [{...editor, ...change}], assets: [script, style]});
  refused({pages: [editor], content: () => ({type: script.type, bytes: read()})});
});

it('the module kit applies the same frontend refusals before starting a module', async () => {
  for (const manifest of [declared({apiVersion: '1.2', pages: [react]}), declared({pages: [{...react, render}]}),
    declared({pages: [editor], assets: [{...script, read: null}, style]})]) {
    let started = false;
    const check = conformanceChecks({create: () => ({manifest, start: () => { started = true; }, stop: () => {}})}).find(item => item.name === CHECKS.manifest);
    assert.ok(check);
    await assert.rejects(async () => check.run(), {name: 'AssertionError'});
    assert.equal(started, false);
  }
});
