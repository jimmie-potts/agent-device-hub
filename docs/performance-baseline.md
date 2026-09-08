# Early shared monitoring measurements

[Hub #30](https://github.com/jimmie-potts/agent-device-hub/issues/30) has an early
measurement/budget stage before Hub #3 and later integrated qualification. This
candidate provides admission and released-validator measurement tooling. The early stage is not
delivered and numeric product budgets are not frozen.

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
manifest file before and after each worker. It records the consumer lock hash;
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

`npm run test:performance` runs 13 focused checks and a disposable external
consumer check on both real validators. That check rejects a modified installed
corpus. It uses npm's existing cache offline after the normal `npm ci`; it does
not fetch or install personal runtimes.

## Recorded WSL observations

The raw receipts under `docs/performance/receipts` record September 8, 2026
observations on WSL2 kernel 6.6.87.2, Python 3.14.4 and Node 24.20.0. They include
tool/source hashes, sample definitions, repeat counts and ambient load. Other
local source work ran concurrently; no controlled or matched host claim applies.

| Boundary | Raw warm samples | Observed p95 | Observed p99 |
| --- | ---: | ---: | ---: |
| Real legacy admission, 1 task, pooled 3 repeats | 300 | 0.550 ms | 0.672 ms, provisional |
| Real legacy admission, 10 tasks, pooled 3 repeats | 3,000 | 80.559 ms | 105.876 ms |
| Real legacy admission, 50 tasks, pooled 3 repeats | 15,000 | 331.975 ms | 637.631 ms |
| Released Python validation, each of 3 repeats | 3,300 | 0.349-0.377 ms | 0.386-0.447 ms |
| Released Node validation, each of 3 repeats | 3,300 | 0.015-0.016 ms | 0.031-0.037 ms |

These observations are not pass/fail thresholds. SQLite admission contention
and process startup remain distinct from validator call cost. Pooled percentiles
are computed from raw samples, not averages of per-repeat percentiles. A sample
count of 1,000 or more alone does not establish tail confidence.

## Windows owner evidence

Windows interop from this execution host still fails a version-only PowerShell
probe with `UtilBindVsockAnyPort:307: socket failed 1`. This is an execution-host
limitation, not evidence about source performance. An owner can run the same
reviewed source and tests in an existing Windows Python 3.12/3.14 environment,
using a fresh Windows-native temporary output directory. Record the exact tool
revision/hash and returned receipt. Source qualification does not authorize
installations, personal settings, hooks, extra client sessions or device actions.

The admission-only tool does not execute the native PowerShell hook route or
the legacy WSL-to-Windows helper. Those paths need safely isolated real source
measurements before the early-stage acceptance gate can pass. Windows hosted
CI can validate tooling correctness; a different runner host does not supply a
matched local Windows/WSL performance baseline.

## Outstanding early acceptance

- Matched supported Windows/WSL runtime and load profiles, including real hook
  return, process startup and helper overhead with explicit clock boundaries.
- Reviewed numeric p95/p99, hard timeouts, CPU/memory/queue limits, cadence,
  sampling and pass/fail tolerances based on matched evidence and no regression.
- A frozen budget revision/hash and delivered early-stage PR with all required
  reviews, CI and work-guide reconciliation.

Hub #3 remains gated. Final shared-feed/consumer isolation, overload/resync,
frontend, playback/animation, embedded/standalone host, restart/rollback and
physical qualification remain pending their real implementations. Overall
issue #30 stays open after eventual early-stage delivery.
