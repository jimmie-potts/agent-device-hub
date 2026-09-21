import {DatabaseSync} from 'node:sqlite';
import {constants} from 'node:fs';
import {lstat, realpath, open} from 'node:fs/promises';
import {resolve, join, dirname} from 'node:path';
import {validateExport, type Storage, type StorageLease, type DurableState, type Commit} from '@jimmie-potts/agent-state';

/** The caller creates a private directory. This adapter never opens a controller store. */
export class HubStorage implements Storage {
  constructor(readonly directory: string) {}

  async acquire(ownerId: string, signal: AbortSignal): Promise<StorageLease> {
    signal.throwIfAborted();
    if (process.platform !== 'linux' || !/^[A-Za-z0-9_.-]{1,128}$/.test(ownerId)) throw new Error('invalid-store');
    const directory = resolve(this.directory);
    const info = await lstat(directory);
    if (directory !== this.directory || directory === '/mnt' || directory.startsWith('/mnt/') ||
        await realpath(directory) !== directory || !info.isDirectory() || info.isSymbolicLink() ||
        (info.mode & 0o077) !== 0 || info.uid !== process.getuid!()) throw new Error('invalid-store');
    // Runtime state belongs outside every source checkout.
    for (let parent = directory;; parent = dirname(parent)) {
      try {
        const marker = await lstat(join(parent, '.git'));
        if (marker.isFile()) throw new Error('store-in-checkout');
        await lstat(join(parent, '.git', 'HEAD'));
        throw new Error('store-in-checkout');
      }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (parent === dirname(parent)) break;
    }
    for (const name of ['owner.sqlite', 'state.sqlite']) {
      const file = await open(join(directory, name), constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid!()) throw new Error('invalid-store');
      } finally { await file.close(); }
    }
    signal.throwIfAborted();
    let lock: DatabaseSync | undefined, db: DatabaseSync | undefined;
    try {
      lock = new DatabaseSync(join(directory, 'owner.sqlite'));
      lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');
      db = new DatabaseSync(join(directory, 'state.sqlite'));
      db.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS fence (id INTEGER PRIMARY KEY CHECK(id=1), active INTEGER NOT NULL CHECK(active IN (0,1)))');
      let released = false;
      const check = (abort?: AbortSignal) => { abort?.throwIfAborted(); if (released) throw new Error('store-released'); };
      const load = (): DurableState | null => {
        const row = db!.prepare('SELECT payload FROM state WHERE id=1').get();
        if (!row) return null;
        if (typeof row.payload !== 'string' || Buffer.byteLength(row.payload) > 16 * 1024 * 1024) throw new Error('invalid-state');
        const checked = validateExport(JSON.parse(row.payload));
        if (!checked.ok || checked.value.ownerId !== ownerId) throw new Error('invalid-state');
        return checked.value;
      };
      const commit = (change: Commit, abort: AbortSignal) => {
        check(abort);
        db!.exec('BEGIN IMMEDIATE');
        try {
          const old = load();
          if ((old?.revision ?? null) !== change.expectedRevision) throw new Error('revision-conflict');
          let next: DurableState;
          if (change.replace) next = structuredClone(change.replace);
          else {
            if (!old) throw new Error('missing-state');
            next = old;
            if (change.session) {
              const key = (identity: DurableState['sessions'][number]['identity']) => JSON.stringify([identity.provider,identity.client,identity.hostId,identity.sourceId,identity.sessionId]);
              const index = next.sessions.findIndex(s => key(s.identity) === key(change.session!.identity));
              if (index < 0) next.sessions.push(structuredClone(change.session));
              else next.sessions[index] = structuredClone(change.session);
            }
            if (change.journal) next.journal.push(structuredClone(change.journal));
            next.revision = change.revision; next.lastCommitAtMs = change.atMs;
          }
          next.journal = next.journal.filter(row => row.atMs > change.pruneBeforeMs).slice(-10000);
          const checked = validateExport(next);
          if (!checked.ok || next.ownerId !== ownerId || next.revision !== change.revision) throw new Error('invalid-state');
          const payload = JSON.stringify(next);
          if (Buffer.byteLength(payload) > 16 * 1024 * 1024) throw new Error('state-capacity');
          check(abort);
          db!.prepare('INSERT INTO state VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload').run(next.revision, payload);
          db!.exec('COMMIT');
        } catch (error) { db!.exec('ROLLBACK'); throw error; }
      };
      const lease: HubLease = {
        load: async abort => { check(abort); return load(); },
        commit: async (change, abort) => commit(change, abort),
        fenced: () => { check(); return db!.prepare('SELECT active FROM fence WHERE id=1').get()?.active === 1; },
        setFence: active => { check(); db!.prepare('INSERT INTO fence VALUES(1,?) ON CONFLICT(id) DO UPDATE SET active=excluded.active').run(active ? 1 : 0); },
        release: async () => {
          if (released) return;
          db!.close(); lock!.exec('ROLLBACK'); lock!.close(); released = true;
        }
      };
      return lease;
    } catch {
      try { db?.close(); } catch {}
      try { lock?.close(); } catch {}
      throw new Error('storage-unavailable');
    }
  }
}

export interface HubLease extends StorageLease {
  fenced(): boolean;
  setFence(active: boolean): void;
}
