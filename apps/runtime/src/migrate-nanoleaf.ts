// The Nanoleaf migration's entry point (Hub #933): `node apps/runtime/dist/src/migrate-nanoleaf.js <migrate|verify>
// --source <dir> --state-dir <dir> --secrets-dir <dir> --section <file>`. It owns the process's standard output, where it
// writes the tool's one JSON line; `runNanoleafMigration` in nanoleaf-migration.ts does the work. A first SIGINT or
// SIGTERM stops it, and a migration that has begun to write removes what it wrote and exits 4.
import {runNanoleafMigration} from './nanoleaf-migration.js';
import {abortOnSignals} from './signals.js';

process.exitCode = await runNanoleafMigration(process.argv.slice(2), {write: line => { process.stdout.write(line); }, signal: abortOnSignals()});
