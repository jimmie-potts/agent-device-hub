## Context

Hub #2 released lifecycle contract 1.0.0. Nanoleaf main provides a real legacy
admission path with an injectable worker-launch callback. This host's Windows
interop version probe fails before source execution. The shared core and feed
are not implemented. See proposal.md and the issue for staged scope.

## Goals / Non-Goals

Retain reproducible raw observations and explicit evidence gaps. No substitute
core, installed clients, devices or personal state are needed to measure the
available source boundaries. Measurements from incomplete routes cannot release
the early budget gate.

## Decisions

- Pin byte-identical Nanoleaf bridge.py/project_map.py at delivered main
  ea3b95661352f927aceaf92b62d74660978c201f and lifecycle release 1.0.0 by digest.
  Keep inputs usable offline and reject tampering before import. A mutable main
  download or local stale checkout cannot identify a reproducible baseline.
- Invoke real handle_event with a counted launch callback against a new synthetic
  native SQLite directory. The interval includes admission/transition/commit
  and excludes worker launch. Calling hook with --state-dir would be unsafe:
  the legacy hook ignores that argument and can select personal state.
- Use fresh bounded worker processes for repeats and distinguish process-cold,
  database-new, warmed operations and burst makespan. A fresh process does not
  establish cold operating-system file caches. Never subtract cross-host clocks.
- Keep nearest-rank p95/p99, raw samples, per-repeat distributions, counts,
  maxima, failures and parent monotonic round trips. State CPU/RSS units and
  unsupported observations explicitly. Resource limits on the measurement tool
  are not frozen product budgets.
- Deny network, subprocess and out-of-directory SQLite operations in admission
  workers using an audit guard, supported by reviewed pinned source and the
  launch seam. This is a narrow selected-call-graph restriction, not a claim of
  general OS confinement. Full hook/helper profiling requires separately verified
  confinement and child cleanup before execution.
- Require matched Windows/WSL profiles before freezing numeric budgets. Keep
  absent full hook/helper/shared-feed/consumer/device measurements explicit.
  Integrated qualification remains in the open overall issue.

## Risks / Trade-offs

- Timing noise and sparse tails can mislead. Preserve load/version/sample data,
  repeated runs and provisional tail labels; never discard failed profiles.
- Concurrent SQLite admission can fail or serialize. Record actual outcomes and
  makespan; do not divide burst duration into invented per-event latency.
- Injected launch excludes real process cost. Keep full hook-return and helper
  measurements pending; do not use admission timing as their substitute.
- Windows invocation is unavailable here. Prepare the same pinned source tooling
  for owner-run Windows evidence; do not install or change personal runtimes.

## Migration Plan

No installed migration applies. Tools use disposable synthetic state and no
physical endpoint. Failed workers are terminated within the tool timeout;
receipts retain the failure. Product budget revision and checksum will be frozen
only after required measurements and review. This active change cannot archive
while those early-stage acceptance tasks remain incomplete.
