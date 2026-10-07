// The runtime's entry point: `node apps/runtime/dist/src/main.js --port <port> [--state-dir <dir>] [--config <file>]`, with
// the options `parseArguments` lists.
// It imports only the launcher; everything else loads through it.
import {launch} from './launch.js';

await launch(process.argv.slice(2), async () => {
  const [{runMain}, {shippedModules}] = await Promise.all([import('./process.js'), import('./modules.js')]);
  return {runMain, modules: shippedModules};
});
