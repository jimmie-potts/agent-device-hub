// A separately bundled trusted editor fixture, served only by the synthetic dashboard world (Hub #932).
import {build} from 'esbuild';
import type {BunnyModule} from '@jimmie-potts/sdk';

export async function editorFixture(): Promise<BunnyModule> {
  const result = await build({stdin: {contents: `
    const button = document.querySelector('button');
    button.addEventListener('click', () => { document.querySelector('output').textContent = 'Draft changed'; });
    document.querySelector('output').textContent = 'Editor ready';
  `, loader: 'js'}, bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent'});
  const script = result.outputFiles[0];
  if (script === undefined) throw new Error('the synthetic editor bundle is missing');
  return {
    manifest: {name: 'editor-fixture', apiVersion: '1.3', pages: [
      {id: 'editor', title: 'Trusted editor fixture', presentation: 'trusted-editor', scripts: ['editor.js'], styles: ['editor.css'],
        render: () => '<h1>Synthetic editor</h1><button type="button">Edit draft</button><output aria-live="polite">Loading</output>'},
      {id: 'passive', title: 'Passive fixture', render: () => '<h1>Passive preview</h1><script>document.querySelector("h1").textContent="Executed"</script>'},
    ], assets: [
      {id: 'editor.js', type: 'text/javascript; charset=utf-8', read: () => script.contents},
      {id: 'editor.css', type: 'text/css; charset=utf-8', read: () => new TextEncoder().encode('output {display:block; margin:1rem 0}')},
    ]},
    start: () => {}, stop: () => {},
  };
}
