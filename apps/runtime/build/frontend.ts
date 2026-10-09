import {resolve} from 'node:path';
import type {Plugin} from 'esbuild';
import {frontendSource} from './registry.js';

/** Supplies the statically collected browser entries to the existing dashboard build. */
export function moduleFrontends(root: string): Plugin {
  const resolveDir = resolve(root);
  return {
    name: 'bunny-module-frontends',
    setup(build) {
      build.onResolve({filter: /^@bunny\/module-frontends$/}, () => ({
        path: '@bunny/module-frontends', namespace: 'bunny-module-frontends',
      }));
      build.onLoad({filter: /.*/, namespace: 'bunny-module-frontends'}, () => ({
        contents: frontendSource(resolveDir), resolveDir, loader: 'js',
      }));
    },
  };
}
