// Remove obsolete generated output before a normal build. Retained sources and private stores are untouched.
import {rm} from 'node:fs/promises';
import {resolve} from 'node:path';

const paths = ['modules/bb8/dist', 'apps/bb8-windows/dist'];
for (const stem of ['bb8-grant.test', 'bb8-link.test', 'bb8-upgrade-qualification.test', 'scenarios/modules/bb8']) {
  for (const suffix of ['.js', '.js.map', '.d.ts', '.d.ts.map']) paths.push(`apps/runtime/dist/tests/${stem}${suffix}`);
}
await Promise.all(paths.map(path => rm(resolve(path), {recursive: true, force: true})));
