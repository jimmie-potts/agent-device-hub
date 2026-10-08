// The Pixoo library migration (Hub #931): reads the installed release's library, copies it into the module's store and
// verifies the copy. The runtime's command-line tool (`apps/runtime/src/migrate-pixoo.ts`) runs it offline.
export {
  CARRIED, INSTALLED_LIBRARY, LEFT_IN_BACKUP, MIGRATION_SCHEMA, MigrationError, fullDisk, type LeftInBackup, type MigrationCode, type MigrationCounts,
  type MigrationDigest, type MigrationReport, type Mismatches, type VerificationReport,
} from './contracts.js';
export {InstalledLibrary, type MediaFile} from './installed.js';
export {migrateLibrary, type Destination} from './migrate.js';
export {verifyMigration, type MigratedStore} from './verify.js';
export {writeSyntheticLibrary, type SyntheticLibrary} from './synthetic.js';
