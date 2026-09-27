import {existsSync} from 'node:fs';
import type {CheckRecord, Receipt} from './types.js';
import {exec, which} from './util.js';

/** Candidate label for the card: short revision and clean/dirty, or unknown. */
export function candidateLabel(build: Receipt['build']): string {
  if (build.sourceRevision === 'unknown') return 'unknown (dirty)';
  return `${build.sourceRevision.slice(0, 8)} (${build.dirty ? 'dirty' : 'clean'})`;
}

function remaining(expiresAt: string, now: number): string {
  const minutes = Math.round((Date.parse(expiresAt) - now) / 60000);
  if (minutes <= 0) return 'expired';
  const hours = Math.floor(minutes / 60);
  return `in ${hours ? `${hours} h ` : ''}${minutes % 60} min`;
}

/** The preview card: URL, run, candidate, scenario, expiry and how to extend or stop. */
export function card(receipt: Receipt, command: string, now = Date.now()): string[] {
  const url = receipt.preview?.url ?? '(not serving)';
  const expires = receipt.preview ? `${receipt.preview.expiresAt.replace('T', ' ')} (${remaining(receipt.preview.expiresAt, now)})` : 'no lease';
  return [
    `Preview   ${url}   run ${receipt.runId}`,
    `Candidate ${candidateLabel(receipt.build)}   scenario ${receipt.scenario.name}`,
    `Expires   ${expires}`,
    `Extend    ${command} extend ${receipt.runId}`,
    `Stop      ${command} stop ${receipt.runId}`,
  ];
}

/**
 * Windows reachability of a loopback port through WSL interop, with `curl.exe`.
 * `skipped` without interop, `passed` for any HTTP answer, `failed` otherwise.
 */
export async function windowsLoopback(port: number, env: Readonly<Record<string, string | undefined>>): Promise<CheckRecord> {
  const id = 'windows-loopback';
  if (env.APP_VERIFY_WINDOWS_CHECK === 'off') return {id, outcome: 'skipped', reason: 'disabled by APP_VERIFY_WINDOWS_CHECK=off'};
  const interop = existsSync('/proc/sys/fs/binfmt_misc/WSLInterop') || existsSync('/proc/sys/fs/binfmt_misc/WSLInterop-late');
  if (!interop) return {id, outcome: 'skipped', reason: 'interop unavailable'};
  const curl = which('curl.exe', env.PATH ?? '', '/') ?? (existsSync('/mnt/c/Windows/System32/curl.exe') ? '/mnt/c/Windows/System32/curl.exe' : undefined);
  if (!curl) return {id, outcome: 'skipped', reason: 'curl.exe unavailable'};
  const result = await exec(curl, ['-s', '-o', 'NUL', '-w', '%{http_code}', '--max-time', '5', `http://127.0.0.1:${port}/`], {timeoutMs: 15000, cwd: '/'});
  const status = result.stdout.trim();
  if (/^[1-5]\d\d$/.test(status)) return {id, outcome: 'passed'};
  return {id, outcome: 'failed', reason: `Windows curl.exe got no HTTP answer on 127.0.0.1:${port} (${status || result.error || `exit ${result.code}`})`};
}
