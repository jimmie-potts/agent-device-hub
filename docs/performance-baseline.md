# Early shared monitoring measurements

[Hub #30](https://github.com/jimmie-potts/agent-device-hub/issues/30) has an early
measurement/budget stage before Hub #3 and later integrated qualification. This
candidate retains admission and released-validator preparation. The September 10
replan targets the delivered Linux hook; it does not implement or measure that
route. The early stage is not delivered and numeric budgets are not frozen.

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

## Linux hook qualification plan

The accepted source target is Nanoleaf PR #57, merge revision
`2558df5a2fc543247b0c75898ef0260ba3ea264b`, under its ADR 0007. Source is
merged; installed/client/physical acceptance remains Nanoleaf #55. Isolated
source measurements do not require that installed acceptance to finish first.

Future implementation must pin the complete executed Linux file set and prove
isolation before running the actual `bridge/bridge.py hook --state-dir` route.
Use synthetic stdin and disposable Linux state. Measure process launch through
hook return, including parsing, admission/commit and the real Linux worker-spawn
handoff. Bound and clean detached descendants on success and failure. Prove no
private configuration/metadata, external network, device or Windows executable
access. A no-op worker-launch callback cannot establish full-hook timing.

Repeat the 1/10/50 synthetic-session profiles under comparable Linux load and
runtime conditions, preserving raw samples and failures. Keep fresh-process and
warm-state timing, component costs, hook return, burst makespan and descendant
readiness/cleanup separate. Exercise contention, invalid input and unavailable
state. Legacy exit/output behavior is evidence, not automatic compliance with
the future shared producer's silent fail-open contract.

No native Windows comparison, PowerShell probe, WSL-to-Windows forwarding or
bridge repair is required. Existing source files and receipts remain unchanged
historical preparation; the commands above still measure only their documented
legacy admission and validator boundaries. New Linux-hook tooling and evidence
remain to be implemented. Do not combine old and new source revisions in one
qualified baseline.

## Outstanding early acceptance

- Verified Linux source pins, confinement and detached-child cleanup.
- Repeated comparable Linux profiles covering actual hook return, startup and
  handoff, alongside separately reported admission and validator evidence.
- Reviewed p95/p99, hard timeouts, CPU/memory/queue limits, cadence, sampling and
  pass/fail tolerances. Future feed queue/cadence constraints need later integrated
  verification and are not measurements of the legacy hook.
- A frozen budget revision/hash, required checks/reviews and guide synchronization.

Hub #3 remains gated by Linux evidence and budgets. Final shared-feed/consumer
isolation, overload/resync, frontend, playback/animation, hosting, restart/rollback
and physical qualification remain with later implementations and their owners.
Overall #30 stays open after early-stage delivery.

## Remaining Windows elements for separate follow-up

Repository-wide Windows CI removal and CI cost reduction are outside this replan.
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
replaces them. No CI, runtime, package, source-pin or raw-receipt changes are
included in this planning update.
