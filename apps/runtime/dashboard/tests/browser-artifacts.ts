import {chmod, mkdir, mkdtemp, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export async function browserArtifactDirectory(parent = process.env.DASHBOARD_RECEIPTS ?? tmpdir()): Promise<string> {
  await mkdir(parent, {recursive: true, mode: 0o700});
  const directory = await mkdtemp(join(parent, 'bunny-browser-proof-'));
  await chmod(directory, 0o700);
  return realpath(directory);
}
