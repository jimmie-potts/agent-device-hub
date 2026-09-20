// Export only the pinned, pure Zod declaration modules. No server is imported.
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes, createRequire} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const [repository, dependencies] = process.argv.slice(2);
if (!repository || !dependencies) throw new Error('Usage: node export_pixoo.mjs <Git repository> <installed Pixoo dependency root>');
const revision = '9f1c0ec75651810a441606b0c08fbdeee824c8d8';
const read = file => execFileSync('git', ['-C', repository, 'show', `${revision}:${file}`], {encoding:'utf8'});
const lock = JSON.parse(read('package-lock.json'));
const require = createRequire(path.join(path.resolve(dependencies), 'package.json'));
const zodPackage = require.resolve('zod/package.json');
const installed = JSON.parse(fs.readFileSync(zodPackage));
if (installed.version !== lock.packages['node_modules/zod'].version) throw new Error('Install the source-pinned Zod version first');
const zodURL = pathToFileURL(path.join(path.dirname(zodPackage), 'index.js')).href;
const {z} = await import(zodURL);
const output = {};
for (const file of ['packages/core/src/api.ts', 'packages/core/src/index.ts']) {
  const source = read(file).replace(/export \* from '\.\/api\.js';/, '').replace(/from 'zod'/, `from '${zodURL}'`);
  const code = stripTypeScriptTypes(source, {mode:'strip'});
  const module = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  for (const [name,value] of Object.entries(module)) {
    if (value && typeof value.safeParse === 'function') {
      const schema = z.toJSONSchema(value, {target:'draft-2020-12', io:'input'});
      delete schema.$schema;
      output[name] = schema;
    }
  }
}
// Zod refinements are executable predicates; record their structural meaning
// where JSON Schema can express it. Domain rules still belong to the service.
output.playlistOptions.anyOf = [{required:['repeat']}, {required:['shuffle']}];
output.displayCommand.oneOf = [{required:['brightness']}, {required:['screenOn']}];
output.apiName.description = 'Trimmed by the service. Control characters U+0000–U+001F and U+007F are rejected.';
output.deviceConfiguration.properties.ip.description = 'Canonical RFC1918 IPv4 only: 10/8, 172.16/12 or 192.168/16. Saving settings does not select device mode; changing the active configuration requires a restart.';
const root = path.dirname(fileURLToPath(import.meta.url));
fs.writeFileSync(path.join(root,'schemas/pixoo-requests.json'), JSON.stringify(output,null,2)+'\n');
console.log(`Exported ${Object.keys(output).length} request/diagnostic schemas with Zod ${installed.version}.`);
