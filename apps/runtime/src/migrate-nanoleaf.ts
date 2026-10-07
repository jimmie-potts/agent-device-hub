// The Nanoleaf migration's entry point (Hub #933): `node apps/runtime/dist/src/migrate-nanoleaf.js <migrate|verify>
// --source <dir> --state-dir <dir> --secrets-dir <dir> --section <file>`. It owns the process's standard output, where it
// writes the tool's one JSON line; `runNanoleafMigration` in nanoleaf-migration.ts does the work.
import {runNanoleafMigration} from './nanoleaf-migration.js';

process.exitCode = await runNanoleafMigration(process.argv.slice(2), {write: line => { process.stdout.write(line); }});
