# Development and verification

Run commands from the repository root with Node 24 and the dependencies in
[development setup](../../docs/development.md). This file owns the component-specific checks;
[SDLC](../../docs/sdlc.md) owns delivery policy and required evidence.

## CHOMPI controller checks

Hub #741 adds the [CHOMPI HID protocol](../../packages/chompi-protocol/README.md),
the [controller firmware](../../firmware/chompi-controller/README.md) and the
[bridge transport core](README.md). Both sides test
against `packages/chompi-protocol/fixtures/v1.json`.

Firmware, from the repository root:

```bash
npm run test:firmware
npm run test:firmware:arm
```

`test:firmware` builds and runs the pure C++ host tests with a C++17 compiler,
AddressSanitizer and UndefinedBehaviorSanitizer: protocol vectors, debounce,
encoder turn and click separation, the bounded queue, session `hello`, host
timeout, two-part light frames, LED chain encoding and USB restart timing and
back-off. `test:firmware:arm` downloads GNU Arm Embedded Toolchain
10.3-2021.10 once into the user cache and verifies its SHA-256 (or uses
`ARM_GCC_BIN`), fetches the pinned upstream sources into the ignored
`firmware/chompi-controller/.upstream/`, builds `04_AGENT.bin` and runs the
artifact check: memory regions, `boot_info` at `0x38800000`, the controller USB
identity and the absence of MIDI, CDC and SD code. The Firmware CI job runs
both. Neither flashes or opens a device; installation and physical behavior
belong to #743.

Bridge, with Node 24 from the assigned worktree root:

```bash
npm ci
npm run build
npm run typecheck
npm run test:chompi-bridge
```

The suite runs every protocol vector and tests the connection manager against
a fake transport and a manual clock: hello gating, epoch and sequence rules,
synthetic releases on disconnect, stale handling, light frame split and resend,
and bounded subscriptions. It also covers a simulator roundtrip, the
single-instance lock across processes, the node-hid adapter against a stand-in
module, and the CLI. No test loads node-hid or touches USB. The contracts CI job
runs `npm run test:chompi-bridge:built` after the shared build.

