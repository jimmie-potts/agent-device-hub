// Test-only Hub seed faults, selected by a private runtime marker after start.
// Production compose and the production adapter expose no fault input.
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {runCli} from '@jimmie-potts/app-verify';
import plugin from '../plugin.mjs';

const original = plugin.scenarios.integrated.seed;
const candidate = {...plugin, scenarios: {...plugin.scenarios, integrated: {...plugin.scenarios.integrated, seed: async context => {
  const marker = join(context.runtimeDir, 'fixture-reset.json');
  const control = await readFile(marker, 'utf8').then(JSON.parse, () => ({}));
  if (control.mode === 'fail') throw new Error('requested owner seed failure');
  if (control.mode === 'hold') {
    await writeFile(join(context.runtimeDir, 'fixture-reset-entered'), 'entered', {mode: 0o600});
    while (await readFile(marker, 'utf8').then(JSON.parse, () => ({})).then(value => value.mode === 'hold')) await delay(25);
  }
  return original(context);
}}}};
process.exitCode = await runCli(candidate, process.argv.slice(2));
