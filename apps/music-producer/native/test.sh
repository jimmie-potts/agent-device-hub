#!/bin/sh
set -eu
native_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/bunny-music-native.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM
${CC:-cc} -std=c11 -O2 -Wall -Wextra -Werror -pedantic \
  -I"$native_dir" "$native_dir/music_signal.c" "$native_dir/tests/signal.c" \
  -lm -pthread -o "$test_dir/signal-test"
"$test_dir/signal-test"
