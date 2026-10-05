// The CHOMPI bridge adapter's entry point (Hub #853): `npm run -s verify:chompi -- <operation> …`.
// The lifecycle is @jimmie-potts/app-verify; the bridge supplies apps/chompi-bridge/verify/plugin.mjs.
import {access} from 'node:fs/promises';

const required = [new URL(import.meta.resolve('@jimmie-potts/app-verify')), new URL('../apps/chompi-bridge/dist/cli.js', import.meta.url), new URL('../apps/chompi-bridge/dist/sim/scenarios.js', import.meta.url)];
let built = true;
for (const file of required) {
  try {
    await access(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    built = false;
  }
}

if (!built) {
  console.log(JSON.stringify({operation: process.argv[2] ?? 'help', state: 'unavailable', error: 'core-build-missing',
    detail: 'The verification core or the bridge is not built; run npm run build from the repository root.'}));
  process.exitCode = 3;
} else {
  const {runCli} = await import('@jimmie-potts/app-verify');
  const {default: plugin} = await import('../apps/chompi-bridge/verify/plugin.mjs');
  process.exitCode = await runCli(plugin, process.argv.slice(2));
}
