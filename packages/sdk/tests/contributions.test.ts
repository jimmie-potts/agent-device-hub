// A module's pages, content, tools and settings (module API 1.2, Hub #835), as the runtime and the module test kit
// check them before the module starts: `checkContributions`, within `checkManifest`.
import assert from 'node:assert/strict';
import {
  MAX_PAGES, MAX_TOOLS, MODULE_API_VERSION, checkContributions, checkManifest, type ModuleManifest, type ModulePage, type ModuleTool,
} from '../src/index.js';
import {it} from './support.js';

type Sign = {greeting: string};
const page: ModulePage = {id: 'preview', title: 'Preview', render: () => '<img src="content/frame-1" alt="preview">'};
const tool: ModuleTool = {
  name: 'status', description: 'Read each sign and whether it answers.',
  input: {type: 'object', additionalProperties: false, properties: {}},
  output: {type: 'object', properties: {signs: {type: 'array'}}},
  read: () => ({signs: []}),
};
const sign: ModuleManifest<Sign> = {
  name: 'sign', apiVersion: '1.2',
  configure: section => ({config: {greeting: String((section as {greeting?: unknown}).greeting)}}),
  pages: [page], content: () => ({type: 'image/png', bytes: new Uint8Array([137, 80, 78, 71])}), tools: [tool],
  settings: {schema: {type: 'object', properties: {greeting: {type: 'string'}}}, show: config => ({greeting: config.greeting})},
};
const problem = (manifest: ModuleManifest<Sign>): string | undefined => checkContributions(manifest)?.detail;

it('the module API is 1.2, and a 1.2 module with pages, content, tools and settings is accepted', () => {
  assert.equal(MODULE_API_VERSION, '1.2');
  assert.equal(checkManifest(sign as ModuleManifest), undefined);
  assert.equal(checkContributions({name: 'plain', apiVersion: '1.0'}), undefined, 'a module that contributes nothing needs no 1.2');
  assert.equal(problem({...sign, apiVersion: '1.3'}), undefined, 'a later minor version may contribute too');
});

it('a 1.0 or 1.1 module that declares a contribution is refused, and still runs without one', () => {
  for (const apiVersion of ['1.0', '1.1']) {
    for (const contribution of [{pages: [page]}, {tools: [tool]}, {content: sign.content}, {settings: sign.settings}]) {
      const manifest = {name: 'sign', apiVersion, configure: sign.configure, ...contribution} as ModuleManifest<Sign>;
      assert.deepEqual(checkManifest(manifest as ModuleManifest), {code: 'invalid-request', detail: 'pages, content, tools and settings need module API 1.2'},
        `${apiVersion} ${Object.keys(contribution).join()}`);
    }
    assert.equal(checkManifest({name: 'sign', apiVersion}), undefined, `a ${apiVersion} module still runs`);
  }
});

it('pages need distinct IDs other than content, a title and a render', () => {
  const ids = 'each page needs a distinct ID of lowercase letters and digits with single hyphens, at most 64, other than content';
  for (const id of ['Preview', 'pre_view', '-preview', 'content', 'x'.repeat(65), '']) assert.equal(problem({...sign, pages: [{...page, id}]}), ids, id);
  assert.equal(problem({...sign, pages: [page, page]}), ids, 'a repeated ID');
  const titled = 'each page needs a title of at most 80 characters and a render';
  assert.equal(problem({...sign, pages: [{...page, title: ''}]}), titled);
  assert.equal(problem({...sign, pages: [{...page, title: 'x'.repeat(81)}]}), titled);
  assert.equal(problem({...sign, pages: [{...page, render: 'html' as unknown as ModulePage['render']}]}), titled);
  const many = Array.from({length: MAX_PAGES + 1}, (_, index) => ({...page, id: `page-${index}`}));
  assert.equal(problem({...sign, pages: many}), `pages must be a list of at most ${MAX_PAGES}`);
  assert.equal(problem({...sign, content: 'frames' as unknown as NonNullable<ModuleManifest['content']>}), 'content must be a function');
});

it('tools need distinct names, a description, an object input that allows no other member, an object output and a read', () => {
  const names = 'each tool needs a distinct name: a lowercase letter, then lowercase letters, digits and underscores, at most 48';
  for (const name of ['Status', '1status', 'status-now', 'x'.repeat(49), '']) assert.equal(problem({...sign, tools: [{...tool, name}]}), names, name);
  assert.equal(problem({...sign, tools: [tool, tool]}), names, 'a repeated name');
  const described = 'each tool needs a description of at most 1024 characters and a read';
  assert.equal(problem({...sign, tools: [{...tool, description: 'x'.repeat(1025)}]}), described);
  assert.equal(problem({...sign, tools: [{...tool, read: undefined as unknown as ModuleTool['read']}]}), described);
  const schemas = 'a tool\'s input and output are object schemas, and its input allows no other member';
  assert.equal(problem({...sign, tools: [{...tool, input: {type: 'object'}}]}), schemas, 'an input that allows any member');
  assert.equal(problem({...sign, tools: [{...tool, input: {type: 'array'} as unknown as ModuleTool['input']}]}), schemas);
  assert.equal(problem({...sign, tools: [{...tool, output: {type: 'string'} as unknown as ModuleTool['output']}]}), schemas);
  const many = Array.from({length: MAX_TOOLS + 1}, (_, index) => ({...tool, name: `status_${index}`}));
  assert.equal(problem({...sign, tools: many}), `tools must be a list of at most ${MAX_TOOLS}`);
});

it('settings show what configure accepted, so they need configure, an object schema and a show', () => {
  const {configure: _configure, ...unconfigured} = sign;
  assert.equal(problem(unconfigured), 'settings show what configure accepted, so they need configure');
  assert.equal(problem({...sign, settings: {schema: {type: 'array'} as unknown as ModuleTool['input'], show: () => ({})}}), 'settings need an object schema and a show');
  assert.equal(problem({...sign, settings: {schema: {type: 'object'}, show: undefined as unknown as () => Record<string, unknown>}}), 'settings need an object schema and a show');
});

