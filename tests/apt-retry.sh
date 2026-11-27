#!/bin/bash
# Replay apt's mirror errors in a disposable directory. Reordering uses the real wrapper and awk, but sudo can only
# write the fixture's mirror list. The command, process cleanup and name service never reach the host.
set -eu
source "$(dirname "$0")/../scripts/apt-retry.sh"
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
export GITHUB_ACTIONS=true fixture scenario
mirror_list="$fixture/mirrors"
sudo() {
  case "$*" in
    "pkill -x apt-get"|"dpkg --configure -a"|"timeout --kill-after=10 60 dpkg --configure -a") return 0 ;;
    "tee $mirror_list") command tee "$mirror_list" ;;
    *) echo "unexpected sudo arguments: $*" >&2; exit 99 ;;
  esac
}
timeout() {
  case "$*" in
    "60 bash -c "*) return 0 ;;
    "--kill-after=10 300 bash -c "*) shift 2; "$@" ;;
    "5 getent ahosts "*)
      if [[ $4 == archive.example && $scenario == recovered ]]; then return 0; fi
      return 2 ;;
    *) echo "unexpected timeout arguments: $*" >&2; exit 99 ;;
  esac
}
fake_install() {
  echo attempt >> "$fixture/attempts"
  case "$scenario" in
    healthy) return 0 ;;
    single)
      if grep -Fq $'https://security.example/ubuntu/\tpriority:3' "$mirror_list"; then return 0; fi
      echo "  Temporary failure resolving 'security.example'"; return 100 ;;
    outage|recovered)
      if [[ $scenario == recovered && $(wc -l < "$fixture/attempts") -gt 1 ]]; then return 0; fi
      echo "  Temporary failure resolving 'security.example'"
      echo "  Temporary failure resolving 'archive.example'"
      return 100 ;;
    unrelated)
      if [[ $(wc -l < "$fixture/attempts") -gt 1 ]]; then return 0; fi
      echo 'browser download interrupted'; return 1 ;;
  esac
}
export -f fake_install
export mirror_list
check() {
  scenario=$1
  printf 'https://security.example/ubuntu/\tpriority:1\nhttps://archive.example/ubuntu/\tpriority:2\n' > "$mirror_list"
  : > "$fixture/attempts"
  code=0
  apt_retry "$mirror_list" 300 fake_install > "$fixture/output" 2>&1 || code=$?
  if [[ $code != "$2" || $(wc -l < "$fixture/attempts") -ne $3 ]]; then
    cat "$fixture/output" >&2
    echo "$scenario: expected exit $2 in $3 attempt(s); got $code in $(wc -l < "$fixture/attempts")" >&2
    exit 1
  fi
}
check healthy 0 1
check single 0 2
check recovered 0 2
check unrelated 0 2
check outage 1 1
grep -Fq 'security.example archive.example' "$fixture/output"
echo 'apt setup passed the healthy, single-mirror, DNS recovery, unrelated failure and total outage controls.'
