// The Codex Desktop module's entry in the runtime's shipped list (Hub #926): the module with the real Codex home's
// reader, or with a simulated marker under `--simulate`. It has the shape of the runtime's `ModuleFactory` without
// importing the runtime, which a module may not do. It publishes only the core's `lifecycle` family, so it brings no
// payload schemas of its own.
import type {BunnyModule} from '@jimmie-potts/sdk';
import {MODULE_NAME, createCodexDesktopModule} from './module.js';
import {SimulatedMarker} from './simulated.js';
import {folderReader} from './transport.js';

/**
 * A section for the simulated marker, which tests and disposable runs of the shipped list use. Its home is never read: a
 * simulated run reads no file. The module reads no secret.
 */
export const CODEX_DESKTOP_SIMULATED_SECTION = Object.freeze({home: '/nonexistent/codex-simulated', hostId: 'host-sim', sourceId: 'codex-desktop'});

export const codexDesktopFactory: {
  readonly name: string; readonly create: () => BunnyModule; readonly simulate: () => BunnyModule;
  /** The simulated build's section; the module reads no secret, so it names none. */
  readonly simulatedSection: {readonly config: Readonly<Record<string, unknown>>};
} = {
  name: MODULE_NAME,
  create: () => createCodexDesktopModule({transport: folderReader()}),
  simulate: () => createCodexDesktopModule({transport: new SimulatedMarker()}),
  simulatedSection: {config: CODEX_DESKTOP_SIMULATED_SECTION},
};
