# Shared observability functional pilot

The functional evidence supports practical source adoption across Hub, Pixoo and
Nanoleaf, subject to the normal review, CI and merge gates for
[#704](https://github.com/jimmie-potts/agent-device-hub/issues/704).
**Performance is unqualified.** This result does not establish installed runtime
coverage, physical-device behavior or a production observability backend.

On 2026-10-02 the owner approved retaining the useful implementation while
reducing qualification effort. Current [#706](https://github.com/jimmie-potts/agent-device-hub/issues/706)
and [#705](https://github.com/jimmie-potts/agent-device-hub/issues/705) acceptance
keeps practical adoption across all three repositories, while deferring paired
performance certification and exhaustive browser/hook/helper instrumentation.
This is an explicit scope revision, not a retroactive pass for old experiments.

The shared observability 1.0.0 contract was delivered through
[PR #707](https://github.com/jimmie-potts/agent-device-hub/pull/707), source
`673a297ad1225cd18b611de8969dea10b28d33f2`. The pilot uses its checksum-verified
archive with Pino structured output, host-owned OpenTelemetry tracing and one
Collector log path. No wire-envelope or command retry changes are required.

| Evidence | Observed result | Source revision |
| --- | --- | --- |
| Final Node/Python ingestion, `704-functional-final-003` | Eight expected logs and seven spans retrieved exactly; no missing/unexpected identities or correlation failures. Two query rounds, 1,105.426984 ms. | `dedbfcbf8f4f2c52a1fae1eb7a3fe2dbdeff58a6` |
| Existing Grafana Explore, `704-ingestion-011` | Seven Node log rows and the matching six-span Hub/controller/worker trace visually inspected. Python fixture queried through the same field mappings. | `36576dd908d1213d3f4a6c49446a0ab4d86ebffd` |
| Command/error/context cases, `704-command-faults-001` | Ten scenarios, identical disabled/enabled domain outcomes, six intended effects per mode; 49 logs/48 spans matched. | `2c28379d34922574bc9016ad4ab160713392a638` |
| Paused Collector, `704-paused-collector-004` | 200 commands/effects per mode; 1,400 logs/1,200 spans accounted. Two failed exports per signal; remaining records dropped. Flush 955.183708 ms, application shutdown 956.271814 ms. Same Collector resumed and health verified. | `b9bb18dc74ee720c4f1491c1d26506a3e5d54f07` |
| Absent Collector, `704-absent-collector-001` | 200 commands/effects per mode; all 1,400 logs/1,200 spans classified as failed exports. Flush 7.143453 ms, shutdown 8.179747 ms. | `b9bb18dc74ee720c4f1491c1d26506a3e5d54f07` |

The command scenarios include queued success, duplicate tickets, rejected
admission, concurrent capacity, timeout after admission, unauthenticated and
malformed context, private synthetic payload/query values and a throwing
observer. The independent fake execution oracle, rather than the telemetry,
records effects. A timed-out admitted command remains `uncertain-result` and is
not automatically retried. Existing contract protections remain; the scope reset
did not add a new privacy qualification campaign.

Retained fault evidence remains applicable to the unchanged Hub diagnostics,
controller-client instrumentation, host/log/span pipelines, worker diagnostics
and fault scenarios. Subsequent workload-entry changes read the actual Hub
package version and expose transport counters; they do not alter command or
queue behavior. Current pilot regressions cover these paths. Viewer evidence is
reused because the pinned backend profile, datasource plugins, field mappings
and manual lookup flow are unchanged. Manual trace-ID lookup is demonstrated;
an automatically configured log-to-trace link is not claimed.

The final run used Node 24.21.0, Python 3.14.4, Hub 0.5.1 and
`grafana/otel-lgtm:0.34.0@sha256:c6a56be719990e78b1d32e879988a219904300ecde1b9bfeec472831a56a922b`.
It used fresh synthetic state, fake controllers and loopback ports 43200–43204.
All 18 resource-watchdog samples were valid. Automatic teardown and resource
removal took 6,696.647339 ms; synthetic state was removed and evidence retained.
Six unrelated kind containers were left untouched. The earlier successful fault
and viewer runs also retain cleanup receipts.

Failed and incomplete work remains evidence:

- Original paired suite `704-benchmarks-001` at `7836316` dispatched no commands
  because a timer woke before the scheduled start. The fourth attempted mode
  also recorded an unlocalized watchdog sample failure. The timing regression
  was reproduced and corrected, but no measured pair was obtained.
- Corrected suite `704-benchmarks-002` at `3e2f363` failed backend readiness
  before workload execution. Later diagnostic smokes passed, including resource
  name reuse, without establishing that failure's cause.
- Final functional run 001 passed ingestion but its separate manual cleanup
  brought total teardown to 37,173.286603 ms, exceeding the retained 30-second
  target. Cleanup now runs immediately after a confirmed stop; the old result
  remains failed teardown evidence.
- Final functional run 002 failed host-side readiness while Loki and Collector
  returned HTTP 200 inside the exact owned container. Docker reported the
  requested loopback mappings, but the host Loki port was unavailable. Its
  automatic cleanup passed at 6,705.573827 ms. Run 003 used verified-free ports
  43200–43204 to test the publication-path hypothesis and passed; this does not
  prove the precise Docker/WSL root cause or explain every earlier failure.
- Paused-Collector attempts 001–003 retain the socket-path startup failure,
  1,004.608439 ms flush failure and pre-allocation refusal with incomplete
  diagnostic evidence. The queue wait was corrected to reserve finalization
  inside the unchanged one-second flush bound.
- Earlier backend, query and viewer failures remain in the evidence tree,
  including the internal bridge's missing host mappings and datasource/plugin
  startup problems. They are not represented as passing attempts.

The original benchmark framework is preserved at
`archive/gh-704-full-qualification-20261002`, commit `3e2f363`, along with the
original threshold file and both raw suites. The unfinished startup-diagnostic
patch is retained separately. Benchmark-only scheduling and paired orchestration
are removed from the supported delivery surface. No p50/p95 overhead, sustained
throughput or application/stack overhead acceptance claim follows from this
functional result.

Local validation includes 185 pilot tests, the shared build/type checks and
owning-package checks recorded in the delivery evidence. Independent reviews,
PR CI, merge and merged-revision CI are separate gates; this report does not
assert them complete. Reproduction commands and Grafana queries are in
[development.md](development.md#shared-observability-pilot-checks).

Raw synthetic evidence is retained under the main checkout's
`.local/evidence/gh-706-observability/`, in the named run directories, the
`scope-reset/` receipts and `RESUME.md`. It includes expected records, queries,
process outcomes, watchdog observations, screenshots and cleanup readbacks.
[Earlier fault results](https://github.com/jimmie-potts/agent-device-hub/issues/704#issuecomment-5963232069)
and [inconclusive benchmark results](https://github.com/jimmie-potts/agent-device-hub/issues/704#issuecomment-5963600647)
were also published to the tracker.

Proceed with host-owned, opt-in logging/tracing configuration and useful
request/worker boundaries in the three application repositories. Keep the UI,
domain journals and physical-device ownership unchanged. Record remaining
coverage explicitly; do not instrument pure functions merely to fill an
inventory. Revisit budgets when actual use shows drops, resource problems,
materially higher event volume or changed runtimes. Any later performance
qualification needs its own recorded protocol; it cannot retroactively change
these results. Installation and live testing require a separately named setup.
