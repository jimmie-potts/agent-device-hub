## Why

PROMPTI (the owner's name for the CHOMPI agent controller) leaves small knobs 1-3 inert. On 2026-10-06 the owner decided, after a review of how they use Claude and Codex, that knob 1 sets the model and knob 2 the reasoning effort of the task in front ([#744](https://github.com/jimmie-potts/agent-device-hub/issues/744)). Effort is the setting the owner changes mid-task; the model is chosen per task. The same day a live qualification on the trial host recorded both clients' model and effort controls and their readback. Owning issue: [#906](https://github.com/jimmie-potts/agent-device-hub/issues/906).

## What Changes

- **Knob 1 (model):**
  - Claude: the first detent opens the `Model:` menu (`Ctrl+Shift+I`); further detents move Down or Up; a still click sends Enter on the focused model option.
  - Codex: the first detent opens the `Select effort` picker (`Ctrl+Shift+M`) and, with "Select model" confirmed focused, its model list; further detents move; a still click picks, and the bridge closes the picker.
- **Knob 2 (effort):**
  - Claude: each detent opens the `Effort` slider (`Ctrl+Shift+E`) if needed and sends Right or Left, which applies at once. A model without an Effort button is unsupported.
  - Codex: each detent opens the picker if needed, moves to "Power" and sends Right or Left, with the level count read from the announcement each time. The owner's chords from the profile are a fallback, sent only with Codex in front.
- **Readback:**
  - Claude: the composer's `Model:` and `Effort:` buttons and the session record's `model` and `effort`.
  - Codex: the picker announcement.
  - Each change logs `applied`, `mismatch`, `unverified` or `unsupported`, and the knob's LED shows it.
- **Safety:**
  - Keys go only into the client checked in front.
  - Enter goes only on a focused entry of a menu the flow opened, and Escape only into its own confirmed open control.
  - Any other control, a profile reload or a controller loss closes an open control first; one flow types at a time.
  - The knobs refuse with a card, another app, an unqualified client or an unknown state, and never send a prompt.
- **Profile (`schemaVersion` stays 1):** optional `model` and `effort` sections (`stepCounts` default 6, `invert`, `model.clickStillMs`), optional `shortcuts.codexEffortIncrease`/`codexEffortDecrease`, `timing.menuTimeoutMs` (default 5000) and `colors.applied`. Key names gain `Equal` and `Minus`.
- **OS adapter:** interface version 5 adds `tapInClient`, `pickerState` and `claudeSettings` to the Windows adapter, the unsupported adapter, the simulated desktop and the test fake. The UI Automation helper gains a read-only `pickerState` operation.
- **Verification harness (#853):** the simulated desktop gains both clients' model and effort controls. Six catalog scenarios run in Tier 1 and from the control page, which shows each window's model, effort and open picker.
- **Docs:**
  - the bridge README, the verification README and the UIA notes;
  - the qualification report: control map, client rows and installed checks for #906 under #745;
  - the development guide and the app verification overview.

## Capabilities

### Modified Capabilities

- `chompi-task-routing`: the profile's knob sections and chords, knob lights, release on loss for knob flows, and a new requirement for the model and effort knobs.
- `chompi-bridge`: OS adapter contract version 5 with client-scoped taps and the read-only picker and session-setting reads, and the simulated desktop at version 5.
- `chompi-bridge-verification`: the control page's model, effort and picker view and knob light names, and the six knob scenarios.

## Impact

This changes the bridge package only and extends its released 1.x surfaces additively, as ADR 0012 requires until the platform cutover. The profile stays at `schemaVersion` 1, so the installed owner profile loads unchanged and gets both knobs. The slot file is unchanged. An earlier bridge rejects the new optional profile fields as unknown, so a rollback removes them (README). The OS adapter version is internal to one installation: the bridge and its adapters ship together. Delivery is source-only; #745 owns installation, the owner's physical checks and the live `pickerState` qualification.
