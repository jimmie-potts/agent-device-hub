## ADDED Requirements

### Requirement: Disposable bridge verification run
`npm run -s verify:chompi -- <operation>` SHALL start, inspect, capture, hand off and stop disposable CHOMPI bridge runs through `@jimmie-potts/app-verify` without changing it. A run SHALL serve, on one loopback port, a control page, its harness API and a synthetic Hub feed, and SHALL run the bridge CLI from the checkout with `--simulate --desktop sim` against that feed. Its feed token SHALL be generated per run and stored privately in the run's directory. A run SHALL record its actual parts (the bridge and the control page) and simulated parts (controller, desktop, Hub feed) as components.

#### Scenario: Start and stop
- **WHEN** a reviewer starts a run on the WSL host and later stops it
- **THEN** the run reports a loopback URL and build identity, serves the page, and `stop` removes its unit, lease and runtime directory while proof stays under the main checkout's `.local/evidence/verify/`

### Requirement: Run boundaries
A run SHALL NOT open a HID device, call Win32 or UI Automation, or contact an installed Hub or bridge. The run SHALL refuse loads of `node-hid`, `koffi` and `@koromix/*`, SHALL refuse every bridge request to any origin but its own before connecting, and SHALL keep the bridge's instance lock in its private directory. The boundary checks `no-hid-device`, `no-desktop-calls` and `own-feed-only` SHALL fail the start when a run crosses the boundary, and `doctor` SHALL re-run them. The negative-control seeds that cross a boundary SHALL be start-only: reseeding a running run into one SHALL be refused before anything changes.

#### Scenario: Negative control on a running run
- **WHEN** a reviewer asks a running run to reseed into a boundary negative control
- **THEN** the command is refused with `start-only-scenario` and the run keeps serving

#### Scenario: Correct run
- **WHEN** a run starts with the simulator transport, the simulated desktop and its own feed
- **THEN** all three checks pass

#### Scenario: Boundary crossed
- **WHEN** a run's bridge starts without `--simulate`, without `--desktop sim`, or pointed at the installed Hub's port
- **THEN** the matching check fails and names the crossing: without `--simulate` the HID transport is created and the module guard refuses `node-hid` before any device is enumerated; without `--desktop sim` the platform OS adapter is created, which on Linux is the unsupported adapter that can make no Win32 or UI Automation call, so nothing is refused and the check fails on that adapter count; and against the installed Hub's port the run's fetch refuses every request before it connects

### Requirement: Control page
The control page SHALL show the simulated controller (15 slot keys, 10 black keys, Record, Play, Loop, knobs 1-4, the big wheel and volume, with every LED's color and profile name), the simulated windows with the foreground, selected task, composer focus and text and any card with its focused stop, the Hub sessions with their slots, the desktop key and press log and the bridge's log. Controls SHALL press, hold, release, turn and click through the simulator's protocol input, and SHALL script the desktop and the synthetic Hub. Every control SHALL be keyboard-operable and labelled, each light SHALL be named by what its role can show rather than by the first matching color, and the page SHALL make no external request. Names starting with `control-` SHALL be labelled as negative controls, not catalog scenarios. The harness API SHALL accept only JSON from the run's own origin and host.

#### Scenario: Keyboard hold
- **WHEN** a reviewer holds Space on the Record key
- **THEN** the simulator reports the key down, the desktop holds the dictation chord, and both release when Space is released

#### Scenario: Accessibility
- **WHEN** the page is checked with axe for WCAG 2.1 A and AA at 1440 px and at phone width
- **THEN** it reports no violations

### Requirement: Shared scenario catalog
The bridge SHALL keep one scenario catalog of seeds and named steps (actions, bounded expectations and held observations). An in-memory runner SHALL run it against the real CLI with `--simulate --desktop sim` on a manual clock in CI (Tier 1), and a run seeded with a catalog scenario SHALL run the same steps from its control page (Tier 2). Both tiers SHALL wait until the run is ready (controller connected, feed current, every seeded task on a lit slot key) before the first step; a Tier 2 run that is not ready within its bound SHALL record a failed readiness step with what it observed and act on nothing, and the page SHALL keep its run control disabled until the run is ready. A failed step SHALL name what was observed and stop the scenario. The catalog SHALL cover Send to the window in front and its refusal in another app with the red wheel flash, Record holding the dictation chord, a Claude question card answered with the wheel with a click without a turn refused, a Codex card with no focus answered by structure, reconnect with no replay, and a profile reload.

#### Scenario: Tier 1 in CI
- **WHEN** `npm run test:chompi-bridge:scenarios` runs
- **THEN** every catalog scenario passes in memory, and a reviewer can name scenarios to run or list them

#### Scenario: Tier 2 capture
- **WHEN** a capture step for a catalog scenario runs on a freshly seeded run
- **THEN** the page runs the scenario, every step passes, and the capture keeps a screenshot, video and the scenario result

#### Scenario: Run right after a reseed
- **WHEN** a reviewer runs a catalog scenario from the page immediately after the run is seeded, while the controller is still connecting
- **THEN** the run waits until it is ready, and the first press reaches the connected controller

#### Scenario: Regression caught
- **WHEN** the behavior a step observes breaks, such as a Codex card that cannot be established
- **THEN** the scenario fails at that step with what was observed
