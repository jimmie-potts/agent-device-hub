// The runtime adapter's entry point (Hub #920): `npm run -s verify:runtime -- <operation> …`.
// The lifecycle is @jimmie-potts/app-verify; the runtime supplies apps/runtime/dist/verify/plugin.js.
import {access} from 'node:fs/promises';

const required = [
  new URL(import.meta.resolve('@jimmie-potts/app-verify')), new URL('../apps/runtime/dist/verify/plugin.js', import.meta.url),
  new URL('../apps/runtime/dist/verify/supervisor.js', import.meta.url),
];
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
    detail: 'The verification core or the runtime is not built; run npm run build from the repository root.'}));
  process.exitCode = 3;
} else {
  const {runCli} = await import('@jimmie-potts/app-verify');
  const {default: plugin, startOnlyRefusal} = await import('../apps/runtime/dist/verify/plugin.js');
  // The boundary negative controls fail their start by design; reseeding a running run into one would stop it.
  const refusal = startOnlyRefusal(process.argv.slice(2));
  if (refusal) {
    console.log(JSON.stringify(refusal));
    process.exitCode = 2;
  } else process.exitCode = await runCli(plugin, process.argv.slice(2));
}
