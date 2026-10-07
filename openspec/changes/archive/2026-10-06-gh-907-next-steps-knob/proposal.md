## Why

PROMPTI (the owner's name for the CHOMPI agent controller) leaves small knob 3 inert. On 2026-10-06 the owner decided that knob 3 picks Claude's suggested next steps instead of setting an explanation style ([#744](https://github.com/jimmie-potts/agent-device-hub/issues/744)). Claude Desktop already runs the `next-steps` mod, which shows up to three suggested next prompts as buttons above the composer after a turn. Short replies, question answers and workflow prompts are about a quarter of the owner's turns. The same day a live qualification on the trial host recorded the suggestion band's UI Automation structure, a focus-only test and Claude's ghost text, and the owner accepted the knob 3 click rule. Owning issue: [#907](https://github.com/jimmie-potts/agent-device-hub/issues/907).

## What Changes

The design reuses #906's keystroke-free patterns: UI Automation actions checked against a fresh read, gating reads that wait for a lagging view, one flow at a time and the shared no-stray-key assertion.

- **Knob 3 turn:** the first detent moves keyboard focus to the first suggestion and each further detent one suggestion, read back, stopping at the ends; "dismiss" is never a stop. It needs Claude qualified and in front, no card or menu open, a band showing and an empty composer. Claude draws its own focus ring, which the owner confirmed.
- **Knob 3 click (owner-accepted rule):**
  - With a suggestion highlighted: `Invoke` on it, which writes it into the composer as a draft, then the composer gets focus back, so Play sends it.
  - With nothing highlighted: one Right arrow through `tapInClient` accepts Claude's ghost text, only when a fresh read shows Claude's composer focused and empty and no card or menu open. Ghost text is invisible to UI Automation; a Right arrow in an empty composer is harmless.
  - Either way it fills a draft only: never Enter, never Send.
- **Refusals** with knob 3's red flash: Codex in front (#908 owns Codex next steps), another app, no band on a turn, a draft in the composer, an unfocused composer for the ghost case, a card or menu open, Record held, an unknown state.
- **Closing:** another control, a timeout, a profile reload or a controller loss drops the highlight by focusing the composer, through #906's queue, so two flows never act at once.
- **Empty composer:** the composer's value is empty or only one trailing line break, since Claude's empty composer reads as one `\n`.
- **Profile (`schemaVersion` stays 1):** an optional `nextSteps` section (`stepCounts` 6, `invert`, `clickStillMs` 250), defaulted in code, so the installed owner profile gets knob 3 without edits. Knob 3's turn (42) and click (30) are reserved like knobs 1 and 2.
- **Lights:** knob 3's LED (28) shows `active` while a suggestion is highlighted, then `applied`, `unknown` or `error`.
- **OS adapter interface version 6:** `suggestionState` (counts and booleans only, never suggestion text), `focusSuggestion` and `invokeSuggestion`, each acting only on the qualified band after a fresh read. They are implemented in the Windows adapter and helper, the unsupported adapter, the simulated desktop and the test fake, with a shared simulated band (`src/sim/suggestions.ts`) that can lag one change behind.
- **Verification harness (#853):** three catalog scenarios (`claude-next-step-pick`, `claude-ghost-accept`, `next-step-refusals`) in Tier 1 and from the control page; the control page shows Claude's band and can show and hide synthetic suggestions; the browser check drives knob 3.
- **Native check:** records the band's shape read-only, without text, and calls neither suggestion action.
- **Docs:** the bridge README, the verification README, the UIA notes (the band, the empty rule, the residual window of the one Right arrow), the qualification report (control map, the Claude row and installed checks for #907 under #745), the development guide and the app verification overview.

## Capabilities

### Modified Capabilities

- `chompi-task-routing`: knob 3's light, release on loss for its flow, the optional `nextSteps` profile section, and a new requirement for the next-step knob.
- `chompi-bridge`: OS adapter contract version 6 with the next-step band read and its two UI Automation actions, and the simulated desktop at version 6 with the band, its ghost text and lagging reads.
- `chompi-bridge-verification`: the control page's next-step view and controls and knob 3's light names, and the three next-step scenarios.

## Impact

This changes the bridge package only and extends its released 1.x surfaces additively, as ADR 0012 requires until the platform cutover: one optional profile section, new log event types and no new message format or Hub path. The profile stays at `schemaVersion` 1, so the installed owner profile loads unchanged and gets knob 3. The slot file is unchanged. An earlier bridge rejects the optional `nextSteps` field as unknown, so a rollback removes it. The OS adapter version is internal to one installation: the bridge and its adapters ship together. Delivery is source-only; #745 owns installation, the owner's physical checks and the live qualification of the helper's band read and actions.
