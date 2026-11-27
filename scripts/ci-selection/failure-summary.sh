#!/usr/bin/env bash
# A custom Actions shell for test steps. Execute the original script in this shell with the runner's default
# bash -e semantics and inherited streams. A separate EXIT trap publishes only when the original step fails.
set -e
summary_kind=$1
summary_entry=$2
step_script=$3
summary_root=$PWD
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
  case "$summary_entry" in
    test:pixoo:built) summary_kind=mixed ;;
    container-host|release-tests|test:agent-state:built|test:app-verify:built|test:art:built|\
      test:codex-desktop:built|test:companions:built|test:contracts:built|test:dashboard|\
      test:events:built|test:lifecycle:built|test:lifx-module:built|test:mcp:built|\
      test:mcp:protocol:built|test:microduck:built|test:music-producer:built|test:nanoleaf:built|\
      test:observability:browser|test:observability:built|test:observability:pilot|test:playback:built|\
      test:reachy:built|test:roborock-transport:built|test:roborock-transport:consumer:built|\
      test:roborock:built|test:roborock:consumer:built|test:runtime-dashboard:built|test:sdk:built|\
      test:tidbyt-module:built|test:tracker-audit|test:verify-host|test:volcano:built|\
      test:volcano:consumer:built|test:weather:built|test:wemo:built|test:wispr-module:built|\
      test:wispr:built|test:workspace-audit) summary_kind=node ;;
  esac
  if [[ $summary_kind == suite && $job_kind == app-verify && ( $summary_entry == *:smoke || $summary_entry == *:browser ) ]]; then
    summary_kind=browser
  fi
fi
if [[ -z "${GITHUB_STEP_SUMMARY:-}" ]] || ! summary_dir=$(mktemp -d "${RUNNER_TEMP:-/tmp}/bunny-test-summary.XXXXXXXX"); then
  exec bash -e "$step_script"
fi
case "$summary_kind" in
  browser) export BUNNY_CI_BROWSER_RECORD="$summary_dir/browser" ;;
  node|mixed)
    export BUNNY_CI_NODE_RECORD="$summary_dir/node"
    # Keep NODE_OPTIONS and the ordinary runner environment intact, including in nested test invocations.
    export BUNNY_CI_ORIGINAL_NODE BUNNY_CI_NODE_REPORTER BUNNY_CI_NODE_BIN
    BUNNY_CI_ORIGINAL_NODE=$(command -v node) || BUNNY_CI_ORIGINAL_NODE=
    BUNNY_CI_NODE_REPORTER=$(node -p "require('node:url').pathToFileURL('scripts/ci-selection/failure-node.mjs').href") || BUNNY_CI_NODE_REPORTER=
    BUNNY_CI_NODE_BIN="$summary_dir/bin"
    if [[ -n "$BUNNY_CI_ORIGINAL_NODE" && -n "$BUNNY_CI_NODE_REPORTER" ]] && mkdir "$BUNNY_CI_NODE_BIN" && ln -s "$PWD/scripts/ci-selection/summary-node.sh" "$BUNNY_CI_NODE_BIN/node"; then
      export PATH="$BUNNY_CI_NODE_BIN:$PATH"
    fi
    ;;
esac
finish_summary() {
  local status=$?
  trap - EXIT
  set +e
  if (( status != 0 )); then
    node "$summary_root/scripts/ci-selection/failure-summary.mjs" "$summary_kind" "$summary_entry" "$summary_dir" || :
  fi
  rm -rf -- "$summary_dir"
  exit "$status"
}
trap finish_summary EXIT
# shellcheck source=/dev/null
source "$step_script"
