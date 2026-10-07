// The Nanoleaf migration (Hub #933): reads the bridge's state directory, carries its preferences into the module's store
// and folder, converts its registry into the module's section with each token as a secret, and verifies the result. The
// runtime's command-line tool (`apps/runtime/src/migrate-nanoleaf.ts`) runs it offline.
export {
  CARRIED, CARRIED_META, CARRIED_TABLES, FRESH_SHARED_INPUT, INSTALLED_STATE, MIGRATION_SCHEMA, MigrationError, SCHEMA_META, type CarriedRows,
  type CarriedTable, type LeftInBackup, type MigrationCode, type MigrationCounts, type MigrationDigest, type MigrationReport, type StoreMismatches,
  type StoreVerification, type TypedRow, type TypedValue,
} from './contracts.js';
export {convertNanoleafState, secretFileName, secretName, type ConvertedNanoleaf, type NanoleafSection} from './convert.js';
export {InstalledState, type SourceDevice} from './installed.js';
export {migrateNanoleaf, type Destination} from './migrate.js';
export {SYNTHETIC_SOURCE, writeSyntheticNanoleafState, type SyntheticNanoleafState, type SyntheticOptions} from './synthetic.js';
export {verifyNanoleafStore, type MigratedStore} from './verify.js';
