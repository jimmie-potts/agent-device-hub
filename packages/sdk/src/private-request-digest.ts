import {createHash, createHmac, randomBytes} from 'node:crypto';
import {closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError} from './sdk.js';
import {fullDisk} from './database.js';

const refused = (): never => {throw new SdkError(errorBody('unavailable', {detail: 'the private request identity is unavailable'}));};

/** Private semantic identity for memory-only input. The owner holds its normal database/file lease. */
export class PrivateRequestDigest {
  constructor(readonly database: DatabaseSync, readonly folder: () => string) {
    database.exec('CREATE TABLE IF NOT EXISTS bunny_private_request_key (id INTEGER PRIMARY KEY CHECK(id = 1), digest TEXT NOT NULL) STRICT');
  }

  /** Admission transaction only. Initialization requires proof that no old sensitive fence exists. */
  digest(domain: string, canonical: string, initialize: boolean): string {
    if (!this.database.isTransaction) return refused();
    const pin = this.database.prepare('SELECT digest FROM bunny_private_request_key WHERE id = 1').get() as {digest: string} | undefined;
    if (pin === undefined && !initialize) return refused();
    let key: Buffer | undefined;
    try {
      const folder = this.folder(), directory = lstatSync(folder);
      const uid = process.getuid?.();
      if (uid === undefined || !directory.isDirectory() || directory.uid !== uid || (directory.mode & 0o777) !== 0o700) return refused();
      const path = join(folder, 'request-digest.key');
      if (pin === undefined) {
        let fd: number | undefined;
        try {
          fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          const fresh = randomBytes(32);
          try {writeFileSync(fd, fresh); fsyncSync(fd);} finally {fresh.fill(0);}
        } catch (error) {
          if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')) throw error;
        } finally {if (fd !== undefined) closeSync(fd);}
      }
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = fstatSync(fd);
        if (!info.isFile() || info.uid !== uid || info.nlink !== 1 || (info.mode & 0o777) !== 0o600 || info.size !== 32) return refused();
        key = readFileSync(fd);
      } finally {closeSync(fd);}
      if (key.length !== 32) return refused();
      const identity = createHash('sha256').update(key).digest('hex');
      if (pin !== undefined && pin.digest !== identity) return refused();
      if (pin === undefined) this.database.prepare('INSERT INTO bunny_private_request_key VALUES (1, ?)').run(identity);
      return createHmac('sha256', key).update(domain).update('\0').update(canonical).digest('hex');
    } catch (error) {
      if (fullDisk(error)) throw new SdkError(errorBody('capacity', {detail: 'private request identity storage is full'}));
      return refused();
    }
    finally {key?.fill(0);}
  }
}
