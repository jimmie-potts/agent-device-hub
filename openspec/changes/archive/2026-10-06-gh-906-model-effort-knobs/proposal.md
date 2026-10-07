## Why

PROMPTI (the owner's name for the CHOMPI agent controller) leaves small knobs 1-3 inert. On 2026-10-06 the owner decided, after a review of how they use Claude and Codex, that knob 1 sets the model and knob 2 the reasoning effort of the task in front ([#744](https://github.com/jimmie-potts/agent-device-hub/issues/744)). Effort is the setting the owner changes mid-task; the model is chosen per task. The same day a live qualification on the trial host recorded both clients' model and effort controls and their readback. Owning issue: [#906](https://github.com/jimmie-potts/agent-device-hub/issues/906).

## What Changes

The design is keystroke-free wherever the clients allow it. The #915 reviews found that keystrokes chosen from a UI
Automation read could leak into the composer when that view lags. A second qualification on #906 (2026-10-06)
recorded the clients' UI Automation patterns, and the owner decided Codex effort uses his chords first.

- **Knob 1 (model):**
  - Claude: the first detent expands the `Model: <name>` button and focuses the current model. Further detents move
    focus one model option (`SetFocus`), and a still click calls `Select` on the confirmed focused option.
  - Codex: the first detent expands the picker button and invokes "Select model". Further detents move focus in the
    model list, and a still click calls `Select`. The bridge then closes the picker, which stays open after a pick.
- **Knob 2 (effort):**
  - Claude: each detent expands the `Effort: <level>` button if needed and sets the slider one `SmallChange` within its
    range. At an end nothing is set (`at-limit`) and waiting detents are dropped. A model without an Effort button is
    unsupported.
  - Codex: with the owner's chords in the profile, each detent sends one chord, only with Codex in front, no card and
    the picker closed. Without chords, the picker's Power entry is focused by UI Automation and stepped with Right and
    Left, with the level count read from the announcement each time.
- **Readback:**
  - Claude: the `Model:` and `Effort:` buttons and the session record's `model` and `effort`.
  - Codex: the picker button's `<model> <effort>` name (and the announcement for the Power route).
  - Each change logs `applied`, `mismatch`, `unverified`, `unsupported` or `at-limit`, and the knob's LED shows it.
- **Closing:**
  - Claude: `Collapse`, then composer focus.
  - Codex: `Collapse` does not close it. A model list left without a pick first gets `Select` on its current model,
    then exactly one Escape goes into the confirmed-focused picker, followed by a bounded wait for its button to read
    collapsed. There is never a second Escape.
  - Any other control, a profile reload or a controller loss closes an open control first; one flow acts at a time.
- **Safety:**
  - The knobs never press Enter.
  - Their only keys are Codex's one Escape, the owner's chords and, without chords, Right and Left on a focused Power
    entry, all through `tapInClient`.
  - Every UI Automation action re-reads its target and refuses on any difference.
  - Gating reads wait up to 400 ms for a lagging view.
  - The knobs refuse with a card, another app, an unqualified client or an unknown state.
- **Profile (`schemaVersion` stays 1):**
  - optional `model` and `effort` sections (`stepCounts` default 6, `invert`, `model.clickStillMs`);
  - optional `shortcuts.codexEffortIncrease`/`codexEffortDecrease`;
  - `timing.menuTimeoutMs` (default 5000) and `colors.applied`;
  - key names gain `Equal` and `Minus`.
- **OS adapter:**
  - Interface version 5 (unreleased) adds `pickerState` (qualified shapes only), the seven setting actions,
    `tapInClient` (Left, Right and Escape) and `claudeSettings`.
  - These are implemented in the Windows adapter and helper, the unsupported adapter, the simulated desktop and the
    test fake.
  - The shared simulated picker model can lag one change behind.
- **Verification harness (#853):**
  - Eight catalog scenarios run in Tier 1 and from the control page, one with lagging reads.
  - The control page shows each window's model, effort and open control.
- **Docs:**
  - the bridge README, the verification README and the UIA notes (with the residual windows);
  - the qualification report: client rows and installed checks for #906 under #745;
  - the development guide and the app verification overview.

## Capabilities

### Modified Capabilities

- `chompi-task-routing`: the profile's knob sections and chords, knob lights, release on loss for knob flows, and a new requirement for the model and effort knobs.
- `chompi-bridge`: OS adapter contract version 5 with the qualified-shape picker read, the fresh-read-checked UI Automation setting actions, client-scoped taps and the session-setting read, and the simulated desktop at version 5 with lagging reads.
- `chompi-bridge-verification`: the control page's model, effort and picker view and knob light names, and the eight knob scenarios.

## Impact

This changes the bridge package only and extends its released 1.x surfaces additively, as ADR 0012 requires until the platform cutover. The profile stays at `schemaVersion` 1, so the installed owner profile loads unchanged and gets both knobs. The slot file is unchanged. An earlier bridge rejects the new optional profile fields as unknown, so a rollback removes them (README). The OS adapter version is internal to one installation: the bridge and its adapters ship together. Delivery is source-only; #745 owns installation, the owner's physical checks and the live qualification of the helper's picker read and setting actions.
