#!/bin/sh
set -eu
native_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$(uname -s)" != Darwin ]; then
  echo 'The Music capture adapter requires macOS; use native/test.sh for portable signal checks.' >&2
  exit 1
fi
build_dir="$native_dir/build"
mkdir -p "$build_dir"
xcrun clang -std=c11 -fobjc-arc -O2 -Wall -Wextra -Werror \
  -mmacosx-version-min=14.2 -framework Foundation -framework CoreAudio \
  -Wl,-sectcreate,__TEXT,__info_plist,"$native_dir/Info.plist" \
  "$native_dir/music_signal.c" "$native_dir/main.m" -o "$build_dir/music-capture"
