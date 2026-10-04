#!/usr/bin/env bash
# Fetch the pinned upstream sources the ARM build needs into .upstream/.
#
#   chompi/    CHOMPI-Club/CHOMPI at the open-source bundle commit: the
#              prebuilt libDaisy (libdaisy.a, headers, startup file) that the
#              stock firmwares and the launcher link against.
#   launcher/  sfaber02/CHOMPI launcher-v1.1: the app linker script with the
#              BACKUP_SRAM fix, plus the launcher sources the board layer was
#              adapted from, kept for reference.
#
# Downloads are shallow, blobless and sparse, so only the listed paths are
# transferred. Each checkout is verified against its pinned commit, and git
# verifies every object hash on the way in. Safe to rerun.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="${UPSTREAM_DIR:-$here/.upstream}"

CHOMPI_REPO="https://github.com/CHOMPI-Club/CHOMPI.git"
CHOMPI_SHA="a73d732613da684e4de844619b690776f0f50ccf"
LAUNCHER_REPO="https://github.com/sfaber02/CHOMPI.git"
LAUNCHER_SHA="79ea9e7e18f1ca6057ce35ae1a3a17d47f8a4415"

LIBDAISY="firmware/chompi-wave/code/libs/libDaisy"
CHOMPI_PATHS=(
  "/LICENSE"
  "/THIRD_PARTY.md"
  "/TRADEMARKS.md"
  "/$LIBDAISY/LICENSE"
  "/$LIBDAISY/core/"
  "/$LIBDAISY/src/"
  "/$LIBDAISY/build/libdaisy.a"
  "/$LIBDAISY/Drivers/CMSIS/Include/"
  "/$LIBDAISY/Drivers/CMSIS/DSP/Include/"
  "/$LIBDAISY/Drivers/CMSIS/Device/ST/STM32H7xx/Include/"
  "/$LIBDAISY/Drivers/STM32H7xx_HAL_Driver/Inc/"
  "/$LIBDAISY/Middlewares/ST/STM32_USB_Device_Library/Core/Inc/"
  "/$LIBDAISY/Middlewares/ST/STM32_USB_Host_Library/Core/Inc/"
  "/$LIBDAISY/Middlewares/ST/STM32_USB_Host_Library/Class/MSC/Inc/"
  "/$LIBDAISY/Middlewares/Third_Party/FatFs/src/*.h"
)
LAUNCHER_PATHS=(
  "/LICENSE"
  "/THIRD_PARTY.md"
  "/firmware/chompi-launcher/code/src/"
)

die() {
  echo "fetch-upstream: $*" >&2
  exit 1
}

command -v git >/dev/null 2>&1 || die "git is required"

fetch() {
  local name="$1" repo="$2" sha="$3"
  shift 3
  local dir="$dest/$name"

  if [ -d "$dir/.git" ] && [ "$(git -C "$dir" rev-parse HEAD 2>/dev/null)" = "$sha" ] \
     && git -C "$dir" diff --quiet HEAD 2>/dev/null; then
    echo "fetch-upstream: $name already at $sha"
    return
  fi

  echo "fetch-upstream: fetching $name $sha"
  rm -rf "$dir"
  mkdir -p "$dir"
  git -C "$dir" init -q
  git -C "$dir" remote add origin "$repo"
  git -C "$dir" config core.sparseCheckout true
  printf '%s\n' "$@" > "$dir/.git/info/sparse-checkout"
  git -C "$dir" fetch -q --depth 1 --filter=blob:none origin "$sha"
  git -C "$dir" checkout -q --detach FETCH_HEAD

  local actual
  actual="$(git -C "$dir" rev-parse HEAD)"
  [ "$actual" = "$sha" ] || die "$name: expected $sha, got $actual"
}

mkdir -p "$dest"
rm -f "$dest/VERIFIED"

fetch chompi "$CHOMPI_REPO" "$CHOMPI_SHA" "${CHOMPI_PATHS[@]}"
fetch launcher "$LAUNCHER_REPO" "$LAUNCHER_SHA" "${LAUNCHER_PATHS[@]}"

# Spot-check the files the build depends on.
for f in \
  "$dest/chompi/$LIBDAISY/build/libdaisy.a" \
  "$dest/chompi/$LIBDAISY/core/startup_stm32h750xx.c" \
  "$dest/chompi/$LIBDAISY/src/daisy_seed.h" \
  "$dest/launcher/firmware/chompi-launcher/code/src/chompi_sram.lds"; do
  [ -s "$f" ] || die "missing $f"
done
grep -q 'BACKUP_SRAM (RWX) : ORIGIN = 0x38800000' \
  "$dest/launcher/firmware/chompi-launcher/code/src/chompi_sram.lds" \
  || die "launcher linker script lacks the BACKUP_SRAM region"

{
  echo "chompi $CHOMPI_SHA"
  echo "launcher $LAUNCHER_SHA"
} > "$dest/VERIFIED"
echo "fetch-upstream: verified, recorded in $dest/VERIFIED"
du -sh "$dest/chompi" "$dest/launcher" 2>/dev/null || true
