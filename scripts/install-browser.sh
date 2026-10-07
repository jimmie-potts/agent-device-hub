#!/bin/bash
# Run a Playwright browser install with --with-deps on a hosted runner and retry an attempt that stalls in apt (Hub #862).
# Usage: bash scripts/install-browser.sh <install command...>
if [ "${GITHUB_ACTIONS:-}" != true ]; then
  echo "install-browser.sh changes apt's global configuration and stops every apt-get, so it runs only on a GitHub Actions runner." >&2
  exit 2
fi
attempt_seconds=300 lock_wait_seconds=60
# apt drops a connection or download that receives nothing for 30 s and retries it. A download that is slow but still
# receiving data never times out; the attempt limit bounds it, and the packages it finished stay in apt's cache.
printf '%s\n' 'Acquire::Retries "3";' 'Acquire::http::Timeout "30";' 'Acquire::https::Timeout "30";' |
  sudo tee /etc/apt/apt.conf.d/80-browser-install >/dev/null
for attempt in 1 2 3; do
  if timeout --kill-after=10 "$attempt_seconds" "$@"; then exit 0; fi
  echo "::warning::Browser install attempt $attempt of 3 failed or ran past $attempt_seconds s"
  # The installer runs apt-get through sudo, which outlives a timed-out attempt and keeps apt's locks. Stop it, let a
  # running dpkg finish, then complete whatever configuration an interrupted install left.
  sudo pkill -x apt-get
  timeout "$lock_wait_seconds" bash -c 'while pgrep -x "apt-get|dpkg" >/dev/null; do sleep 1; done'
  sudo dpkg --configure -a
done
exit 1
