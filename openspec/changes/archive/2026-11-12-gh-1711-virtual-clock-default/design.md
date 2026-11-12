## Context

Story 6 (#1710) built a disposable run on virtual time: the supervisor owns the run's time, the child runs the runtime on a manual clock, and the run adapter advances the run and runs its parts on a clock that moves with it. Two catalog scenarios opted in. It left three gaps for this story (#1711, comment of 2026-11-12): a hook against a stopped runtime was refused on virtual time, Playback's monotonic clock in a run stayed real because `run.remote` took no options, and the browser's own clock was not moved. With every catalog capture on virtual time, each gap now breaks a capture: `agent-hooks`, `tidbyt-tiles` (Playback's slow speaker and freshness), `automation-lines-moment` (Nanoleaf write stamps), `microduck-simulator-controls` (sensor freshness), and `art-schedule` and `shared-art` (the page's request deadlines). See proposal.md for why.

## Goals / Non-Goals

**Goals:**

- Every catalog capture on virtual time, with no assertion weakened and no product duration changed.
- The real clock unchanged for every run that is not a catalog scenario, for every shipped run, and for every module built without the run's clocks.
- Pins for the shipped durations the captures now follow only on virtual time.

**Non-Goals:**

- The steps that are not catalog scenarios (`mac-codex-local`, `edge-grants`, `browser-speech`, `follow-one-request`, the negative controls and the shipped runs). They keep their clock; their remaining real-time waiting is reported as follow-up.
- The dashboard browser journeys and unit tests with real timers (#1705 section 4).

## Decisions

- **Remove the opt-in rather than invert it.** No catalog scenario needs the real clock (owner decision of 2026-11-12), so `runClock` goes and the seed writes `virtual` for each catalog scenario. An inverted opt-out would be unused code.
- **A stopped hook holds the runtime with a release.** On virtual time a restart's hold passes at once, so the runtime would start again before a hook could meet it stopped. `POST /restart {untilReleased: true}` keeps the runtime stopped until `POST /release`, then runs the hold as before. The adapter releases only after the hook has run. The release gate exists before the runtime stops, so a caller that saw the runtime stopped can always release it. A release that never comes ends the wait after `MAX_HOLD_MS` (10 s) of real time, so a failed adapter cannot wedge the run. Only virtual time needs this: a run on the real clock refuses `untilReleased` and `POST /release` with 409 `invalid-state`, like the clock routes, so the #1709 and #1710 refusals keep their reach. Alternative considered: the adapter advances the hold while the hook runs. Rejected: the supervisor's lifecycle queue would hold the advance behind the restart.
- **A remote module takes the run's clocks as an optional argument.** `run.remote(link, options?)` gets `{now, scheduler, monotonic}` from the child only on virtual time, and `run.create`'s options carry `monotonic` only on virtual time. Without them each module and device keeps exactly the clocks it had: an installed runtime never builds either, and a real-clock or shipped run passes none. Playback uses `monotonic` for freshness. MicroDuck uses the run's scheduler for its 100 ms poll and the run's wall clock for `nowNs`, and its supervisor device stamps its sensor on the run's clock, only when given them; otherwise both keep `process.hrtime` and `setInterval`. Nanoleaf's and Playback's supervisor devices take the `now` and `scheduler` that `run.create` already received, which on the real clock equal their defaults. Alternative considered: stamping in the SDK harness. Rejected: the stamps belong to each simulated device.
- **The run holds still during a browser capture.** On virtual time the page's clock starts at the run's time (`page.clock.setSystemTime`), so the page's request deadlines agree with the runtime, and the run moves only when the capture moves it. All eight browser captures pass so, with no explicit steps. Alternatives considered: moving the run on with the real time that passes during the journey, which made what a capture sees depend on host speed, and Playwright's fake clock stepped in lockstep with the run, which needs more code. Both rejected.
- **A virtual resync is also bounded in real time.** After a restart the adapter advances the run while the reader comes back, so its reconnect backoff on the parts' clock passes. The reader's re-registration is real I/O, though, and 15 s of the run's time passed in about 2.7 s of real time on the PC. The wait now advances the run until the bound passes in the run's time, then polls without moving it, and fails only once the bound has also passed in real time. The passing path is unchanged. The two adapter tests whose subject is real elapsed time run on a real-clock run of the same seed through a test-only option of the verification tests' `startRun`.
- **Pins are unit tests where the durations are declared.** They assert the values with no waiting, and pin the art schedule's holds through a built plan, so no product constant is extracted.

## Risks / Trade-offs

- [No catalog capture proves its product timer in real time any more.] → The owner accepted this on 2026-11-12. The pins guard the values, and `tests/process.test.ts` keeps one real-clock check that a runtime with no test clock fires a module timer in real time.
- [`run.create`'s options gain an optional field.] → It is optional, so every other simulation is unchanged, and a device can tell a run on virtual time from one on the real clock without guessing from the functions it receives.
- [The release route could be misused to hold a run stopped.] → Loopback only, virtual time only, and at most 10 s of real time.
- [A future capture may need the runtime to act mid-journey.] → It then advances the run itself, and moves the page's clock with it.

## Migration Plan

None. No stored data, configuration or installed behavior changes.
