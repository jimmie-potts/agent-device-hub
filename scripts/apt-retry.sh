#!/bin/bash
# Run a command that uses apt on a hosted runner, such as a browser install with --with-deps, and retry an attempt that
# stalls in apt (Hub #862). Usage: bash scripts/apt-retry.sh <seconds per attempt> <command...>
if [ "${GITHUB_ACTIONS:-}" != true ]; then
  echo "apt-retry.sh changes apt's global configuration and stops every apt-get, so it runs only on a GitHub Actions runner." >&2
  exit 2
fi
if [ $# -lt 2 ] || [[ ! $1 =~ ^[0-9]+$ ]]; then
  echo "Usage: bash scripts/apt-retry.sh <seconds per attempt> <command...>" >&2
  exit 2
fi
attempt_seconds=$1 lock_wait_seconds=60
shift
# apt drops a connection or download that receives nothing for 30 s and retries it. A download that is slow but still
# receiving data, or a fetch that hangs some other way, is bounded only by the attempt limit; packages an attempt
# finished stay in apt's cache for the next one.
printf '%s\n' 'Acquire::Retries "3";' 'Acquire::http::Timeout "30";' 'Acquire::https::Timeout "30";' |
  sudo tee /etc/apt/apt.conf.d/80-ci-apt-retry >/dev/null
for attempt in 1 2 3; do
  if timeout --kill-after=10 "$attempt_seconds" "$@"; then exit 0; fi
  echo "::warning::Attempt $attempt of 3 failed or ran past $attempt_seconds s"
  # An apt-get started through sudo can outlive a timed-out attempt and keep apt's locks. Stop it, let a running dpkg
  # finish, then complete whatever configuration an interrupted install left.
  sudo pkill -x apt-get
  timeout "$lock_wait_seconds" bash -c 'while pgrep -x "apt-get|dpkg" >/dev/null; do sleep 1; done'
  sudo dpkg --configure -a
done
exit 1
