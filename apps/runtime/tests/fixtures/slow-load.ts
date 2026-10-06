// The entry point with a slow load, so a test can signal while the runtime is still loading:
// `node slow-load.js <wait|block> <runtime arguments>`. `wait` loads on a timer, which turns the event loop; `block`
// loads synchronously, as Node's module loading may, so a signal is delivered only on the loop's next turn. Each says
// when loading begins, which the launcher reaches only after its own first steps.
import {launch} from '../../src/launch.js';

const [mode, ...args] = process.argv.slice(2);
await launch(args, async () => {
  process.stderr.write(`${JSON.stringify({event_name: 'fixture.loading', attributes: {}})}\n`);
  if (mode === 'block') {
    const until = performance.now() + 500;
    while (performance.now() < until) await Promise.resolve();
  } else {
    await new Promise(resolve => { setTimeout(resolve, 2000); });
  }
  const [{runMain}, {shippedModules}] = await Promise.all([import('../../src/process.js'), import('../../src/modules.js')]);
  return {runMain, modules: shippedModules};
});
