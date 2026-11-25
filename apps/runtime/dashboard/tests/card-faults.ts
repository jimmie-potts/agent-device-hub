// A test build of the runtime dashboard whose chosen cards can be made to throw (Hub #2139). It is the same esbuild
// call as `build.mjs`, with one more plugin: the shell's imports of three card components resolve to stand-ins that
// render a probe beside the real component. The probe throws while it renders, or from an effect, when the page's
// `cardFaults` names its card. Nothing of this reaches the product build: a journey serves this bundle in place of
// `/dashboard.js` for its own page only.
//
// The probes, by the key a journey sets in `window.cardFaults`:
// - `inbox`: the Inbox card on Home (`InboxPanel`);
// - `tidbyt`: the Tidbyt module's display card, on Home and on its component page (`TidbytDisplay`);
// - `module:<module>/<page>`: a module page on its route (`ModulePageView`).
// A render fault throws a `TypeError`, an effect fault a `RangeError`, so a record shows which one it was.
import {fileURLToPath} from 'node:url';
import {build, type Plugin} from 'esbuild';
import type {Page} from 'playwright';
import {moduleFrontends} from '../../dist/build/frontend.js';

export type CardFault = 'render' | 'effect';
type Target = {specifier: string; importer: string; name: string; key: string};

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const TARGETS: readonly Target[] = [
  {specifier: './inbox.tsx', importer: 'main.tsx', name: 'InboxPanel', key: `'inbox'`},
  {specifier: '@jimmie-potts/tidbyt/frontend', importer: 'main.tsx', name: 'TidbytDisplay', key: `'tidbyt'`},
  {specifier: './module-page.tsx', importer: 'main.tsx', name: 'ModulePageView', key: '`module:${props.module.name}/${props.page.id}`'},
];

const PROBE = `
function CardFaultProbe({card}) {
  const faults = globalThis.cardFaults ?? {};
  if (faults[card] === 'render') throw new TypeError('synthetic render fault');
  React.useEffect(() => { if ((globalThis.cardFaults ?? {})[card] === 'effect') throw new RangeError('synthetic effect fault'); });
  return null;
}`;

const faults: Plugin = {
  name: 'card-faults',
  setup(builder) {
    for (const target of TARGETS) {
      const filter = new RegExp(`^${target.specifier.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`);
      builder.onResolve({filter}, async args => {
        if (args.pluginData === 'real' || !args.importer.endsWith(`/src/${target.importer}`)) return undefined;
        const real = await builder.resolve(args.path, {resolveDir: args.resolveDir, kind: args.kind, importer: args.importer, pluginData: 'real'});
        if (real.errors.length > 0) return {errors: real.errors};
        return {path: real.path, namespace: 'card-fault', pluginData: target};
      });
    }
    builder.onLoad({filter: /.*/, namespace: 'card-fault'}, args => {
      const target = args.pluginData as Target;
      const real = JSON.stringify(args.path);
      return {loader: 'js', resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), contents: `
        import React from 'react';
        import {${target.name} as Real} from ${real};
        export * from ${real};
        ${PROBE}
        export function ${target.name}(props) {
          return React.createElement(React.Fragment, null, React.createElement(CardFaultProbe, {card: ${target.key}}), React.createElement(Real, props));
        }`};
    });
    // The stand-in's own import of the real file must not resolve to the stand-in again.
    builder.onResolve({filter: /.*/, namespace: 'card-fault'}, args => args.path.startsWith('/') ? {path: args.path} : undefined);
  },
};

let bundle: Promise<string> | undefined;

/** The faultable dashboard script, built once per process. */
export function faultableDashboard(): Promise<string> {
  bundle ??= build({
    entryPoints: [fileURLToPath(new URL('../src/main.tsx', import.meta.url))], bundle: true, minify: true, format: 'esm', target: 'es2022',
    platform: 'browser', write: false, outdir: fileURLToPath(new URL('../../dist/card-faults/', import.meta.url)), logLevel: 'warning',
    plugins: [faults, moduleFrontends(root)],
  }).then(result => {
    const script = result.outputFiles.find(file => file.path.endsWith('.js'));
    if (script === undefined) throw new Error('the faultable dashboard build produced no script');
    return script.text;
  });
  return bundle;
}

/** Serves the faultable script to `page` and starts it with `initial` faults. `set` changes them while the page runs. */
export async function serveFaultable(page: Page, initial: Record<string, CardFault> = {}): Promise<{set(card: string, fault: CardFault | undefined): Promise<void>}> {
  const script = await faultableDashboard();
  await page.route('**/dashboard.js', route => route.fulfill({status: 200, contentType: 'text/javascript', body: script}));
  await page.addInitScript(value => { (globalThis as {cardFaults?: Record<string, string>}).cardFaults ??= value; }, initial);
  return {
    set: async (card, fault) => {
      await page.evaluate(([key, value]) => {
        const all = ((globalThis as {cardFaults?: Record<string, string>}).cardFaults ??= {});
        if (value === null) delete all[key]; else all[key] = value;
      }, [card, fault ?? null] as const);
    },
  };
}
