// The composition record's lock (Hub #495). It follows the lock of
// @jimmie-potts/app-verify's receipt store, which that package does not export:
// a lock is a directory holding its holder's pid, process start time and a
// nonce, put in place by renaming a prepared directory. A dead holder's lock is
// broken only under a separate breaker lock, and only while it still names that
// holder, so a live lock is never displaced. Work runs only while this process
// holds the lock, and `stillHeld` lets a writer fence its write.
import {randomBytes, createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdtemp, readdir, readFile, rename, rm, stat, utimes, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const WAIT_MS = 10000;
/** A lock or breaker without a readable holder this old was left by a killed process. */
const HOLDERLESS_MS = 5000;
const pause = (/** @type {number} */ ms) => new Promise(resolve => setTimeout(resolve, ms));

/** The lock is held by another live operation for longer than the wait. */
export class LockedError extends Error {}

/** @param {number} pid */
async function startTime(pid) {
  const text = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => undefined);
  // The command name may contain spaces and parentheses; fields resume after the last ')'.
  return text?.slice(text.lastIndexOf(')') + 2).split(' ')[19];
}

/** `<pid> <start time> <nonce>`: this process, even across pid reuse, and this acquisition. */
async function record() {
  return `${process.pid} ${(await startTime(process.pid)) ?? 'unknown'} ${randomBytes(8).toString('hex')}\n`;
}

/** Whether a holder record names a process that is still the same live process. @param {string} text */
async function alive(text) {
  const [pidText, started] = text.trim().split(' ');
  const pid = Number(pidText);
  return Number.isInteger(pid) && pid > 0 && started !== undefined && started !== 'unknown' && (await startTime(pid)) === started;
}

/**
 * One lock directory `<dir>/<name>`.
 */
export class DirectoryLock {
  /** @param {string} dir @param {string} name */
  constructor(dir, name) {
    this.dir = dir;
    this.name = name;
    this.path = join(dir, name);
  }

  /** @param {string} path */
  holder(path) {
    return readFile(join(path, 'holder'), 'utf8').catch(() => undefined);
  }

  /**
   * Put a prepared lock in place; `false` when another lock already holds the name.
   * @param {string} path @param {string} mine
   */
  async acquire(path, mine) {
    const prepared = await mkdtemp(join(this.dir, `${this.name}.new-`));
    try {
      await writeFile(join(prepared, 'holder'), mine);
      await rename(prepared, path);
      return true;
    } catch (error) {
      await rm(prepared, {recursive: true, force: true});
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      if (code === 'EEXIST' || code === 'ENOTEMPTY' || code === 'ENOTDIR') return false;
      throw error;
    }
  }

  /**
   * Rename a lock aside and delete it if it still names `holder`, else put it back. With `bury`, a dead holder's
   * lock goes to a name derived from its record and stays there for a minute, so an operation that read the same
   * record late finds that name taken and moves nothing, not even a live lock that replaced it.
   * @param {string} path @param {string | undefined} holder @param {boolean} [bury]
   */
  async tombstone(path, holder, bury = false) {
    const aside = join(this.dir, `${this.name}.dead-${bury && holder !== undefined ? createHash('sha256').update(holder).digest('hex').slice(0, 32) : randomBytes(8).toString('hex')}`);
    if (bury) {
      const now = new Date();
      await utimes(path, now, now).catch(() => undefined);
    }
    try {
      await rename(path, aside);
    } catch {
      // Already gone, or buried by an operation that read the same record, which leaves a newer lock alone.
      return;
    }
    if ((await this.holder(aside)) !== holder) {
      try {
        await rename(aside, path);
        return;
      } catch {
        // Taken again meanwhile; its holder's fencing refuses to write.
      }
    } else if (bury) return;
    await rm(aside, {recursive: true, force: true});
  }

  /**
   * Remove a dead holder's lock, and only that lock, under a breaker lock: while it is held nothing else can replace
   * the main lock, so a lock that still names the dead holder is exactly the one removed.
   * @param {string | undefined} dead
   */
  async breakDead(dead) {
    const breaker = `${this.path}.break`;
    const me = await record();
    if (!(await this.acquire(breaker, me))) {
      const other = await this.holder(breaker);
      if (other !== undefined && !(await alive(other))) await this.tombstone(breaker, other, true);
      else if (other === undefined) {
        const info = await stat(breaker).catch(() => undefined);
        if (info && Date.now() - info.mtimeMs > HOLDERLESS_MS) await this.tombstone(breaker, undefined);
      }
      return;
    }
    try {
      if ((await this.holder(this.path)) === dead) await this.tombstone(this.path, dead, dead !== undefined);
    } finally {
      if ((await this.holder(breaker)) === me) await this.tombstone(breaker, me);
    }
  }

  /** Remove prepared or set-aside lock directories a killed process left, once they are a minute old. */
  async sweep() {
    for (const entry of await readdir(this.dir).catch(() => /** @type {string[]} */ ([]))) {
      if (!entry.startsWith(`${this.name}.new-`) && !entry.startsWith(`${this.name}.dead-`)) continue;
      const info = await stat(join(this.dir, entry)).catch(() => undefined);
      if (info && Date.now() - info.mtimeMs > 60000) await rm(join(this.dir, entry), {recursive: true, force: true});
    }
  }

  /**
   * Run `work` while holding the lock. `work` receives `stillHeld()`, which a writer checks right before writing.
   * @template T @param {(stillHeld: () => Promise<boolean>) => Promise<T>} work @returns {Promise<T>}
   */
  async run(work) {
    if (!existsSync(this.dir)) throw new Error('the lock directory does not exist');
    const mine = await record();
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      if (await this.acquire(this.path, mine)) break;
      const holder = await this.holder(this.path);
      if (holder === undefined) {
        const info = await stat(this.path).catch(() => undefined);
        if (info && Date.now() - info.mtimeMs > HOLDERLESS_MS) await this.breakDead(undefined);
      } else if (!(await alive(holder))) await this.breakDead(holder);
      if (Date.now() > deadline) throw new LockedError(`another operation held ${this.name} for ${WAIT_MS / 1000} s; retry when it finishes`);
      await pause(10 + Math.floor(Math.random() * 20));
    }
    await this.sweep();
    try {
      return await work(async () => (await this.holder(this.path)) === mine);
    } finally {
      if ((await this.holder(this.path)) === mine) await this.tombstone(this.path, mine);
    }
  }
}
