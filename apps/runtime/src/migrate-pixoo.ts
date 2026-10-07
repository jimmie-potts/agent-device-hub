// The Pixoo library migration's entry point (Hub #931): `node apps/runtime/dist/src/migrate-pixoo.js <migrate|verify>
// --library <dir> --state-dir <dir> [--min-free-bytes <bytes>]`. It owns the process's standard output, where it writes
// the tool's one JSON line; `runPixooMigration` in pixoo-migration.ts does the work.
import {runPixooMigration} from './pixoo-migration.js';

process.exitCode = await runPixooMigration(process.argv.slice(2), {write: line => { process.stdout.write(line); }});
