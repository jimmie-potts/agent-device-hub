// The Pixoo library migration's entry point (Hub #931): `node apps/runtime/dist/src/migrate-pixoo.js <migrate|verify>
// --library <dir> --state-dir <dir> [--min-free-bytes <bytes>]`. It owns the process's standard output, where it writes
// the tool's one JSON line; `runPixooMigration` in pixoo-migration.ts does the work. SIGINT and SIGTERM stop the tool
// as its signal does: a migration under way stops its copies, removes what it wrote and exits 4 with `interrupted`.
import {runPixooMigration} from './pixoo-migration.js';

const controller = new AbortController();
const stop = (): void => { controller.abort(); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
process.exitCode = await runPixooMigration(process.argv.slice(2), {write: line => { process.stdout.write(line); }, signal: controller.signal});
process.off('SIGINT', stop);
process.off('SIGTERM', stop);
