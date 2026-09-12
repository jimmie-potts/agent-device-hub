# Early shared monitoring measurements

[Hub #30](https://github.com/jimmie-potts/agent-device-hub/issues/30) has an early
measurement/budget stage before Hub #3 and later integrated qualification. This
candidate adds a pinned, isolated measurement of the delivered Linux hook. The
source baseline and budget receipt below cover the early stage. Shared feed,
consumer and physical qualification remain later work; overall #30 stays open.

Receipt storage: start with the [receipt summary](performance/receipts/README.md).
Raw observations are gzip-compressed; existing SHA-256 evidence hashes refer to
the decompressed original bytes. The receipt index records compressed hashes
separately. Historical and excluded runs remain in the archive subdirectory.

## Available source boundary

`python scripts/performance/admission.py --output <new-directory>` measures
Nanoleaf's real `handle_event` at delivered revision
`ea3b95661352f927aceaf92b62d74660978c201f`. The two byte-identical upstream files
under `scripts/performance/vendor/nanoleaf` are measurement inputs, not Hub
provider adapters. The tool checks their fixed SHA-256 before import and rejects
extra files. Change the source revision only through review and new evidence.

The measured operation includes SQLite connection/schema checks, transaction
acquisition, lifecycle transition, project metadata update and commit. It uses
the original supported `launch` callback to count the worker-launch boundary.
Actual worker creation, hook parsing/return, forwarding, rendering and devices
are excluded. The result cannot stand in for full hook latency or the future
shared monitoring feed.

The legacy `hook --state-dir` path is unsuitable for isolation: its hook branch
ignores that argument and uses `data_dir()`. The tool never calls that branch,
`data_dir`, configuration loading, metadata polling or rendering. It passes a
new synthetic directory directly to admission. A worker-only audit guard denies
network, subprocess and out-of-directory SQLite operations. Pinned-source
review and that narrow call graph support this boundary; the audit guard is
not a general OS filesystem sandbox.

## Run and inspect

Use an existing Python 3.12 or 3.14 environment. No Python dependencies or
installed agent clients are needed for this admission-only tool.

```bash
python -B scripts/check-performance.py
python -B scripts/performance/admission.py --output /tmp/hub30-admission-new-run
```

The output directory must be new and its parent must exist. The default is
three repeats of 1, 10 and 50 concurrent synthetic sessions, each with 100
measured bursts and three excluded warmup bursts. The tool asserts the real
committed session/turn/status result after each profile. It creates disposable
native temporary databases and removes them after worker completion.

These controls bound the measurement tool, not the product: at most 50,000 raw
timing samples per invocation, at most five repeats, 1,000 bursts, 100 warmups,
a default 120-second worker timeout with a 600-second maximum, and a combined
2,000,000-byte stdout/stderr collection limit. Overflow kills the worker, and
timeouts/failures remain in the receipt without exporting exception content.
An incomplete repetition prevents a pooled successful summary for that profile.
Do not raise limits to conceal a product failure.

`receipt.json` is updated atomically after each profile. It contains the tool
hash, upstream revision/file hashes, Python/SQLite/OS identities, task counts,
raw operation and burst-makespan samples, nearest-rank p95/p99 and failure state.
Each repetition remains separate. Sample counts below 1,000 mark p99 support
as provisional; larger counts alone do not establish statistical confidence
or matched no-regression acceptance.

The first database operation is separate from warmed observations. Every repeat
uses a fresh process, but does not clear OS caches. Operation timing excludes
barrier/thread scheduling; burst makespan includes it. Parent roundtrip includes
process creation, imports, the entire profile and exit. It is not startup-only
latency. No timestamp is subtracted from a different process or host clock.

CPU includes measurement-process work and threads. RSS is process-lifetime peak,
including tooling; Linux reports converted bytes and Windows uses peak working
set. These are not host-wide or device-worker limits. Ambient load averages are
reported where supported, otherwise explicitly unavailable. Load is observed,
not controlled. Compare matched runs only after inspecting these conditions.

## Released validator boundary

`validators.py` measures the actual released 1.0.0 package in a disposable npm
consumer. The vendored archive is the verified release asset, not a checkout
package. The tool checks its archive hash, published manifest hash and every
manifest file before and after each worker. Extra package files and symlinks
are rejected, apart from npm's explicit top-level nested dependency directory.
The Python worker also verifies the imported jsonschema distribution origin. It records the consumer lock hash;
that lock records dependencies, but the tool does not independently hash every
installed transitive dependency file. Use a fresh consumer from that lock.

Use Node 24 and an existing Python 3.12/3.14 environment with the repository's
pinned jsonschema 4.19.2 dependency. Copy the retained consumer package/lock and
release archive into a new directory, then run `npm ci --ignore-scripts` there.
Pass that directory with `--consumer`; the tool never imports a sibling checkout.

```bash
python -B scripts/performance/validators.py \
  --archive scripts/performance/vendor/jimmie-potts-agent-lifecycle-contracts-1.0.0.tgz \
  --consumer /tmp/prepared-lifecycle-consumer \
  --output /tmp/hub30-validator-new-run
```

Three fresh processes per language each measure 100 cycles through the same
33 valid upstream cases, after three excluded warmup cycles. All 19,800 raw
warm timings retain corpus order and repeat identity. Each result must equal a
detached copy of its input, and its input must remain unchanged. Invalid-case
conformance remains in lifecycle tests; this profile measures valid admission.

The parent measures spawn through readiness receipt on its own monotonic clock.
That interval includes process startup, worker preparation, corpus reads and
validator import. Each worker separately measures import, first call and warm
calls on its own clock. Assertions are outside call timing; CPU includes them
and warmup. Python reports lifetime peak RSS where supported, with Windows
explicitly unavailable; Node records instantaneous process RSS before/after.
These are different resource metrics. Neither measurement establishes cold OS
caches, matched host conditions, full hook return or future shared reduction.

The tool limits warm samples to 50,000, three protocol lines to 1,000,000 bytes
each and each no-descendant worker to a default 120 seconds, maximum 600. Extra
output, timeout and failure remain failed repetitions with fixed diagnostics.
Those are measurement-tool bounds, not frozen product budgets.

`npm run test:performance` runs 14 focused checks and a disposable external
consumer check on both real validators. That check rejects a modified installed
corpus and an added Python module that would shadow jsonschema. It uses npm's existing cache offline after the normal `npm ci`; it does
not fetch or install personal runtimes.

## Recorded WSL observations

The raw receipts under `docs/performance/receipts` record September 8, 2026
observations on WSL2 kernel 6.6.87.2, Python 3.14.4 and Node 24.20.0. They include
tool/source hashes, sample definitions, repeat counts and ambient load. Other
local source work ran concurrently; no controlled or matched host claim applies.

| Boundary | Raw warm samples | Observed p95 | Observed p99 |
| --- | ---: | ---: | ---: |
| Real legacy admission, 1 task, pooled 3 repeats | 300 | 0.470 ms | 0.627 ms, provisional |
| Real legacy admission, 10 tasks, pooled 3 repeats | 3,000 | 80.580 ms | 105.862 ms |
| Real legacy admission, 50 tasks, pooled 3 repeats | 15,000 | 335.198 ms | 734.136 ms |
| Released Python validation, each of 3 repeats | 3,300 | 0.374-0.376 ms | 0.423-0.458 ms |
| Released Node validation, each of 3 repeats | 3,300 | 0.013-0.013 ms | 0.028-0.033 ms |

These observations are not pass/fail thresholds. SQLite admission contention
and process startup remain distinct from validator call cost. Pooled percentiles
are computed from raw samples, not averages of per-repeat percentiles. A sample
count of 1,000 or more alone does not establish tail confidence.

The refreshed [September 10 Linux validator receipt](performance/receipts/2026-09-10-linux-validators.json.gz)
contains another 19,800 valid-case calls across three processes per language.
Python p95 was 0.340-0.357 ms and p99 0.374-0.414 ms; Node p95 was
0.012-0.015 ms and p99 0.026-0.031 ms. It preserves startup/import/first-call
and resource records separately, using Python 3.14.4 and Node 24.21.0. Shared
checks were running concurrently, so these component observations are not
matched hook-budget comparisons and are not pooled with September 8.

## Linux hook qualification

The Linux input is Nanoleaf PR #57, revision
`2558df5a2fc543247b0c75898ef0260ba3ea264b`. The exact executed files are
`bridge.py` and `project_map.py`, pinned under `vendor/nanoleaf-linux`.
The source selects explicit state before dispatching the hook. Its mounted
legacy forwarding predicate cannot select the isolated `/source` location.
Installed/client/physical acceptance remains Nanoleaf #55.

```bash
npm run test:performance:linux
/usr/bin/python3 -B scripts/performance/linux_hook.py --output /tmp/hub30-linux-new-run
```

Use Linux system Python 3.12 or 3.14 under `/usr` with bubblewrap installed.
The thirteen correctness checks take about five seconds locally. CI runs these
once on Ubuntu; the 9,000-call benchmark is an explicit local command, never
part of CI. On Ubuntu, CI loads the distribution's packaged Bubblewrap
AppArmor profile from `apparmor-profiles`, following [Ubuntu's namespace guidance](https://discourse.ubuntu.com/t/understanding-apparmor-user-namespace-restriction/58007).
Global AppArmor restrictions remain enabled. A denied namespace still fails
qualification. No native Windows comparison or executable forwarding is needed.

The runner verifies every input before execution and copies it into a fresh
owned source directory. Bubblewrap creates fresh PID, mount, network, IPC,
UTS, user and cgroup namespaces. Only `/usr`, the two source files and the
measurement supervisor are mounted read-only. State uses a 64 MiB disposable
Linux tmpfs. There is no personal home, mounted host drive or external network.
Before any hook runs, checks prove source writes fail, private mounts are
absent and the isolated network cannot reach an external address. The parent
holds the supervisor at a stdin startup handshake until it owns a Linux PID
handle for that init. Allocation failure closes stdin and aborts before source
execution. This prevents the startup-exit/PID-reuse race and avoids host process
scans. Collection errors use bounded cleanup rather than an implicit process wait.

The supervisor holds the real `notification-lock.sqlite` owner lock. The actual
hook parses synthetic stdin, connects/commits `status.sqlite`, calls the real
`launch_worker`, and returns. The detached worker executes the pinned bridge,
encounters the held owner lock and exits before loading controller code,
configuration, metadata or transport. An untimed Python audit probe records
allowlisted proof of the exact worker command and lock connection, then removes
its synthetic status database. Timed calls have no audit instrumentation or
replacement launch callback. Worker rendering/readiness is excluded explicitly.

Hook duration runs from the caller's monotonic timestamp immediately before
`Popen` through hook exit. This includes process startup, parsing, admission,
commit and real worker spawning. It does not include waiting for the detached
worker. Separate measurements retain burst makespan, descendant cleanup and
namespace roundtrip. The older admission and released-validator receipts above
remain separate component evidence at their own pins. No subtraction of their
numbers estimates a current hook component or crosses clock domains.

Each repetition uses a fresh namespace. `firstCall` creates a new status
database; each warm sample still starts a new hook process against existing
state. OS caches are uncontrolled, including source cache warmed by the untimed
probe. The default makes 1,000 warm calls per repetition, three repetitions for
each of 1/10/50 concurrent sessions. Nearest-rank per-repeat and pooled tails
retain raw samples. Pooled sample support is provisional unless all three
1,000-sample repetitions pass; this sample rule is not a statistical confidence
claim. Ambient load is recorded, not controlled.

Child CPU covers first call plus warm hooks and reaped workers, excluding the
untimed audit and later failure cases. The matching wall interval is
`resourceWindowWallNs`; `profileWallNs` describes only the warm profile plus
state verification. RSS is the largest child's lifetime peak in bytes, not
combined memory, and can include the untimed preflight child. Integrated tests
must measure total service memory separately.

Each hook has a 10-second measurement watchdog and 8 KiB stdout/stderr caps.
Each namespace has a 600-second maximum deadline, 8 MB stdout, 64 KiB stderr,
and 4 KiB setup-output caps. Pipes are bounded while collecting. These are
measurement-tool protections, not product budgets. PID 1 reaps detached
children; on timeout the parent kills that exact init through its PID handle
and verifies exit. Linux then terminates all namespace members, including on
older Bubblewrap versions where killing only the wrapper is insufficient.
Tests cover detached sessions, namespace crash, timeout, output overflow and
partial receipt retention. A failed repetition cannot qualify pooled results.
Raw burst checkpoints survive supervisor failure; receipts are replaced
atomically after each repetition.

Malformed JSON, unavailable state and a held admission database lock are
recorded separately. The legacy hook returns exit 0 and `{}` on stdout with a
stderr diagnostic for these failures. That behavior does not satisfy the future
shared producer's silent fail-open contract; its implementation must obey the
released contract while meeting the timing budget.

## Frozen early budgets

[The budget file](performance/linux-budgets.json) pins
[the 9,000-call receipt](performance/receipts/2026-09-10-linux-hook.json.gz) by
SHA-256. Every one of the nine profiles passed, with no failed hook or worker
and verified final state. These are candidate limits until independent review,
current-head CI, guarded merge and merged-main CI accept this version.

| Concurrent sessions | p95 ceiling | p99 ceiling | Maximum hook | Child CPU per call | Largest child RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 63 ms | 65 ms | 73 ms | 116 ms | 31 MiB |
| 10 | 82 ms | 87 ms | 123 ms | 138 ms | 31 MiB |
| 50 | 377 ms | 396 ms | 449 ms | 243 ms | 30 MiB |

The ceilings round each observed worst repetition upward to the next whole
millisecond or MiB. There is no additional percentage tolerance. Each future
repetition and its pooled latency must meet these limits with the same boundary,
profile and runtime/host class. Failed calls, timeouts, missing samples and
unverified confinement fail qualification. A later failure cannot justify
silently raising a limit or discarding a repetition.

The first-call ceiling is 61 ms. The hard hook-return deadline is 3,000 ms,
rounding the worst isolated database-contention observation of 2,562 ms to the
next 500 ms. That is a failure ceiling, not the healthy-path target. Each
producer must enforce its deadline without waiting for a device. The existing
legacy failure output is not the future producer's required silent behavior.

Future consumers have explicit design caps of 128 pending events and 256 KiB
queued bytes, with a 2 KiB event maximum, bounded loss reporting and resync.
Rendering is capped at 20 Hz, one update per 50 ms, independent of immediate
hook return. A service process has a 128 MiB RSS cap. These limits provide
bounded headroom above the tested 50-event burst; the legacy measurement does
not implement or verify these queues, a complete Node service, or rendering.
Integrated qualification must prove those caps before release.

The run used the tool bytes committed at `2467d382db2ad3a85f0adb9fdd729efa05741505`.
Subsequent CLI exception and namespace-startup diagnostics emit only fixed
categories. Parent cleanup now uses a PID handle to support older Bubblewrap.
The startup ownership handshake precedes all source work. Hook calls and their
timing/resource windows are unchanged; the measured tool hashes retain the
original version rather than claiming the new startup code was measured. Successful baseline cleanup was verified on the recorded host. The receipt preserves
the measured tool hashes. Earlier smoke and interrupted trials are retained in
[the attempt index](performance/receipts/2026-09-10-linux-attempts.json), excluded
from these limits because they used earlier collection/cleanup code. They are
never pooled with this run.

Ambient Linux load rose with the larger profiles, from roughly 0.9 to 21.7 on
32 logical CPUs. Host load was observed rather than controlled. Documentation
and tracker work continued during the run; a short correctness rerun may overlap
the final burst profile. No other full benchmark or shared build suite ran
concurrently. The three 50-task p95 results were 366, 376 and 362 ms. This is a
repeatable local source baseline, not matched native-Windows evidence or an
installed-client or statistical confidence claim.

Final shared-feed/consumer isolation, overload/resync, frontend,
playback/animation, hosting, restart/rollback and physical qualification remain
with later implementations and their owners. Overall #30 stays open after
this early-stage delivery.

## Remaining Windows elements for separate follow-up

Repository-wide Windows CI removal and CI cost reduction are separate from this early measurement delivery.
The current CI matrix, development instructions, provider qualification and
lifecycle documentation/specification retain Windows support references. The
older OpenSpec configuration describes a Windows worker. Pinned legacy sources,
measurement portability branches, Git attributes and raw receipts also retain
historical Windows details. The new Nanoleaf source still contains legacy Windows
branches, although the fresh Linux route avoids them. Report these residuals to
the user rather than claim the repository is Windows-free. Preserve raw evidence;
separate current support policy from historical provenance during cleanup.

These residuals do not restore a Windows performance requirement to #30/#77.
Configured hosted CI gates still apply until a separately reviewed CI change
replaces them. This delivery adds one short Linux correctness step to the existing workflow
job and retains all other configured gates. It does not deliver repository-wide
Windows removal or broader CI cost reduction.
