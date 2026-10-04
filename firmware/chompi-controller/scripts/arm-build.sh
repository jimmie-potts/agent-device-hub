#!/usr/bin/env bash
# Build and check the ARM artifact with the pinned toolchain. Uses ARM_GCC_BIN
# when set; otherwise downloads GNU Arm Embedded Toolchain 10.3-2021.10 into
# the user cache once and verifies its SHA-256 before extracting.
#
# The archive is extracted into a temporary directory under the cache and moved
# into place with one rename, after a completion marker is written. An
# interrupted download or extraction therefore never leaves a toolchain that a
# later run would trust; a cache entry without the marker is rebuilt.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
tc=gcc-arm-none-eabi-10.3-2021.10
sha=97dbb4f019ad1650b732faffcc881689cedc14e2b7ee863d390e0a41ef16c9a3
url="https://developer.arm.com/-/media/Files/downloads/gnu-rm/10.3-2021.10/$tc-x86_64-linux.tar.bz2"
cache=${XDG_CACHE_HOME:-$HOME/.cache}
dest="$cache/$tc"
marker=".agent-device-hub-complete"

if [ -z "${ARM_GCC_BIN:-}" ]; then
  if [ ! -f "$dest/$marker" ] || [ "$(cat "$dest/$marker")" != "$sha" ]; then
    mkdir -p "$cache"
    work=$(mktemp -d "$cache/$tc.partial.XXXXXX")
    trap 'rm -rf "$work"' EXIT
    curl -fsSL --retry 3 -o "$work/archive.tar.bz2" "$url"
    echo "$sha  $work/archive.tar.bz2" | sha256sum -c -
    tar -xjf "$work/archive.tar.bz2" -C "$work"
    "$work/$tc/bin/arm-none-eabi-gcc" --version | head -n 1 | grep -q '10.3-2021.10'
    echo "$sha" > "$work/$tc/$marker"
    # Drop an unmarked leftover (an older in-place extraction), then rename.
    if [ -e "$dest" ] && [ ! -f "$dest/$marker" ]; then
      rm -rf "$dest"
    fi
    if ! mv -T "$work/$tc" "$dest" 2>/dev/null; then
      # Another run finished first; accept its result only if complete.
      [ "$(cat "$dest/$marker" 2>/dev/null)" = "$sha" ] \
        || { echo "arm-build: could not install toolchain at $dest" >&2; exit 1; }
    fi
  fi
  ARM_GCC_BIN="$dest/bin"
fi
"$here/scripts/fetch-upstream.sh"
make -C "$here" check -j"$(nproc)" ARM_GCC_BIN="$ARM_GCC_BIN"
