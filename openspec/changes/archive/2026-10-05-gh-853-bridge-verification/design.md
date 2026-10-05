## Context

The bridge already had a portable routing core, a protocol-level controller simulator (`ChompiSimulator`), `run --simulate`, a test-only fake desktop and a fake Hub `fetch`. The Hub's verification adapter shows the plug-in shape for `@jimmie-potts/app-verify`. What was missing was a desktop and a feed that a running bridge process can use, a way for a person to drive them, and boundary evidence.

## Goals and non-goals

- Goal: a reviewer can start a run, press and turn every control, see lights, focus, keystrokes, card presses and the bridge log, run named scenarios and keep screenshots, with proof that nothing real was touched.
- Goal: the same scenarios gate every PR in CI.
- Non-goal: Windows client fidelity. UI Automation trees, real focus timing, Wispr and file hashes stay with `test:chompi-bridge:native:built` and the owner's installed checks.
- Non-goal: task pages with knob 4 (#822) and the bridge on the runtime SDK (#837, #846); the catalog carries over.

## Decisions

### Flag-gated simulated desktop

- `run --desktop sim` takes only `sim` and only with the routing flags; anything else is a usage error. With it, the CLI dynamically imports `src/sim/desktop.js` and uses the simulated adapter instead of `deps.createOsAdapter` or the platform adapter. Without it, neither `cli.js` nor `index.js` imports `src/sim` (tested with a resolve hook).
- `CliDeps.onSimulation` hands the simulator and simulated desktop that the flags created to an in-process caller before the router starts. It is never called without those flags. It is how the run's page and the scenarios reach the parts the real CLI created.
- The simulated desktop models what the router observes and causes, as the qualified clients behave: links, the Codex composer shortcut, Claude `lastFocusedAt`, cards that keep (Claude) or replace (Codex) the composer, stop focus and press, Enter into a focused composer or onto a focused stop, synthetic dictation on the chord's release, and a key and press log.
- The test fake (`tests/routing-helpers.mjs`) keeps its fault-injection knobs for the router's unit tests. Instead of moving the fake, one adapter contract test holds both adapters to the behavior the router relies on, and the fake's snapshot builders now come from the synthetic feed. Moving the 1600-line router suite onto the simulated desktop would have weakened its fault coverage for no added assurance.

### Synthetic feed

- `SyntheticHub.handle(Request)` serves `GET /api/monitor/v1/sessions?snapshotVersion=1.3|1.2` and `GET /api/monitor/v1/changes` (a heartbeat every second, one `state` notification per revision) in the Hub's released format. It accepts only its token (timing-safe), answers other methods and paths with errors, and records method, path and authorization, never the token.
- The same handler serves Tier 1 through `fetch` and Tier 2 through the run's HTTP listener. Under ADR 0012 this adds no message format or Hub polling path: it is the existing 1.x feed contract, served by a test double.

### One listener per run

- The run's process (`verify/server.mjs`) binds one loopback port for the page, its harness API and the synthetic feed. The bridge's `--hub` is that origin. One listener keeps `doctor`'s listener check simple and lets the boundary check compare every request with one origin.
- The harness API is internal to this test tool, not a component contract. It refuses a wrong Host, a cross-origin Origin or `Sec-Fetch-Site`, and anything but a JSON body, and validates every value: control and turn IDs through the protocol's own predicates, text as at most 200 printable characters.

### Boundary evidence

- A resolve hook (`verify/guard.mjs`), installed before any bridge code runs, refuses and records `node-hid`, `koffi` and `@koromix/*`. Both are loaded lazily by the bridge, so a correct run never asks for them.
- The bridge's `fetch` refuses any origin but the run's own before connecting. The instance lock lives in the run's data directory (`XDG_RUNTIME_DIR`).
- The checks `no-hid-device`, `no-desktop-calls` and `own-feed-only` read the run's boundary report. Three negative-control seeds cross one boundary each (no `--simulate`, no `--desktop sim`, the installed Hub's port), and tests start those runs and show that each check fails. Without `--simulate` the guard refuses `node-hid`; without `--desktop sim` the platform adapter is created (on Linux the unsupported adapter, so nothing is refused and the check fails on the adapter count); against the installed Hub's port the run's `fetch` refuses every request before it connects.

### Scenario format and tiers

- A scenario is an ID, a title, a seed (tasks, foreground, selection, composers, cards) and steps. A step is an action, an expectation within a bound or an observation that must hold for a while. Checks return `true` or what was observed.
- Tier 1 (`startMemoryHarness`) runs the real CLI with `--simulate --desktop sim` on a `ManualClock`, with the feed in memory and its files in a temporary directory. Tier 2 runs the same steps in real time inside the run, started from the page, with one capture step per scenario.
- Seeding happens before the router starts: the Hub part before the CLI runs, the desktop part in `onSimulation`. Readiness waits until the controller is connected, the feed is current and every seeded task holds a lit slot key. Both tiers wait for it before the first step (PR #855 review: a Tier 2 run started right after a reseed lost its first press); the page's run control stays disabled until then.

### Control page

- Plain HTML, CSS and JavaScript with no dependencies or external requests, under a strict CSP. Keys are buttons that go down on pointer or Space/Enter down and up on release, or toggle with "Latch keys". Encoders turn by a counts field and click. Accessible names carry each key's light (for example "Slot 2, light idle").
- The page polls the run's state and updates elements in place by key, so focus survives refreshes. The log regions are focusable for keyboard scrolling.

## Risks and trade-offs

- Simulation drift: the simulated desktop could diverge from the qualified clients. The shared adapter contract and the router suite's fake bound this; Windows-specific behavior is explicitly out of scope.
- Tier 1 mixes virtual time with real file I/O (token, profile, slots). Each wait step yields to the event loop; 25 sequential and 30 parallel catalog runs passed without a failure.
- Privacy: everything is synthetic. Titles, text and IDs come from the seed or the operator; the feed token is generated per run, stored 0600 in the run's directory and never logged.

## Migration

None. The installed bridge and its profile are unchanged; the flag is new and opt-in.
