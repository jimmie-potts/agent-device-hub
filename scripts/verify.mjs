// The Hub adapter's documented entry point (Hub #494): `npm run -s verify -- <operation> …`.
// The lifecycle is @jimmie-potts/app-verify; the Hub supplies apps/hub/verify/plugin.mjs.
import {runCli} from '@jimmie-potts/app-verify';
import plugin from '../apps/hub/verify/plugin.mjs';

process.exitCode = await runCli(plugin, process.argv.slice(2));
