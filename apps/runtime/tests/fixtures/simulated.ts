// The configuration of a run of shipped modules on their simulated devices (Hub #919, #929): each factory's
// `simulatedSection`, with one private synthetic file for each secret it names. The shipped disposable run, the runtime's
// tests and the maintenance journal test all write it here, so a module's simulated configuration lives in one place.
import {chmod, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {CONFIG_SCHEMA, type ModuleFactory} from '../../src/index.js';
import {SYNTHETIC_TOKEN} from './sign.js';

/**
 * A module's section for a simulated run: its `config`, and, for each secret name it declares, a private file in
 * `<dir>/secrets` holding the synthetic token, mapped in `secrets`. A module that names no secret gets no `secrets` member.
 */
export async function simulatedSection(dir: string, name: string, {config, secrets = []}: NonNullable<ModuleFactory['simulatedSection']>): Promise<object> {
  if (secrets.length === 0) return {...config};
  const folder = join(dir, 'secrets');
  await mkdir(folder, {recursive: true, mode: 0o700});
  await chmod(folder, 0o700);
  const files: Record<string, string> = {};
  for (const secret of secrets) {
    const file = join(folder, `${name}-${secret}`);
    await writeFile(file, `${SYNTHETIC_TOKEN}\n`, {mode: 0o600});
    await chmod(file, 0o600);
    files[secret] = file;
  }
  return {...config, secrets: files};
}

/** The simulated section of every factory that gives one, by module name, with their secret files written in `dir`. */
export async function simulatedSections(dir: string, factories: readonly ModuleFactory[]): Promise<Record<string, object>> {
  await mkdir(dir, {recursive: true, mode: 0o700});
  await chmod(dir, 0o700);
  const modules: Record<string, object> = {};
  for (const {name, simulatedSection: section} of factories) {
    if (section !== undefined) modules[name] = await simulatedSection(dir, name, section);
  }
  return modules;
}

/**
 * Writes, in `dir`, a private configuration file with the simulated section of every factory that gives one, and returns
 * its path for `--config`.
 */
export async function writeSimulatedConfiguration(dir: string, factories: readonly ModuleFactory[]): Promise<string> {
  const modules = await simulatedSections(dir, factories);
  const file = join(dir, 'runtime-config.json');
  await writeFile(file, `${JSON.stringify({schema: CONFIG_SCHEMA, modules}, null, 2)}\n`, {mode: 0o600});
  await chmod(file, 0o600);
  return file;
}
