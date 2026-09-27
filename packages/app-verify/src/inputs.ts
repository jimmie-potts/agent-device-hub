// Run inputs (1.1): named, non-secret values a caller gives a run with
// `--input <name>=<value>`, such as another run's loopback URL. The plug-in
// declares them; the receipt records them; every relaunch reuses them.
import type {AppPlugin, RunInputs} from './types.js';
import {UsageError} from './util.js';

/** Input and endpoint names: a letter, then letters, digits, `_` or `-`; at most 64 characters. */
export const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
/** Names that suggest a credential. Inputs are recorded in the receipt, so they never carry one. */
export const SECRET_LIKE = /token|secret|password|credential|key/i;
/** 1 to 512 printable ASCII characters: no control, bidi or zero-width character reaches a receipt or a terminal. */
export const INPUT_VALUE = /^[\x20-\x7e]{1,512}$/;

/** Whether the plug-in declares any input. A plug-in that declares none behaves exactly as with 1.0. */
export function declaresInputs(plugin: AppPlugin): boolean {
  return Object.keys(plugin.inputs ?? {}).length > 0;
}

/** Refuse a plug-in whose declarations could never be given safely; like other plug-in errors, a programming error. */
export function checkDeclarations(plugin: AppPlugin): void {
  for (const [name, declaration] of Object.entries(plugin.inputs ?? {})) {
    if (!NAME.test(name)) throw new Error(`plug-in input name ${name} must be a letter followed by letters, digits, _ or -, at most 64 characters`);
    if (SECRET_LIKE.test(name)) throw new Error(`plug-in input ${name} looks like a secret; inputs are recorded in the receipt and must never carry a credential`);
    if (typeof declaration?.description !== 'string' || declaration.description.length === 0) throw new Error(`plug-in input ${name} needs a description`);
  }
}

/** Parse repeated `--input <name>=<value>` arguments. Format errors only; `resolveInputs` checks the rest. */
export function parseInputs(pairs: readonly string[]): RunInputs {
  const given: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    if (at <= 0) throw new UsageError('--input takes <name>=<value>');
    const name = pair.slice(0, at);
    if (Object.hasOwn(given, name)) throw new UsageError(`input ${name} is given twice`);
    given[name] = pair.slice(at + 1);
  }
  return given;
}

/** Refuse, as a usage error, a secret-like or undeclared name and a value that is not 1 to 512 printable ASCII characters. */
export function checkGiven(plugin: AppPlugin, given: Readonly<Record<string, unknown>>): void {
  const declared = plugin.inputs ?? {};
  for (const [name, value] of Object.entries(given)) {
    // A secret-like name is named as such even when undeclared, so the message says why it can never be one.
    if (SECRET_LIKE.test(name)) throw new UsageError(`input ${name} looks like a secret; inputs are recorded in the receipt and must never carry a credential`);
    if (!Object.hasOwn(declared, name)) throw new UsageError(`${name} is not an input of this plug-in; see help`);
    if (typeof value !== 'string' || !INPUT_VALUE.test(value)) throw new UsageError(`input ${name} takes 1 to 512 printable ASCII characters`);
  }
}

/**
 * The inputs a run uses: `recorded` (a relaunch's earlier inputs, or none)
 * with each name in `given` replacing its value. Refuses, as a usage error, a
 * secret-like or undeclared name, a value that is not 1 to 512 printable ASCII
 * characters and a missing required input. The result lists names in
 * declaration order.
 */
export function resolveInputs(plugin: AppPlugin, given: Readonly<Record<string, unknown>>, recorded: Readonly<Record<string, unknown>> = {}): RunInputs {
  const declared = plugin.inputs ?? {};
  const merged: Record<string, unknown> = {...recorded, ...given};
  checkGiven(plugin, merged);
  const inputs: Record<string, string> = {};
  for (const [name, declaration] of Object.entries(declared)) {
    if (Object.hasOwn(merged, name)) inputs[name] = merged[name] as string;
    else if (declaration.required) throw new UsageError(`input ${name} is required; give it with --input ${name}=<value>`);
  }
  return inputs;
}
