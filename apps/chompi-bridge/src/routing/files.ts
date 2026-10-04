import { randomBytes } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';

/** Creates the directory (and parents) readable only by the current user. Existing directories keep their mode. */
export async function ensurePrivateDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
}

/**
 * Replaces `path` with `text` atomically: a private temporary file in the same directory is written, flushed to disk
 * and renamed over the target, so a crash leaves either the old or the new content, never a partial file.
 */
export async function writePrivateFileAtomic(path: string, text: string): Promise<void> {
  const dir = dirname(path);
  await ensurePrivateDir(dir);
  const temp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temp, { force: true });
    throw error;
  }
  await handle.close();
  try {
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** Reads at most `maxBytes` of a regular file; a larger file rejects with `file-too-large`. */
export async function readBoundedFile(path: string, maxBytes: number): Promise<{ text: string; mode: number }> {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('not-a-regular-file');
    if (stat.size > maxBytes) throw new Error('file-too-large');
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);
    if (bytesRead > maxBytes) throw new Error('file-too-large');
    return { text: buffer.subarray(0, bytesRead).toString('utf8'), mode: stat.mode };
  } finally {
    await handle.close();
  }
}
