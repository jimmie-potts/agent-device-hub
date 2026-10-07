#!/bin/bash
# Run a command that uses apt on a hosted runner, such as a browser install with --with-deps, and retry an attempt that
# stalls in apt (Hub #862). Usage: bash scripts/apt-retry.sh <seconds per attempt> <command...>
if [ "${GITHUB_ACTIONS:-}" != true ]; then
  echo "apt-retry.sh changes apt's global configuration and stops every apt-get, so it runs only on a GitHub Actions runner." >&2
  exit 2
fi
if [ $# -lt 2 ] || [[ ! $1 =~ ^[1-9][0-9]*$ ]]; then
  echo "Usage: bash scripts/apt-retry.sh <seconds per attempt> <command...>" >&2
  exit 2
fi
attempt_seconds=$1 lock_wait_seconds=60 mirror_list=/etc/apt/apt-mirrors.txt
shift
# The runner image makes apt drop a connection that receives nothing for 15 s, retry it once and then fall back to the
# next mirror in its mirror list (runner-images configure-apt.sh), so this script sets no apt option. A download that
# still receives data, however slowly, never times out; only the attempt limit stops it. Packages an attempt finished
# stay in apt's cache, and the next attempt resumes a partial download from the mirror with the lowest priority number,
# which, unless the list changes, is the mirror that stalled.
for attempt in 1 2 3; do
  if timeout --kill-after=10 "$attempt_seconds" "$@"; then exit 0; fi
  echo "::warning::Attempt $attempt of 3 failed or ran past $attempt_seconds s"
  # An apt-get started through sudo can outlive a timed-out attempt and keep apt's locks. Stop it, let a running dpkg
  # finish, then complete whatever configuration an interrupted install left.
  sudo pkill -x apt-get
  timeout "$lock_wait_seconds" bash -c 'while pgrep -x "apt-get|dpkg" >/dev/null; do sleep 1; done'
  sudo dpkg --configure -a
  # Give the mirror apt tries first a priority number above every other mirror's, so the next attempt starts on another
  # mirror and can still fall back to this one. awk prints the demoted mirror, then the new list.
  if [ -f "$mirror_list" ] && demoted=$(awk '
    { line[NR] = $0 }
    !/^[[:space:]]*#/ && match($0, /priority:[0-9]+/) {
      p = substr($0, RSTART + 9, RLENGTH - 9) + 0
      if (!n++ || p < low) { low = p; first = NR; uri = $1 }
      if (p > high) high = p
    }
    END {
      if (n < 2) exit 1
      sub(/priority:[0-9]+/, "priority:" (high + 1), line[first])
      print uri
      for (i = 1; i <= NR; i++) print line[i]
    }' "$mirror_list"); then
    printf '%s\n' "${demoted#*$'\n'}" | sudo tee "$mirror_list" >/dev/null
    echo "apt now tries ${demoted%%$'\n'*} after its other mirrors"
  fi
done
exit 1
