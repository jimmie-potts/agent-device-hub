## Why

In the [#743](https://github.com/jimmie-potts/agent-device-hub/issues/743) trial, PROMPTI (the owner's name for the CHOMPI agent controller) worked as a state machine. A slot key press made a verified target, and Record and Send acted only on that target. Any other key, a profile reload or Back cleared the target, so after a reload Play reported `no-target`, and clicking into a task with the mouse never made it the Send target. The owner found this too rigid. [#821](https://github.com/jimmie-potts/agent-device-hub/issues/821) records the owner's decisions of 2026-10-05: controls act on the window in front when they are pressed, like a keyboard, and the big wheel answers approval and question cards, including permission requests.

## What Changes

- **Slot keys** open and verify their task exactly as before, including the #817 already-newest evidence, but arm nothing. The router no longer keeps a target.
- **Send** (the profile's send controls; by default the big-wheel click and Play) is evaluated at the press. It types one Enter only when all of these hold:
  - the foreground is Codex or Claude Desktop at a qualified version;
  - the composer has keyboard focus;
  - the adapter reports no visible card;
  - the repeat window has passed;
  - Record is not held.

  Any other app in front gets nothing (`not-agent-client`). Send no longer checks the Hub's `approval` attention or the feed's freshness.
- **Record** holds the Wispr chord on press and releases it on release, with no foreground, card or composer check. Held keys are still released on every loss event, Back, a profile swap and shutdown.
- **Card answers.** While a card is open in the foreground Codex or Claude window:
  - Play is refused.
  - Big-wheel turns move keyboard focus between the card's actionable buttons, one button per software detent.
  - A big-wheel click presses the focused button, but only after the wheel has been still for a short time.
  - An unknown card state makes turns and clicks do nothing.
- **Software detents.** The encoder is smooth. One card step needs `cards.stepCounts` encoder counts (default 6, about a quarter turn at an assumed 24 counts per revolution), and the count restarts on a direction reversal. A click is accepted after `cards.clickStillMs` of stillness (default 250 ms). Both settings are optional.
- **Lights.** Slot keys show task state only. The "selected" key color and the Send-readiness wheel LEDs are removed. Their colors stay accepted in profiles and are ignored.
- **OS adapter interface version 3.** It adds `cardButtons`, `focusCardButton` and `invokeCardButton`. These are the first helper operations that change UI state: they focus or press a button only inside the open card, after checking the card's identity, and return only counts, indexes and booleans.

## Capabilities

### Modified Capabilities

- `chompi-task-routing`: press-time Send, a keyboard-like Record, card answers with the big wheel, software detents, lights without selection and optional profile fields. The rule that no PROMPTI action approves anything is relaxed for one gesture: a still big-wheel click on a focused card button.
- `chompi-bridge`: the OS adapter contract becomes version 3 with the card operations.

## Impact

This change affects the bridge package only, with no Hub, agent-state, lifecycle or controller-contract change. Two assurances are cut deliberately, as listed in the design: the Hub approval check on Send and the checks on Record. Installation means reinstalling the per-user bridge on the trial host under epic #738's grant. The live card checks belong to this story's installed trial, and the physical tuning of the detents belongs to #745. #744 builds its knob actions on this model.
