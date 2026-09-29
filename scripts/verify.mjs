// The Hub adapter's documented entry point (Hub #494): `npm run -s verify -- <operation> …`.
// The lifecycle is @jimmie-potts/app-verify; the Hub supplies apps/hub/verify/plugin.mjs.
import {access} from 'node:fs/promises';

let built = true;
try {
  await access(new URL(import.meta.resolve('@jimmie-potts/app-verify')));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  built = false;
}

if (!built) {
  console.log(JSON.stringify({operation: process.argv[2] ?? 'help', state: 'unavailable', error: 'core-build-missing',
    detail: 'The verification core is not built; run npm run build from the repository root.'}));
  process.exitCode = 3;
} else {
  const {runCli} = await import('@jimmie-potts/app-verify');
  const {default: plugin} = await import('../apps/hub/verify/plugin.mjs');
  process.exitCode = await runCli(plugin, process.argv.slice(2));
}
