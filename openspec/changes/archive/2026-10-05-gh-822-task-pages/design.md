## Context

The bridge's slot store (`state/slots.json`) keeps up to 15 slots in a private file. One bridge process writes it, through a private temporary file renamed over the target. The router maps the 15 slot keys to slots 1-15. Knob 4's turn (control 43) and click (control 31) were unassigned. Its LED is index 29 (from the #743 LED walk).

## Decisions

### Slot store

- **Numbering.**
  - Page p holds slots 15(p-1)+1 to 15p.
  - First-free assignment walks slots 1 to 15 x pages, so page 1 fills before page 2 and a freed slot anywhere is reused first.
  - Slots never move, so a task keeps its key and page until it is released.
- **Capacity.** The store gets its page count from the router: from the profile at construction and on every reload. The file format allows the 8-page maximum (slots 1-120), independent of the current profile.
- **File version.**
  - `SLOT_STATE_VERSION` becomes 2, with the same shape as version 1 but slots up to 120.
  - On read, a version 1 file (at most 15 slots, each 1-15) is accepted and lands on page 1.
  - On write, the store always writes version 2.
  - Opening alone writes nothing, so a rollback before the first slot change needs no edit.
  - The 5add03a reader accepts only `schemaVersion: 1`, so it stops start-up on a version 2 file (`chompi-bridge-state-invalid`) rather than misreading it.
  - The README rollback: stop the bridge, back up `slots.json`, keep only slots 1-15 and set `schemaVersion` to 1. A test runs this procedure against the version 1 reader path.
- **Fewer pages: keep, never drop or move.**
  - When `pages.count` shrinks below an assigned slot's page, the store keeps the task in memory and in the file.
  - That slot has no visible key, takes no new task, can still be released by archive evidence and shows again when the pages return.
  - The router logs `slots-beyond-pages` with the count at start-up and on each reload, and reports `beyondPages` in its status.
  - Refusing such a profile was rejected for three reasons:
    - the reason (assigned slots) is not visible in the profile file;
    - the reload would fail although every field is valid;
    - the owner could not reduce pages until those tasks were archived.
  - Keeping the tasks is reversible and preserves "a task never moves or is dropped".
- **Write and failure behavior are unchanged.**
  - One writer: the bridge process holds the single-instance lock.
  - Writes are atomic and serialized, with the in-memory slots authoritative and the next change retrying a failed write.
  - An unreadable or invalid file stops start-up.
  - A stray temporary file from a crash is ignored, because only `slots.json` is read.

### Router

- **Paging.**
  - Knob 4's turn goes through a small `Detent` helper, shared with the big wheel's card steps (each knob has its own instance): one page per `pages.stepCounts` counts, an accumulator that restarts on a reversal, and clamping at the ends.
  - `pages.stepCounts` defaults to the card step constant, so both knobs feel the same.
  - A page change logs `page` and re-renders. Nothing else happens: no adapter call, keystroke, focus or Hub contact.
- **Visible page.**
  - It starts at 1 and is not persisted, so after a restart the keys show page 1.
  - Slot keys map to (page - 1) x 15 + key for focus, the release gesture and lights. A held key keeps the absolute slot it showed when it went down, so paging during the release gesture's hold cannot release another task.
  - A reload clamps the page to the new count and resets the knob's partial rotation.
- **Overflow.** Reported only when every page is full, because the store only fails to place a task then.

### Lights

- Keys show the visible page's slots, and empty slots stay off.
- Knob 4's LED (index 29) shows `colors.pages[page - 1]`.
- While any task outside the visible page has attention (the slot's state is `attention`, which needs a current feed), the LED alternates between the attention color and the page color on the existing attention pulse. That includes slots beyond the profile's pages.
- Only attention shows there; other states show on the keys when their page is visible. This began as a pickup default; on 2026-10-05 the owner kept it ("We can keep it with the current setting of attention only."). The installed check with an unread task on a hidden page remains an observation of that behavior and settles no decision.
- **Default page colors:** cyan, magenta, green, grey-white, blue, pink, lime and teal. They are distinct from each other and from the attention orange, so the alternation reads as attention.

### Verification harness

The CHOMPI bridge verification harness (#853, merged in PR #855 after this change was first archived) handed task pages over to this story:

- **Catalog scenario `task-pages`:** a seed of 18 tasks across two pages runs in both tiers. It covers deliberate-turn paging, a page-2 task opened with its key, a hidden page's attention on knob 4's LED, the release gesture during paging and paging that sends no input.
- **Readiness:** it checks lit keys only for the visible page's slots, because slots on other pages have no key.
- **Control page:**
  - knob 4's LED gets its own `page` light role, named `page N` from the profile's page colors, or `attention` while it alternates;
  - knob 4's turn starts at one page step, as the big wheel starts at one card step;
  - its click reaches the bridge and stays unassigned.

## Risks

- A slot file written by this bridge is unreadable by older bridges until the documented pruning step. The bridge's own error names the file, and the README gives the step.
- Hidden-page tasks show only attention on the indicator. Activity, completion and stale states of hidden tasks are seen only by paging. The owner accepted this on 2026-10-05.
- A slot beyond the profile's pages has no key, so its attention pulses the indicator until `pages.count` is raised or the task is released; the README says how.
- Knob 4's click (31) is reserved: profile validation rejects mapping it to Record or Back, and Send already refuses every small-knob click.

## Persistent-state walkthrough

- **Writer:** the one bridge process, under its single-instance lock. Hub retention never writes this file.
- **Timeout:** none. Writes are local and serialized, and a failed write is reported (`slot-state-write-failed`) and retried at the next change.
- **Restart:** the file is reloaded, with every slot on its page. The visible page resets to 1. Nothing is replayed.
- **Duplicates:** a task identity or slot number repeated in the file is invalid and stops start-up. First-free assignment never creates either.
- **Important failure test:** an interrupted write leaves the last good file intact, and a stray temporary file is ignored.
- **Diagnosis:**
  - `chompi-bridge-state-invalid` with the reason (for example an unsupported `schemaVersion` after a rollback);
  - `slots-beyond-pages` with its count;
  - `overflow` with its count.
- **Recovery:** fix or restore `slots.json` from the backup; for a rollback, prune slots above 15 and set `schemaVersion` to 1.

## Acceptance examples

| Example | Test |
| --- | --- |
| First-free assignment across pages; overflow only when every page is full | `routing-slots.test.mjs`, `routing-router.test.mjs` |
| A version 1 file loads onto page 1; opening writes nothing; the next change writes version 2 | `routing-slots.test.mjs` |
| Stable positions while tasks come and go; first-free reuse across pages | `routing-slots.test.mjs` |
| Release on a hidden page (store) and the release gesture on page 2 (router) | `routing-slots.test.mjs`, `routing-router.test.mjs` |
| Fewer pages keep every task beyond the pages, and a reload clamps the visible page | `routing-slots.test.mjs`, `routing-router.test.mjs` |
| Interrupted write: stray temporary file ignored, refused write reported, old file intact | `routing-slots.test.mjs` |
| Corrupt files (bad JSON, unknown version, slot 121, slot 16 in version 1, repeats) stop start-up | `routing-slots.test.mjs` |
| Downgrade: version 2 refused by a version 1 reader; the README rollback loads | `routing-slots.test.mjs` |
| Knob 4 detents: light touches, reversal, clamping; paging is never input; keys act on the visible page | `routing-router.test.mjs` |
| Visible-page key lights and the page LED with the hidden-page attention pulse | `routing-router.test.mjs`, `routing-lights.test.mjs` |
| Profile page settings, page colors and knob 4 reserved from scrolling | `routing-profile.test.mjs` |
| The `task-pages` catalog scenario in Tier 1 and Tier 2; knob 4's light role and paging from the control page | `scenarios.test.mjs`, `test:chompi-bridge:scenarios`, `verify/tests/steps.test.mjs`, `panel.test.mjs`, `verify/tests/page.browser.mjs` |
