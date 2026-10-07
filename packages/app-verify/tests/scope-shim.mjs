// A systemctl and a systemd-run for a test's PATH that scope the one-run guard (Hub #944) to one test's apps.
//
// The guard reads the whole host and holds one host-wide claim unit, and another session may have a run or a start
// in flight while a suite runs. With this shim a guarded command lists only `app-verify-<tag>-*` run units and takes a
// claim named `app-verify-start-claim-<tag>`; `blind` makes the unit listing fail instead. Every other call reaches the
// real program unchanged.
import {spawnSync} from 'node:child_process';
import {chmod, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const real = name => spawnSync('sh', ['-c', `command -v ${name}`], {encoding: 'utf8'}).stdout.trim();

/** Write the shims into `dir` and return the PATH that puts them first. */
export async function scopeShim(dir, tag, {blind = false} = {}) {
  await mkdir(dir, {recursive: true});
  for (const name of ['systemctl', 'systemd-run']) {
    const listing = blind ? 'exit 1' : `a='app-verify-${tag}-*.service'`;
    await writeFile(join(dir, name), [
      '#!/bin/sh',
      'n=$#',
      'i=0',
      'while [ "$i" -lt "$n" ]; do',
      '  a=$1; shift; i=$((i+1))',
      '  case "$a" in',
      `    'app-verify-*.service') ${listing} ;;`,
      `    *app-verify-start-claim*) a=$(printf '%s' "$a" | sed 's/app-verify-start-claim/app-verify-start-claim-${tag}/') ;;`,
      '  esac',
      '  set -- "$@" "$a"',
      'done',
      `exec ${real(name)} "$@"`,
      '',
    ].join('\n'));
    await chmod(join(dir, name), 0o755);
  }
  return `${dir}:${process.env.PATH}`;
}
