// The module boundary of a CHOMPI bridge verification run (Hub #853). Importing this module installs a resolve
// hook in the current thread that refuses, and records, every attempt to load the native modules that reach real
// hardware or the Windows desktop: node-hid (USB HID) and koffi with its platform prebuilds (Win32 and UI Automation
// through FFI). The bridge loads both lazily, so a run that stays on the simulator transport and the simulated
// desktop never asks for them; an attempt is boundary evidence and the load fails before any native code runs.
//
// Install it before the bridge's modules run: serve.mjs imports it first and loads everything else afterwards.
import { registerHooks } from 'node:module';

const BLOCKED = /^(?:node-hid|koffi|@koromix\/.+)(?:\/.*)?$/;

/** Every refused specifier, in order, for the run's boundary report. @type {string[]} */
export const blockedModules = [];

let installed = false;

export function installModuleGuard() {
  if (installed) return;
  installed = true;
  registerHooks({
    resolve(specifier, context, next) {
      if (BLOCKED.test(specifier)) {
        blockedModules.push(specifier);
        throw Object.assign(new Error(`blocked-by-verification-run: ${specifier}`), { code: 'ERR_VERIFICATION_RUN_BLOCKED' });
      }
      return next(specifier, context);
    },
  });
}

installModuleGuard();
