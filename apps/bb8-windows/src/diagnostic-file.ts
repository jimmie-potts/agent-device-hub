/** Private diagnostic persistence, separate from receipt storage and writer ownership. */
import {lstat, open, type FileHandle} from 'node:fs/promises';
import {assertPrivate} from './configuration.js';
import {startHelperDiagnostics} from './diagnostics.js';

type Dependencies = {lstat?: typeof lstat; open?: typeof open; assertPrivate?: typeof assertPrivate; start?: typeof startHelperDiagnostics};
export async function startPrivateHelperDiagnostics(path: string, dependencies: Dependencies = {}) {
  const inspect = dependencies.lstat ?? lstat, append = dependencies.open ?? open;
  const check = dependencies.assertPrivate ?? assertPrivate, start = dependencies.start ?? startHelperDiagnostics;
  let file: FileHandle | undefined;
  let exists: boolean;
  try {
    exists = await inspect(path).then(() => true, (error: unknown) => {if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false; throw error;});
  } catch {return undefined;} // No inspection means no telemetry write, rather than loss of the device service.
  // Privacy refusal remains fatal. A telemetry failure never relaxes the selected path's safety checks.
  if (exists) await check(path, false, Infinity);
  try {file = await append(path, 'a', 0o600);} catch {return undefined;}
  try {await check(path, false, Infinity);} catch (error) {await file.close().catch(() => {}); throw error;}
  try {
    let bytes = (await file.stat()).size;
    const output = file;
    let writing = Promise.resolve();
    const diagnostics = await start({sink: async line => {
      const framed = line.endsWith('\n') ? line : `${line}\n`;
      const length = Buffer.byteLength(framed);
      if (bytes + length > 4 * 1024 * 1024) throw new Error('BB-8 diagnostic capacity');
      bytes += length;
      // The two bounded host pipelines share one file. Serialize their complete records before append.
      const pending = writing.then(async () => {await output.writeFile(framed);});
      writing = pending.catch(() => {});
      await pending;
    }});
    return {...diagnostics, shutdown: async () => {try {await diagnostics.shutdown();} catch {} finally {await output.close().catch(() => {});}}};
  } catch {await file.close().catch(() => {}); return undefined;}
}
