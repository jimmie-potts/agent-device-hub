#!/usr/bin/env bash
# A custom Actions shell for test steps. Execute the original script in this shell with the runner's default
# bash -e semantics and inherited streams. A separate EXIT trap publishes only when the original step fails.
set -e
summary_kind=$1
summary_entry=$2
step_script=$3
shift 3
# Core and App each have many commands. The existing workflow step supplies the suite identity. Leave setup, builds,
# and other shell commands on their default path. The renderer independently allowlists every published identifier.
if [[ $summary_kind == core || $summary_kind == app-verify ]]; then
  job_kind=$summary_kind
  summary_kind=suite
  IFS= read -r command_line < "$step_script" || :
  case "$command_line" in
    "npm run test:"*) summary_entry=${command_line#npm run } ;;
    "node apps/runtime/dashboard/tests/"*.ts) summary_entry=${command_line##*/}; summary_kind=browser ;;
    "node --test scripts/release/tests/"*) summary_entry=release-tests ;;
    "node --test scripts/tests/runtime-container.test.mjs "*) summary_entry=container-host ;;
    "node scripts/ci-selection/run-standalone.mjs") summary_entry=standalone-owners ;;
    *) exec bash -e "$step_script" ;;
  esac
  if [[ $job_kind == app-verify && ( $summary_entry == *:smoke || $summary_entry == *:browser ) ]]; then
    summary_kind=browser
  fi
fi
if [[ -z "${GITHUB_STEP_SUMMARY:-}" ]] || ! summary_dir=$(mktemp -d "${RUNNER_TEMP:-/tmp}/bunny-test-summary.XXXXXXXX"); then
  exec bash -e "$step_script"
fi
case "$summary_kind" in
  browser) export BUNNY_CI_BROWSER_RECORD="$summary_dir/browser" ;;
  node)
    export BUNNY_CI_NODE_RECORD="$summary_dir/node"
    if [[ -z "${NODE_OPTIONS:-}" ]]; then
      # Node 24's normal spec stream remains the primary reporter. The second reporter emits no stdout.
      reporter=$(node -p "require('node:url').pathToFileURL('scripts/ci-selection/failure-node.mjs').href") || reporter=''
      if [[ -n "$reporter" ]]; then
        export NODE_OPTIONS="--test-reporter=spec --test-reporter-destination=stdout --test-reporter=$reporter --test-reporter-destination=stdout"
      fi
    fi
    ;;
esac
finish_summary() {
  local status=$?
  trap - EXIT
  set +e
  if (( status != 0 )); then
    node scripts/ci-selection/failure-summary.mjs "$summary_kind" "$summary_entry" "$summary_dir" || :
  fi
  rm -rf -- "$summary_dir"
  exit "$status"
}
trap finish_summary EXIT
# shellcheck source=/dev/null
source "$step_script"
