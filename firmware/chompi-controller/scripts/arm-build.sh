#!/usr/bin/env bash
# Build and check the ARM artifact with the pinned toolchain. Uses ARM_GCC_BIN
# when set; otherwise downloads GNU Arm Embedded Toolchain 10.3-2021.10 into
# the user cache once and verifies its SHA-256 before extracting.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
tc=gcc-arm-none-eabi-10.3-2021.10
sha=97dbb4f019ad1650b732faffcc881689cedc14e2b7ee863d390e0a41ef16c9a3
cache=${XDG_CACHE_HOME:-$HOME/.cache}
if [ -z "${ARM_GCC_BIN:-}" ]; then
  if [ ! -x "$cache/$tc/bin/arm-none-eabi-gcc" ]; then
    mkdir -p "$cache"
    archive=$(mktemp "$cache/$tc.XXXXXX.tar.bz2")
    trap 'rm -f "$archive"' EXIT
    curl -fsSL --retry 3 -o "$archive" \
      "https://developer.arm.com/-/media/Files/downloads/gnu-rm/10.3-2021.10/$tc-x86_64-linux.tar.bz2"
    echo "$sha  $archive" | sha256sum -c -
    tar -xjf "$archive" -C "$cache"
  fi
  ARM_GCC_BIN="$cache/$tc/bin"
fi
"$here/scripts/fetch-upstream.sh"
make -C "$here" check -j"$(nproc)" ARM_GCC_BIN="$ARM_GCC_BIN"
