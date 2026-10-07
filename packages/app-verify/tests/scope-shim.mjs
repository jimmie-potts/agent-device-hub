// A systemctl and a systemd-run for a test's PATH that scope the one-run guard (Hub #944) to one test's apps.
//
// The guard reads the whole host and holds one host-wide claim unit, and another session may have a run or a start
// in flight while a suite runs. With this shim a guarded command lists only `app-verify-<tag>-*` run units and takes a
// claim named `app-verify-start-claim-<tag>`. Every other call reaches the real program unchanged. Each call is
// appended to `calls.log` beside the shim, as `<program> <arguments>` after scoping, so a test can assert the order of
// the guard's calls (`callsOf`). Two faults can be injected: `blind` makes the unit listing fail, and `noclaim` makes
// `systemd-run` refuse to create the claim unit.
import {spawnSync} from 'node:child_process';
import {chmod, mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const real = name => spawnSync('sh', ['-c', `command -v ${name}`], {encoding: 'utf8'}).stdout.trim();

/** Write the shims into `dir` and return the PATH that puts them first. */
export async function scopeShim(dir, tag, {blind = false, noclaim = false} = {}) {
  await mkdir(dir, {recursive: true});
  for (const name of ['systemctl', 'systemd-run']) {
    const listing = blind ? 'echo "simulated: units cannot be listed" >&2; exit 1' : `a='app-verify-${tag}-*.service'`;
    const claim = noclaim ? `case "$a" in --unit=*) echo "simulated: the claim unit cannot be created" >&2; exit 1 ;; esac; ` : '';
    await writeFile(join(dir, name), [
      '#!/bin/sh',
      'n=$#',
      'i=0',
      'while [ "$i" -lt "$n" ]; do',
      '  a=$1; shift; i=$((i+1))',
      '  case "$a" in',
      `    'app-verify-*.service') ${listing} ;;`,
      `    *app-verify-start-claim*) a=$(printf '%s' "$a" | sed 's/app-verify-start-claim/app-verify-start-claim-${tag}/'); ${claim}: ;;`,
      '  esac',
      '  set -- "$@" "$a"',
      'done',
      `echo "\${0##*/} $*" >> "\${0%/*}/calls.log"`,
      `exec ${real(name)} "$@"`,
      '',
    ].join('\n'));
    await chmod(join(dir, name), 0o755);
  }
  return `${dir}:${process.env.PATH}`;
}

/** The calls a shim in `dir` has logged so far, oldest first, as `<program> <arguments>`. */
export async function callsOf(dir) {
  return (await readFile(join(dir, 'calls.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean);
}
