#!/usr/bin/env bash
# npm uses its regular script shell. Only the owning command's `node --test` gains a second reporter.
# Restore PATH before starting the test process so simulator children and nested Node commands run normally.
if [[ ${1:-} == --test ]]; then
  actual_path=":$PATH:"
  actual_path=${actual_path/":$BUNNY_CI_NODE_BIN:"/:}
  actual_path=${actual_path#:}
  export PATH=${actual_path%:}
  # User or suite reporter options already pair reporters and destinations. Preserve that complete configuration.
  if [[ ${NODE_OPTIONS:-} == *--test-reporter* ]]; then exec "$BUNNY_CI_ORIGINAL_NODE" "$@"; fi
  for arg in "$@"; do
    if [[ $arg == --test-reporter* ]]; then exec "$BUNNY_CI_ORIGINAL_NODE" "$@"; fi
  done
  exec "$BUNNY_CI_ORIGINAL_NODE" --test-reporter=spec --test-reporter-destination=stdout \
    "--test-reporter=$BUNNY_CI_NODE_REPORTER" --test-reporter-destination=stdout "$@"
fi
exec "$BUNNY_CI_ORIGINAL_NODE" "$@"
