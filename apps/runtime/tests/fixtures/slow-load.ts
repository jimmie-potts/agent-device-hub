// The entry point with a slow load, so a test can signal while the runtime is still loading. It says when loading
// begins, which the launcher reaches only after its own first steps.
import {launch} from '../../src/launch.js';

await launch(process.argv.slice(2), async () => {
  process.stderr.write(`${JSON.stringify({event_name: 'fixture.loading', attributes: {}})}\n`);
  await new Promise(resolve => { setTimeout(resolve, 2000); });
  const [{runMain}, {shippedModules}] = await Promise.all([import('../../src/process.js'), import('../../src/modules.js')]);
  return {runMain, modules: shippedModules};
});