Run `npm run test:chompi-bridge:native:built` separately under native Windows
Node 24 after a build, using an isolated runtime rather than changing the
global Windows Node. It fails on other platforms. Before running it, have Codex
show one ordinary task with the sidebar expanded and the selected row visible:
Codex exposes only on-screen rows, so the selected-thread probe otherwise fails
with `selected-row-count` or `document-count`. On a `\\wsl.localhost`
checkout installed from Linux, run `npm ci` on Windows first so the
`@koromix/koffi-win32-x64` prebuild sits beside koffi. The check enumerates
HID devices read-only, checks that the matcher rejects the stock CHOMPI ID,
checks that the named-pipe lock refuses a second holder and is released on
exit and on kill, and runs the Windows OS adapter's read-only observations:
the koffi FFI load, the foreground window identity, a ping to the UI
Automation helper, the composer, Codex selected-thread, approval-card and
card-button observations, the read-only model and effort picker reads (#906) with the UI Automation patterns each
client's controls expose, the read-only shape of Claude's next-step band and composer (#907: counts, focus, the
level where the band was found and emptiness, never text), and the installed client versions. Its Win32 surface replaces `SendInput` and `ShellExecute`
with throwing guards, so it types nothing and opens no link. It checks the volume, client-tap and chord key tables and
that malformed volume requests and client taps are refused before any attempt, without sending a key. It
reads card buttons only; it never focuses or presses one, calls no model or effort setting action, and focuses or
invokes no next-step suggestion.
It then reruns the portable suites except the codec fixtures, which need the
protocol workspace link. It opens no device. Linux CI does not qualify
Windows HID, named pipes, FFI or UI Automation.

### CHOMPI task routing checks

Hub #742 adds the routing core under `apps/chompi-bridge/src/routing/`. The
same `npm run test:chompi-bridge` runs its `routing-*.test.mjs` suites with
a scripted fake OS adapter, a fake Hub `fetch`, `ManualClock` and the device
simulator: profile validation and reload, the read-only feed client (GET-only,
refetch on change, timeouts, size limits, stale handling, the 1.2 fallback and
token-file privacy), slot assignment, release and persistence across task pages (#822: the version 1 to 2
file migration, interrupted writes, corrupt files and rollback), knob-4 paging, state lights and the page LED,
each row of the no-misrouting matrix, press-time Send gating, Record, big-wheel scrolling and card
answers (#821: detents, click stillness, wheel-chosen presses, refusal flashes and unknown card states), the
Attention click on knob 4 and volume knob (#865: first-seen order across pages, repeat cycling, refusal, volume detents, mute and
Record), the model and effort knobs (#906, `routing-knobs.test.mjs`: per-detent UI Automation steps, selection only
of a confirmed focused option, readback outcomes, range ends, unsupported effort, Codex chords first and the Power
fallback, a single Codex Escape even with every read lagging, no stray key, refusals and closing before other
controls), the next-step knob (#907, the same suite: per-detent suggestion focus stopping at the ends, a still click
invoking only the confirmed highlighted suggestion into an empty composer, one Right arrow for the ghost text into a
focused empty composer, no suggestion text in logs, refusals, lagging reads and closing to the composer), loss handling,
exit and uncaught-error key release, adapter warm-up, profile-version reload and an end-to-end
`run --profile` session. The fake adapter models the
qualified app behavior; the tests do not open links, type keys, read Codex or
Claude data or contact a Hub. `windows-adapter.test.mjs` checks how the
Windows adapter reads the helper's approval-card counts and card-button
replies for each client, and `windows-uia-helper.test.mjs` checks the helper
operations' scope statically, including that only the two card operations and
the eight setting actions change UI state, each with one kind of change after a
fresh read, and that the picker read is read-only and returns only the qualified
controls' model and effort labels. Live focus, dictation placement, card answers, model
and effort menus and lights on the device belong to the installed trials (#743,
#821, and #745 for #906).

### CHOMPI bridge verification runs

Hub #853 adds a simulated desktop (`src/sim/desktop.ts`, selected only by
`run --desktop sim`), a synthetic Hub feed (`src/sim/hub.ts`) and a shared
scenario catalog (`src/sim/scenarios.ts`). After `npm run build`, with Node 24
from the worktree root:

```bash
npm run test:chompi-bridge:built          # adapter contract, synthetic feed, flag gating, runner tests
npm run -s test:chompi-bridge:scenarios   # Tier 1: every catalog scenario in memory
npm run test:chompi-bridge:verify:built   # boundary checks and every capture step
npm run test:chompi-bridge:browser        # control page browser and accessibility check
```

Tier 1 runs each scenario against the real CLI (`run --simulate --desktop sim`)
on a manual clock, with the synthetic feed in memory. It takes about a second,
opens no port and touches no device or desktop. Name scenarios to run only
those, or pass `--list` or `--json`. The contracts CI job runs it after
`test:chompi-bridge:built`.

`test:chompi-bridge:verify:built` starts runs without a user manager. It starts
the three negative-control runs and shows that each boundary check fails, and
judges every capture step through `runCaptureStep`. `test:chompi-bridge:browser`
drives the control page with the keyboard and runs axe (WCAG 2.1 A and AA) at
1440 px and phone width. Both need Playwright Chromium. The App verification
CI job runs them. Use an outside-checkout `TMPDIR` locally, as for
the app verification tests.

A disposable run (Tier 2) uses the app verification lifecycle:
`npm run -s verify:chompi -- start`, `capture <run-id> <step>`, `stop <run-id>`.
The run serves the bridge, the control page and the synthetic feed on one
loopback port. The [adapter README](verify/README.md)
lists its steps and boundaries. Runs prove routing behavior only; Windows client
fidelity stays with the native check and the owner's installed checks.

