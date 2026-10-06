// The runtime's entry point: `node apps/runtime/dist/src/main.js --port <port> [--state-dir <dir>] [--lag-limit-ms <ms>]`.
import {shippedModules} from './modules.js';
import {runMain} from './process.js';

await runMain(process.argv.slice(2), shippedModules);
