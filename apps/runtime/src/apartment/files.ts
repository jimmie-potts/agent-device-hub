import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {link, open, rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';

export async function syncApartmentDirectory(path: string): Promise<void> {
  const directory = await open(path,constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await directory.sync(); } finally { await directory.close(); }
}

/** Use the target directory so activation needs one filesystem operation. */
export async function stageApartmentFile(file: string, bytes: Uint8Array): Promise<string> {
  const temporary = join(dirname(file),'.apartment-' + randomUUID() + '.tmp');
  const handle = await open(temporary,'wx',0o600);
  try {
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
  } catch (error) {
    await rm(temporary,{force:true}).catch(() => {});
    throw error;
  }
  return temporary;
}

/** The hard link creates the name exclusively, then the staging name is removed before success. */
export async function writeApartmentCandidate(file: string, bytes: Uint8Array): Promise<void> {
  const temporary = await stageApartmentFile(file,bytes);
  try { await link(temporary,file); }
  finally { await rm(temporary,{force:true}); }
  await syncApartmentDirectory(dirname(file));
}
