// The module test kit (Hub #882, #919) on the Codex Desktop module: its manifest and section, its lifecycle, and the
// core's sessions it copies. It serves no family and answers no command. The kit's policy A check needs a state that
// reports a device unavailable, and this module publishes none: its marker's folder is covered by module.test.ts, where
// a folder that never answers leaves the start immediate and the marker unavailable.
import {moduleConformance} from '@jimmie-potts/sdk/testing';
import {SimulatedMarker, createCodexDesktopModule} from '../src/index.js';
import {SECTION} from './support.js';

moduleConformance({
  create: () => createCodexDesktopModule({transport: new SimulatedMarker()}),
  copies: {families: ['session'], snapshot: {revision: 0, states: []}},
  config: SECTION,
});
