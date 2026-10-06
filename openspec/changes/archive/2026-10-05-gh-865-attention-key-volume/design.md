## Context

The router maps 15 white slot keys across task pages (#822), Record (26), Play and the big-wheel click (Send), Loop (Back) and the big-wheel turn. The black keys (16-25), knobs 1-3 and the volume knob (`ENC_6`: turn 46, click 34, LED 34) were inert. The Hub's snapshot carries attention kinds per session but no time for them. The OS adapter (interface version 3) types allowlisted shortcut keys through a held-key tracker that refuses a tap while it holds keys or while the user holds a modifier.

## Decisions

### Profile

- **Attention click on knob 4 (owner decision on #865, 2026-10-06).** The first design put the Attention action on black key 1 by default. The owner moved it to small knob 4's click (control 31), which #822 had left unassigned. The profile switch is `pages.attentionClick` (default `true`), not a control number such as `controls.attention`. Control 31 can carry only this action, so a number would allow just one value, and knob 4 already belongs to the `pages` section. The default lives in code (`DEFAULT_PAGE_SETTINGS`), so the installed owner profile gets the click without edits. Validation still rejects 31 for any control; the message now says it carries only the Attention action.
- **Black-key map without a default.** `keys` stays for later presets, and `DEFAULT_KEY_ACTIONS` is empty. A black key may still map to `attention` (the same action) or `back`. An explicit entry whose control the `controls` section maps (a slot, Record, Send or Back) is rejected with the owning path.
- **Volume section.** `volume.stepCounts` (1-96, default 1) and `volume.invert` (default `false`, clockwise raises). Default 1 sends one volume key (2 points in Windows) per count until #745 measures the knob. With a `volume` section, `controls.scroll` 46 and `controls.record` or `controls.back` 34 are rejected. Without one, such an earlier profile keeps its mapping and `volume` is null, so the knob sends no volume key. Send could never be 34 already.
- **Repeat window.** `timing.attentionRepeatMs` is optional (500-30000 ms, default 4000), the first optional timing field. Four seconds covers opening and glancing at a task (verification takes up to 3 s) before a second press moves on.

### Attention click

- **Order.** The router keeps a map from slot key (the full task identity) to a sequence number. After every reconcile on a current feed, it adds each assigned task whose slot state is `attention` and removes tasks that no longer wait. On every reconcile it also forgets tasks that no longer hold a slot. Tasks seen in the same snapshot are numbered in slot order. Attention that clears and returns gets a new, later number. A stale feed changes nothing in the map, so a brief stale spell keeps the order. The map is memory only and restarts with the bridge, as the issue specifies.
- **Target.** Waiting tasks are assigned slots on the profile's pages whose state is `attention`, sorted by sequence. Slots beyond the pages have no key to show and are skipped. With nothing waiting, or a stale or unavailable feed, the press refuses (`attention-refused`, `none-waiting` or `feed-<status>`) and flashes knob 4's LED (or the pressed black key) for the error flash time; no adapter call happens.
- **Repeat.** A press within the window of the last one opens the first waiting task numbered after the last target, or wraps to the earliest. A task answered in between has dropped out, so the press still moves forward. Outside the window, the earliest opens again.
- **Open.** The visible page switches to the target's page (logged as `page`), and the press runs the slot key's own path (`#slotPress`): invalidate, then target check, link, verification and composer. A failure flashes the slot key as a slot press does. The press is navigation: no acknowledgement, no Hub request, no Send.
- **Light.** The Attention click has no light of its own. Knob 4's LED keeps the #822 indicator (page color, alternating with attention while a hidden page has a waiting task), and a waiting task on the visible page pulses its key. A refusal flashes knob 4's LED in the error color, after which it shows the page again. A black key mapped to `attention` shows the attention color, steady, while any task waits, and is red for its own refusal.

### Volume knob

- **Adapter.** Interface version 4 adds `sendVolumeKey(key, presses)` for `VolumeUp`, `VolumeDown` and `VolumeMute` (`0xAF`, `0xAE`, `0xAD`, sent as extended keys) with 1-10 presses in one `SendInput` batch of down/up pairs. A separate operation, rather than three new shortcut key names, keeps the profile's key allowlist unchanged, so no shortcut can name a volume key, and states in the interface that these keys need no window.
- **Router.** A turn goes through its own `Detent`. A single volume worker coalesces turns that arrive while a call runs into calls of at most 10 presses, and mute clicks into their parity: one pending toggle for an odd number of clicks and none for an even number, so the final mute state always matches the number of clicks. A failed call is logged (`volume-failed`), flashes the volume LED and drops pending work; nothing is retried. Invalidations (loss, Back, profile swap, slot press) drop pending volume work and partial rotation.
- **Record interaction: ignore.** While Record is held or the chord is down, a volume detent or click is dropped with `volume-ignored` (`dictating`) and a volume LED flash. The other choice, releasing the chord to send the key, would end dictation mid-sentence, and re-pressing the chord afterwards would start a new dictation. Ignoring keeps the chord exactly the dictation chord. Two more layers back this up. The adapter's tracker refuses a volume tap while it holds any key (`keys-held`). A Record press waits for an in-flight keystroke, now a volume key as well as Send's Enter, before pressing the chord. Each volume tap is one atomic batch, so the chord can never interleave with it.

### Verification harness

- The simulated desktop keeps a synthetic system volume (start 50, 2 points per press, 0-100) and mute state. A volume step unmutes, as Windows does. Like the keyboard, it refuses a volume key while keys are held, and it logs each volume key with no window.
- **`attention-key`:** 18 tasks across two pages. Refusal with nothing waiting, first-seen order across pages, repeat cycling, the earliest again after the window, read-only Hub requests and attention kept.
- **`volume-knob`:** detents and mute change the system volume with no client input. During Record the knob is ignored and the chord stays exact.
- The panel names knob 4's LED `error` during a refusal and derives a mapped black key's `attention` light role from the router's key map (`keyControls`) and gives the volume LED its own role. The control page shows the system volume and each volume key in the desktop log.

## Risks and residuals

- `volume.stepCounts` 1 is a guess until #745 turns the real knob; the owner tunes it in the profile.
- The first-seen order restarts with the bridge, as the issue specifies. After a restart, tasks already waiting are ordered by slot.
- The Hub reports some question cards as `approval` (#823); either kind counts as waiting, so the Attention click is unaffected.
