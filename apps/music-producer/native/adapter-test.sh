#!/bin/sh
set -eu
native_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/bunny-music-adapter.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM
xcrun clang -std=c11 -fobjc-arc -O2 -Wall -Wextra -Werror \
  -mmacosx-version-min=14.2 -framework Foundation -framework CoreAudio \
  "$native_dir/music_signal.c" "$native_dir/tests/adapter.m" -o "$test_dir/fake-adapter"
python3 "$native_dir/tests/adapter.py" "$test_dir/fake-adapter"
