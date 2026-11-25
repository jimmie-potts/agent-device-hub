import {chmod, mkdir, mkdtemp, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/**
 * Where a journey's output directories go: DASHBOARD_RECEIPTS when the caller keeps receipts, else TEST_EVIDENCE_DIR,
 * which hosted CI sets so that a failed job uploads what its journeys wrote (#2059), else the system temporary folder.
 */
export function browserArtifactParent(env: NodeJS.ProcessEnv = process.env): string {
  return env.DASHBOARD_RECEIPTS ?? env.TEST_EVIDENCE_DIR ?? tmpdir();
}

export async function browserArtifactDirectory(parent = browserArtifactParent()): Promise<string> {
  await mkdir(parent, {recursive: true, mode: 0o700});
  const directory = await mkdtemp(join(parent, 'bunny-browser-proof-'));
  await chmod(directory, 0o700);
  return realpath(directory);
}
