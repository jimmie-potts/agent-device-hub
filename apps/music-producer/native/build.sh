#!/bin/sh
set -eu
native_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$(uname -s)" != Darwin ]; then
  echo 'The Music capture adapter requires macOS; use native/test.sh for portable signal checks.' >&2
  exit 1
fi
sdk_version=$(xcrun --sdk macosx --show-sdk-version)
sdk_major=${sdk_version%%.*}
case "$sdk_major" in ''|*[!0-9]*) echo 'Cannot determine the macOS SDK version.' >&2; exit 1;; esac
if [ "$sdk_major" -lt 26 ]; then
  echo 'The Music capture source requires macOS SDK 26 or later.' >&2
  exit 1
fi
build_dir="$native_dir/build"
mkdir -p "$build_dir"
xcrun clang -std=c11 -fobjc-arc -O2 -Wall -Wextra -Werror \
  -mmacosx-version-min=14.2 -framework Foundation -framework CoreAudio -framework AVFoundation \
  -Wl,-sectcreate,__TEXT,__info_plist,"$native_dir/Info.plist" \
  "$native_dir/music_signal.c" "$native_dir/main.m" -o "$build_dir/music-capture"
xcrun clang -std=c11 -fobjc-arc -O2 -Wall -Wextra -Werror \
  -mmacosx-version-min=14.2 -framework AppKit -framework CoreServices \
  -Wl,-sectcreate,__TEXT,__info_plist,"$native_dir/PositionInfo.plist" \
  "$native_dir/position.m" -o "$build_dir/music-position"
