## Context

Hub #2 released lifecycle contract 1.0.0. Existing preparation measures legacy
Nanoleaf admission at `ea3b95661352f927aceaf92b62d74660978c201f` and the released
validators. Those receipts exclude the full hook and real worker launch.

Nanoleaf PR #57 delivered fresh Linux source at
`2558df5a2fc543247b0c75898ef0260ba3ea264b`. Its `bridge/bridge.py` selects
`--state-dir` before dispatching the hook, parses stdin and calls `handle_event`,
which commits state before `launch_worker` starts a detached Linux process.
Nanoleaf ADR 0007 and Hub #43 define Linux state ownership. Installed acceptance
remains Nanoleaf #55. Shared-core/feed implementation is separate.

## Goals / Non-Goals

Measure the Linux path the user intends to run and set reviewed limits before
shared-runtime implementation. No Windows comparison, PowerShell, executable
forwarding or Windows metadata read belongs in these profiles. WSL identifies
the Linux host environment, not a cross-OS call path. This replan authorizes no
installation, personal hook changes, live client sessions or devices.
Repository-wide CI cleanup is separate.

## Decisions

- Preserve existing receipts, hashes and legacy pins as historical evidence.
  This implementation starts from the delivered Linux revision above, verifies
  the complete executed import/child-file set and records new hashes. Do not
  relabel old admission samples as hook measurements or pool revisions.
- Invoke the real Linux hook entrypoint with synthetic stdin and an explicit
  disposable Linux `--state-dir`. Copy source to an isolated Linux location;
  verify the legacy mounted-install forwarding branch cannot be selected. Prove
  confinement before timing: no personal configuration/metadata, external
  network, device transport or Windows executable access, including descendants.
- Time process launch through hook exit with one parent's monotonic clock. Keep
  child readiness/cleanup and burst makespan separate. Measure admission/commit
  separately where instrumentation permits without replacing the real hook.
  Hook return does not mean the light changed or the worker finished.
- Include actual Linux worker-spawn cost in full-hook samples. Bound and reap
  detached descendants even on timeout or parent failure; a parent process-group
  kill alone is insufficient because `launch_worker` uses `start_new_session`.
  Hold the real notification owner lock in isolated state. The actual child
  reaches lock contention and exits before configuration or transport. Verify
  the child command and lock connection with an untimed audit preflight; the
  measured runs have no audit instrumentation. Use bubblewrap namespaces and
  a PID-1 supervisor to confine and reap detached descendants.
  A counted/no-op launch seam can measure admission only, not full hook return.
  If confinement cannot be proved, retain that evidence gap.
- Repeat 1, 10 and 50 concurrent synthetic-session profiles under comparable
  Linux host/load/runtime conditions. Distinguish fresh-process/new-database
  from warm-state results. A fresh process does not imply cold OS file caches.
  Record raw samples, per-repeat p95/p99, maxima, failures, sample support,
  CPU/memory units and load. Never subtract clocks from different hosts.
- Exercise isolated contention, malformed input and unavailable-state cases.
  Record exit status/output and bounded return; legacy output is evidence, not
  proof of the future shared producer's silent fail-open contract. Preserve
  validator import/first-call/warm timings as separate component evidence.
- Freeze numeric limits after Linux evidence review: latency tails, hard return
  timeouts, CPU/memory, queue/cadence and sampling/tolerance rules. Queue/cadence
  values for the future feed are design constraints with integrated verification
  pending, not measured legacy properties. Future comparisons use the same Linux
  profile and reviewed baseline revision.

## Risks / Trade-offs

- Process startup and SQLite contention may dominate validator cost. Keep hook
  and component timing separate, including slow and failed repetitions.
- Source revisions differ. Refresh pins and isolation tests before new runs;
  historical measurements cannot establish no regression on the Linux hook.
- Detached workers can outlive the timed hook. Confinement and cleanup need
  executable evidence; a temporary directory alone is insufficient.
- Shared lifecycle documentation still describes Windows timing profiles, and
  provider qualification and current CI retain Windows coverage. Report these
  for separate Linux-only policy/CI work. They do not restore a Windows
  measurement prerequisite to #30/#77. Existing configured CI gates remain
  until their separately reviewed replacement is delivered.

## Migration Plan

No installed migration applies. Update #30, this active change and the guide
first. This delivery proves isolation, collects Linux evidence and
freezes the reviewed budget revision/checksum. Missing Linux hook evidence or
budgets keeps Hub #3 gated. Synchronize/archive only after early acceptance;
overall #30 remains open for integrated qualification. No Windows bridge repair
is required to continue.
