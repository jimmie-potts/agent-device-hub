/** Explicit Windows entry point. Loading this file alone never constructs Noble or opens a robot. */
import {createHash} from 'node:crypto';
import {lstat, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {connectRemote, openModuleDatabaseFile, SdkError} from '@jimmie-potts/sdk';
import {HELPER_SOURCE} from '@jimmie-potts/bb8/link';
import {assertPrivate, readWindowsConfig} from './configuration.js';
import {NativeAdapter} from './native.js';
import {HelperOwner} from './owner.js';
import {acquireWriterLease} from './writer-lease.js';
const scheduler = {after: (ms: number, callback: () => void) => {const timer = setTimeout(callback, ms); return () => {clearTimeout(timer);};}};
async function main(): Promise<void> {
  const path = process.argv[2];
  if (path === undefined || process.argv.length !== 3 || process.platform !== 'win32') throw new SdkError(errorBody('invalid-request', {detail: 'use the Windows helper with one private configuration file'}));
  const config = await readWindowsConfig(path);
  await assertPrivate(config.stateDirectory, true); await assertPrivate(config.tokenFile);
  const token = (await readFile(config.tokenFile, 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(token)) throw new SdkError(errorBody('unauthenticated', {detail: 'BB-8 helper credential refused'}));
  // Exclusive SQLite ownership is established before native import or SDK command admission.
  let owner: HelperOwner | undefined;
  let leaseLost = false;
  const lease = await acquireWriterLease(config.targetAddress, () => {leaseLost = true; void owner?.streamLost().catch(() => {});});
  const databasePath = join(config.stateDirectory, 'bb8-link.sqlite');
  let database;
  try {
    const existing = await lstat(databasePath).then(() => true, (error: unknown) => {if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false; throw error instanceof Error ? error : new SdkError(errorBody('unavailable')); });
    if (existing) await assertPrivate(databasePath, false, Infinity);
    database = openModuleDatabaseFile(databasePath);
    await assertPrivate(databasePath, false, Infinity);
  } catch (error) {if (database?.isOpen === true) database.close(); lease.release(); throw error;}
  const enrollment = createHash('sha256').update(JSON.stringify([config.robotId, config.model, config.adapterAddress.toLowerCase(), config.targetAddress.toLowerCase()])).digest('hex');
  try {
    database.exec('CREATE TABLE IF NOT EXISTS bb8_enrollment (id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT NOT NULL) STRICT');
    const prior = database.prepare('SELECT fingerprint FROM bb8_enrollment').get();
    if (prior !== undefined && prior.fingerprint !== enrollment) throw new Error('BB-8 enrollment changed');
    database.prepare('INSERT OR IGNORE INTO bb8_enrollment VALUES(1,?)').run(enrollment);
  } catch (error) {database.close(); lease.release(); throw error;}
  let sdk;
  try {sdk = await connectRemote({url: config.gatewayUrl, source: HELPER_SOURCE, token, onError: () => {}, onDiagnostic: diagnostic => {
    if (diagnostic.event === 'remote.disconnected') void owner?.streamLost().catch(() => {});
    if (diagnostic.event === 'remote.reconnected') void owner?.streamRestored().catch(() => {});
  }});} catch (error) {database.close(); lease.release(); throw error;}
  const wall = Date.now(), monotonic = performance.now();
  const clockErrorMs = (): number | undefined => Date.now() > config.clockQualifiedUntilMs || Math.abs((Date.now() - wall) - (performance.now() - monotonic)) > config.clockErrorMs ? undefined : config.clockErrorMs;
  const adapter = new NativeAdapter({targetAddress: config.targetAddress, adapterAddress: config.adapterAddress, logDirectory: join(config.stateDirectory, 'native-logs'), ownsWriter: () => database.isOpen && !leaseLost});
  try {owner = new HelperOwner({id: config.robotId, configurationRevision: config.configurationRevision, database, sdk, now: Date.now, scheduler, clockErrorMs, adapter: () => adapter, onError: () => {process.stderr.write('BB-8 helper cannot complete an operation; inspect its private receipts.\n');}});} catch (error) {await sdk.close(); database.close(); lease.release(); throw error;}
  let stopped = false;
  const stop = async (): Promise<void> => {if (stopped) return; stopped = true; try {await owner?.stop();} finally {try {await sdk.close();} finally {if (database.isOpen) database.close(); lease.release();}};};
  process.once('SIGINT', () => {void stop().catch(() => {process.exitCode = 1;});});
  process.once('SIGTERM', () => {void stop().catch(() => {process.exitCode = 1;});});
  try {await owner.start(); process.stdout.write('BB-8 helper ready; radio access awaits explicit connect.\n');}
  catch (error) {await stop(); throw error;}
}
void main().catch(() => {process.stderr.write('BB-8 helper startup refused.\n'); process.exitCode = 1;});
