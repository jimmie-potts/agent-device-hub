## Context

See proposal.md. The Hub #151 and Hub #153 candidates use two interaction patterns in the component view:

- **Draft forms** (mode, integration settings, power, brightness, labels) pin the observed source. They lock after any accepted submit and keep the draft until the user discards it.
- **One-click commands** (playlist, playback, scene and the explicit Media or Free switch) use the rendered snapshot at activation and stay busy until the refreshed snapshot arrives.

Both put `configurationRevision:generation` in their guard.

The controllers checked for this decision:

- **Pixoo `main` `01da65d`.** The controller v1 `generation` is the player generation, which advances on every playlist item. Its integration extension uses a separate presentation generation that advances only when presentation is suspended. A Monitor mode command marks presentation active when the screen is requested on, including when Monitor is already configured.
- **Nanoleaf `main` `08b6b83`.** Any explicit mode command, including the same mode, ends power and brightness overrides. A same-mode command with no override and nothing pending finishes `cancelled` with `priorEffects: none` and no failure.

## Goals / Non-Goals

**Goals:**
- One deliberate action per supported change, with no unlock step after a result that is not uncertain.
- No `stale-generation` failure caused only by BUNNY sending guards read seconds earlier.
- Status text that says what happened, whether anything changed and what to do next, without claiming a physical result.
- Explicit same-mode actions that reuse the existing mode commands.

**Non-Goals:**
- Changing Pixoo's generation semantics, the controller v1 contract or any hub route.
- Automatic retry, restoration, a mode change as a side effect, or background commands.
- Installation, device operation and physical acceptance, which stay with Hub #154 and Hub #155.

## Decisions

- **Fresh guards are read immediately before sending.** The dashboard's device refresh resolves with the device record from a read that started after the call. A command waits for it, then builds its request from that read's ticket, configuration revision and generation. The device's per-device queue keeps the read ahead of the write. The owner chose this over a Pixoo change on the issue. Alternative: stop advancing the Pixoo controller v1 generation on item advances. Rejected here because it belongs to another repository and would not help an open brightness draft until Pixoo ships.
- **Availability is re-checked on the fresh read.** One function derives the common, general-control and content reasons from one device read. Rendering uses it, and every one-click action checks it again on the fresh read, together with the chosen playlist, action or scene still being declared. A draft form checks its control's reason the same way. A failed read or a newly unavailable control sends nothing and names the reason.
- **General-control drafts conflict on the configuration revision only.** Controller v1 configuration revisions serialize accepted desired changes from any client. The generation retires output work and changes without any client edit. A draft whose configuration revision still matches is sent with the fresh generation. A changed configuration revision keeps the draft, shows the conflict and sends nothing. The Nanoleaf integration settings, the mapping forms and the Pixoo integration forms keep their existing guards. They also read fresh before sending, so their ticket and generation are current.
- **Drafts settle in one step.** An accepted result that is not uncertain waits for the refreshed read, then clears the draft and unlock. The form starts again from current values, and the submitted ticket is still watched for its terminal outcome. An uncertain, partly applied or possibly effective result keeps the draft locked. **Reload current values** discards it, unlocks and refreshes. A pre-admission rejection keeps an editable draft.
- **A remaining race is shown, not retried.** A `stale-generation` or `revision-conflict` after the fresh read has no effects. The action stays available and the message invites one more explicit press with current values. No code path resubmits.
- **Plain status text comes from one function in `client.ts`.** It maps receipt outcomes, prior effects and typed failure codes to sentences:
  - **Queued:** the device has not received it yet.
  - **Sent** or **saved:** BUNNY cannot see the device, so check it to confirm.
  - **Already in effect:** nothing was sent.
  - **Not applied:** the reason and code, and that nothing changed.
  - **Result unknown:** it may have reached the device, so check the device, then reload.
  - **Partly applied:** what was sent and what is unknown.

  Codes stay visible in parentheses for diagnosis. Session label and acknowledgment forms say "Saved." without device wording.
- **Same-mode actions reuse the existing mode commands.** **Reapply <mode>** appears when a controller declares controller v1 modes, the mode is known and no mode change is pending. It sends one controller v1 `mode.set` for that mode. **Start Monitor** appears when Pixoo is configured for Monitor, not presenting and not switching mode. It sends one integration `mode: monitor` command. It is disabled while desired screen power is known to be off, because presentation starts only while the screen is on. Both actions use the one-click pattern, so they are busy until the refreshed read arrives. Their result text reports "Already in effect" when the controller had nothing to reapply.
- **Fixture fidelity.** The fake controller v1 distinguishes `stale-generation` from `revision-conflict`, and a test hook can advance the generation. The fake Nanoleaf ends overrides on any mode command and cancels a same-mode command with nothing to reapply. The fake Pixoo reports `participating` from the configured mode and requested screen power.

## Risks / Trade-offs

- [The fresh read adds one read before each command] → reads and writes already share the per-device queue with writes first, and the read is small. The slow-device scenario keeps other devices independent.
- [A fresh generation hides a concurrent output change the user did not see] → controller v1 generation retires output work, not desired configuration. Configuration changes from another client still conflict on the configuration revision, and content gating is re-checked on the fresh read.
- [A cleared draft loses a value the user wanted to repeat] → the cleared form starts from the refreshed desired value, which is the value just sent.
- [The wording change breaks the owner's familiarity] → the owner reviews the wording as part of UI approval.

## Migration Plan

No stored state, wire contract or configuration changes. The rebuilt static assets ship with the hub package as before. Rollback is the previous source package.
