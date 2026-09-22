## Context

The source hook is apps/hub/bin/monitor-hook.mjs. The standalone host has private durable storage and authenticated monitor v1 routes. Existing source pins and source helpers exercise the Pixoo selected-source facade and Python Nanoleaf projection. The existing Linux baseline already uses bubblewrap with PID/network/mount isolation and pidfd-backed cleanup. Design is required for timing, cross-process behavior and confinement.

## Goals / Non-Goals

Measure the real hook and real consumer code in a repeatable disposable environment. Preserve one owner and each device's designated writer. Exclude devices, installed agents, private state, Windows processes, embedded hosting and migration-performance qualification. Reuse existing consumer rendering/playback correctness tests instead of recreating them.

## Decisions

1. A Python launcher stages explicit runtime inputs, verifies source pins, and launches the Node scenario driver in private network, mount and PID namespaces. Only read-only runtime/source inputs and fresh writable temporary state are visible. Acquire a pidfd for the namespace init before releasing the driver's startup handshake. On failure/timeout, kill that namespace and verify exit; detached descendants cannot survive its init. Reject missing isolation rather than falling back to unconfined execution.
2. Use the delivered host in a separate Node process, the actual hook in fresh processes, the Pixoo remote session facade, and a persistent Python adapter that calls Nanoleaf's real fetch/accept projection. Fake physical transport/worker launch prevents device writes. This test adapter is not installed or shipped as a controller. A headless browser opens the actual dashboard. Setup/build prerequisites are distinct from measured runtime.
3. Measure hook spawn through process close on the driver's monotonic clock. Observe event admission at a loopback forwarding boundary immediately before forwarding to the host, then consumer receipt at the driver. The receipt interval conservatively includes observer/projection handoff overhead; do not claim isolated reducer latency or optical timing. Each measured batch waits for both consumers' exact session/revision/observed-event timestamp before the next batch. Record first-call/startup separately. Use 200 warm events for each of 1 and 10 concurrent tasks; report nearest-rank p95, not a statistically unsupported p99. A 50-task burst checks bounded behavior rather than a latency promise.
4. Freeze the following practical targets before measurement: warm hook p95 <=250 ms for 1 task and <=500 ms for 10; each consumer receipt p95 <=1500 ms; source startup and restart/reconnect readiness <=5000 ms. The rationale is subsecond hook response with headroom for a ten-process burst, plus the delivered Nanoleaf one-second polling cadence and 500 ms processing headroom. This cadence-based receipt target was corrected before any measurement, without changing the hook or recovery targets. Every hook, including failure/burst scenarios, must return <=3000 ms. Peak standalone hub RSS must remain <=256 MiB. No post-failure relaxation; preserve every attempt. Historical percentile ceilings are diagnostic and unchanged.
5. Exercise dashboard closed/open/reconnect, a guarded Pixoo monitor filter command through the Hub during ingestion and a dashboard label edit, a paused third stream, one unavailable consumer, host outage, restart and exclusive-store rejection. Check retained labels/notices, current snapshot recovery and no expired-effect replay. Inspect loss/resync and admission rejection honestly; no silent retry to make samples pass. Reuse canonical state/host/consumer regressions for queue and presentation invariants.
6. The one-command report records source revisions, artifact hashes, runtimes, observed host load, explicit boundaries, all samples/failures, resources, scenario evidence and cleanup. New output directories prevent overwrite. CI checks tooling correctness and negative cases; private-repository source qualification remains an explicit local run, not a noisy hosted timing gate.

## Risks / Trade-offs

- Host contention changes timings. Record load and retain failures; compare like boundaries without discarding attempts.
- Runtime snapshots can drift from source. Use exact consumer pins, fresh builds, and artifact hashes; qualify the committed Hub revision and retain its identity outside that commit.
- The synthetic polling schedule is not optical cadence. Record it explicitly and make only source receipt claims.
- Browser/dependency runtimes enlarge the mounted inputs. Mount read-only explicit runtime roots, never HOME, device state, host sockets or network interfaces.
- A timeout can interrupt report writing. The outside supervisor owns the final failure/cleanup receipt and caps collected output.

## Migration Plan

Not applicable. This adds source tooling and does not deploy, switch an owner or alter an installation. Existing migration tests remain unchanged.
