## Context

The [#740 report](../../../docs/chompi-controller-qualification.md#routing-design) fixes the routing design: the Hub in WSL stays the only agent-state owner; one Windows bridge process is the only CHOMPI writer; tasks open by `codex://threads/<id>` and the undocumented `claude://code/continue?session=local_<id>`; and nothing is typed until foreground identity, task selection and composer focus are verified. [#741](https://github.com/jimmie-potts/agent-device-hub/issues/741) supplies the bridge events (`connected`, `input`, `stale`, `recovered`, `session-restart`, `disconnected`, with synthetic releases) and `setLeds`/`setBrightness`. `src/os-adapter.ts` defines adapter interface version 1: every observation is `known` or `unknown`, and titles are compared inside the adapter so no title text crosses it. [#784](https://github.com/jimmie-potts/agent-device-hub/issues/784) adds optional `hostSessionId` to root Claude Desktop sessions in snapshot 1.3.

Owner decisions that bind this change: stable first-free slots released only by explicit completion or archive; big-wheel click Send; small-knob clicks never send; Wispr Flow through the computer microphone; JSON configuration; the Claude release gesture (slot key held with Loop); Claude routing disabled on an unqualified Desktop version.

## Goals / Non-Goals

**Goals:** stable slots that survive restarts, reconnects and Hub retirement; lights that keep activity, attention, notice acknowledgment, read evidence and freshness distinct; no keystroke without a verified target; at most one Enter per Send; no held modifier after any loss.

**Non-Goals:** installation, live client focus, dictation placement and optical results (#743); knobs, model and effort, paging, manual reassignment and the upper-key prompt library (#744 and later); a visual configuration editor; a macOS adapter; any Hub write.

## Decisions

### 1. Module layout

`src/routing/` holds portable TypeScript: `profile.ts`, `feed.ts`, `slots.ts`, `lights.ts`, `router.ts` and `files.ts` (private atomic writes). The router talks only to the `OsAdapter` interface and a minimal light sink (`setLeds`, `setBrightness`), so every rule runs on Linux against a fake adapter, a fake `fetch`, `ManualClock` and the #741 simulator. `src/windows/` implements the adapter. `cli.ts` composes them. `createOsAdapter()` returns the Windows adapter on Windows and otherwise an unsupported adapter whose observations are all `unknown`, so routing there fails closed.

The Windows adapter uses koffi FFI (`SendInput`, foreground window and package identity, `ShellExecute`) and a long-lived PowerShell UI Automation helper (`src/windows/uia-helper.ps1`, read from `src/windows` by the built code, so installation ships it). It returns `unknown` or `false` whenever the client is not in front: `composerFocused` is `false` and `codexSelectedTitle` is `unknown`. No approval-card selector is qualified, so `approvalVisible` is always `unknown` and Send stays refused until #743 qualifies one.

### 2. Profile

One JSON file with `schemaVersion: 1`, at most 64 KiB:

| Field | Default | Rule |
| --- | --- | --- |
| `profileVersion` | 1 | u32 sent in host heartbeats |
| `controls.slots` | controls 1-15 | 15 distinct key IDs (1-25); slot *n* is the *n*th entry |
| `controls.record` | 26 (CHOMPI key) | click ID, held for dictation |
| `controls.send` | `[33]` (big-wheel click); add 27 for Play | click IDs; never a small-knob click (29-32), the volume click (34), a slot, Record or Back |
| `controls.back` | 28 (Loop) | alone: clears the target; with a held slot key: release gesture |
| `controls.scroll` | 45 (big-wheel turn) | turn ID; scrolls the client conversation through the adapter's `scrollClient` |
| `scroll.notchesPerStep`, `scroll.invert` | 1, `false` | 1-10 wheel notches per detent; clockwise scrolls down unless inverted |
| `shortcuts.codexComposer` | `LeftAlt` + `L` | key names the Windows adapter types: `Enter`, `LeftShift`, `LeftControl`, `LeftAlt`, `LeftWindows`, `A`-`Z`, `0`-`9`; never `Enter` here |
| `shortcuts.send` | `Enter` | exactly `Enter` |
| `shortcuts.dictation` | `LeftControl` + `LeftWindows` | modifiers only, so never `Enter` |
| `colors.*` | see the default file | RGB triples for `empty`, `active`, `idle`, `unread`, `attention`, `ended`, `unknown`, `stale`, `error`, `selected`, `record`, `sendReady`, `sendBlocked` |
| `brightnessPercent` | 40 | 0-100, sent with `setBrightness`; firmware caps still apply |
| `timing.*` | see below | bounded integers in milliseconds |
| `qualifiedVersions.codex` | `["26.930.3930.0"]` | required; an unlisted or unknown version disables Codex routing, because the UI Automation selectors depend on it |
| `qualifiedVersions.claude` | `["2.19675.0.0"]` | required; an unlisted or unknown version disables Claude routing (selectors and the undocumented link) |

Timing defaults: verification timeout 3000 and poll 100; adapter call timeout 2000; Send repeat window 1000; release-gesture hold 800; attention pulse period 1000; error flash 1500; archive check 30000; profile poll 2000.

Unknown fields, wrong types, out-of-range values and overlapping controls reject with a path-qualified message such as `profile.controls.send[0]: 30 is a small-knob click`. The profile holds no URIs, paths, commands or package identities: links, package families and the snapshot request are fixed in code, and key names are exactly the adapter's key table, so a valid profile never asks for a key the adapter would refuse. Loading never runs anything.

A reload reads the whole file, validates it, and only then swaps it in; an invalid or unreadable file is reported and the last good profile stays. Swapping in a new profile clears the target and releases held keys, replays no earlier event, and sends the new `profileVersion` in the following host heartbeats (`bridge.setProfileVersion`). A missing or invalid profile at start exits before the device opens.

### 3. Hub feed

`HubFeed` reads `GET /api/monitor/v1/sessions?snapshotVersion=1.3` with `Authorization: Bearer <token>`, then follows `GET /api/monitor/v1/changes`. Every `state` or `resync` event schedules one snapshot refetch (one in flight, one pending); events are never replayed. The token is read from a private file at each connection attempt, never logged, and on POSIX the file must not be group- or world-accessible. The origin must be `http://127.0.0.1:<port>`, matching the Hub's numeric loopback rule. Requests are only GETs to those two paths.

Bounds: 3000 ms per snapshot request, a 2 MiB snapshot body, a 64 KiB SSE line buffer, and 5000 ms of stream silence (the Hub heartbeats every second) before the stream is dropped. After a failure the feed retries every 2000 ms. A 400 for version 1.3 falls back to 1.2, where no session carries `hostSessionId`, so Claude routing stays off until the Hub is upgraded. The feed asks for 1.3 again every 5 minutes and on every reconnect, so an upgrade is picked up without a bridge restart.

The feed status is `unavailable` before the first snapshot, `current` while the last snapshot succeeded, the stream is open and the collector is `running`, and `stale` otherwise. A stale feed keeps the last snapshot for display.

### 4. Slots

| Client | Eligible Hub sessions | Slot key |
| --- | --- | --- |
| Codex | provider `codex`, client `desktop`, parent not `known` | Hub `sessionId` (the Desktop thread ID) |
| Claude | provider `claude`, client `code`, parent not `known`, `hostSessionId` present | `hostSessionId` (`local_<id>`, which survives `/clear`) |

The key also carries host and source, so equal IDs from different sources stay separate. IDs must match a URI-safe grammar (`[A-Za-z0-9-]{1,128}` for Codex, `local_[A-Za-z0-9-]{1,122}` for Claude); others are ignored.

Each new snapshot's unassigned keys are sorted by provider, client, host, source and task ID, then given the lowest free slots. Keys already assigned never move. When all 15 are full, the rest are reported as overflow and stay unassigned until a slot frees, when the next one in the same order takes the lowest free slot. Several Hub records with one Claude Desktop ID (after `/clear`) are one slot, displayed from the newest record. After a Hub restart a Claude session can lack `hostSessionId` until its next event; it still matches its slot by the last Hub session ID the slot saw.

A slot is released only by explicit evidence: the adapter reports the Codex thread archived (an `archived_sessions` filename) or the Claude Desktop record archived (`isArchived`), checked every 30 s and at each key press, or the Claude release gesture. Absence from the feed, Hub retirement or expiry, idle, stale feed, a missing Desktop record and an unknown observation never release. Extending the gesture to Codex needs an owner decision, so on a Codex slot it only flashes the error light. A released task stays out of the slots while the Hub still lists it, and returns to the lowest free slot only when it shows lifecycle evidence newer than its release; otherwise the next snapshot would place a live Claude session straight back after the gesture.

The store is `<state>/slots.json` (`schemaVersion: 1`): slot number, client, provider, Hub client, host, source, task ID, last Hub session ID, last-known title and assignment time. The file also keeps those release markers (at most 256). It is written with mode 0600 through a temporary file, `fsync` and rename; the state directory is created 0700. It is separate from Hub retention. An unreadable or invalid file stops start-up rather than reassigning slots. The title is stored only because Codex verification compares it.

### 5. Lights

| Slot state | Rule | Default |
| --- | --- | --- |
| `empty` | no task | off |
| `attention` | the Hub record has attention of any kind | amber, pulsing |
| `active` | activity `active`, freshness current | blue |
| `unread` | idle or interrupted with a notice nobody acknowledged and read evidence not `read` | green |
| `idle` | idle or interrupted otherwise | dim cyan |
| `unknown` | activity `unknown`, freshness `uncertain` or restart uncertainty | dim violet |
| `ended` | no Hub record, or activity `ended` | dim white |
| `stale` | the feed is stale or unavailable (every assigned slot) | dim orange |
| `error` | a refused action, for 1.5 s | red |

Only `unread` uses the completion color; unknown, ended and stale never do. The verified target's key shows `selected` over its state, except that attention keeps pulsing on it, alternating between the attention and selected colors, so focusing a task never looks like acknowledging it; the Record LED shows `record` while dictating, and the two wheel LEDs show `sendReady` when a verified target exists and `sendBlocked` while the Hub reports an approval for it. Other LEDs stay off. Colors use the profile's RGB values and the brightness percent goes to the firmware with `setBrightness`. The renderer returns a state label per slot for any companion view or status line. Disconnected display belongs to the firmware's own pattern; the router sends nothing special for it.

### 6. Focus, fail closed

A slot key press starts a new attempt and invalidates any earlier target. Each await rechecks an attempt generation, so a later press, a bridge `stale`, `session-restart` or `disconnected`, Back or a profile swap cancels it. Steps:

1. **Target check.** The slot is assigned; the client's version is qualified (both clients are gated); Codex `codexArchived` is known `false`; Claude `claudeSessions` returns the record with `isArchived=false`. Archive evidence releases the slot.
2. **Open.** The fixed link for the client with the URI-encoded ID.
3. **Verify** (polled every 100 ms up to 3000 ms; observation retries only). The foreground package family is `OpenAI.Codex_2p2nqsd0c76g0` or `Claude_pzs8sxrjxfjjc`. Codex: `codexSelectedTitle(lastTitle)` matches with `sameTitleRows === 1`; a missing title fails. Claude: the target's `lastFocusedAt` is later than the press time and no other known Claude Desktop record (every slot's and every feed session's ID, read 64 at a time, never truncated) is later than the press time.
4. **Composer.** Codex taps the composer shortcut once; both then require `composerFocused` to be known `true` within the timeout.

Any failure or unknown flashes the key's error light, logs the step and reason without titles, and leaves no target. A key press never acknowledges, approves or dismisses anything.

### 7. Record and Send

Before both, the router re-checks in one pass: the target is current, the foreground package matches, the selection still verifies (Codex title and row count; Claude target record not superseded by a newer one) and the composer has focus. Any unknown refuses.

- **Record** holds the dictation chord (`down`) after the checks pass and releases it (`up`) on the Record release, including a synthetic one. If Record is released before the checks finish, nothing is pressed. Release never sends.
- **Send** additionally requires a current feed, no Hub `approval` attention on the target's records and `approvalVisible` known `false`, no dictation in progress, no Send in progress and no Send in the last 1000 ms. It then taps Enter once. A rejected or timed-out keystroke is uncertain: the target is cleared, the key flashes error and nothing is retried. So Send is refused by Hub `approval` attention, a stale or unavailable feed, or approval visibility that is `true` or unknown (the Windows adapter answers unknown until #743 qualifies a selector). Question and input attention do not block Send, because answering them is the point.
- Small-knob and volume clicks, every turn, slot keys, Record and Back can never produce Enter: the profile cannot map them to Send, and turns never type.
- **Scroll.** A big-wheel turn calls the adapter's `scrollClient(client, notches)` (positive notches scroll up), which sends mouse-wheel input only while that client is in front with the pointer inside its window, and otherwise answers `false`. The client is the target's, or without a target the foreground app when its package family is Codex or Claude; any other app gets nothing. Turns coalesce into one call at a time (at most 10 notches per call, 50 waiting). Scroll never types, selects a task or changes the target, never runs while Record is held, and a `false` or unknown answer is dropped, logged when unknown, and never retried. Other encoder turns are inert here (#744).

### 8. Loss and invalidation

A slot key press, Back, bridge `stale`, `session-restart` or `disconnected`, a closed event subscription, a profile swap and shutdown all clear the target, end dictation and call `releaseAll()`. After recovery a fresh slot press is required. Slots and their persisted state are untouched.

SIGINT, SIGTERM, SIGHUP and, on Windows, SIGBREAK stop the bridge through that shutdown. A `process.on('exit')` hook calls the adapter's synchronous `releaseAllSync()`, and an uncaught exception or unhandled rejection releases keys the same way, prints `chompi-bridge-fatal` and exits 1. A forced kill runs no code; a chord held at that instant stays down in Windows until those keys are pressed and released. At start-up the CLI calls the adapter's `warmUp()` (helper process, cached client versions) before the controller connects, and logs `adapter-ready` or `adapter-warm-up-failed`. A version-gated focus failure logs the observed version so the owner can qualify a client update.

## Acceptance examples

Written before implementation; each maps to named tests in `apps/chompi-bridge/tests/routing-*.test.mjs`.

1. **First free, stable.** Codex threads A and C are in slots 1 and 2; A is archived, freeing slot 1. B and D are discovered in one snapshot, so B takes slot 1 and D slot 3. After a bridge restart with the same file, a reconnect and a Hub restart without `hostSessionId`, all keys stay where they were.
2. **Overflow.** With 15 slots full, two new tasks are reported as overflow; nothing moves. Archiving slot 7's thread gives slot 7 to the first overflow task in sort order.
3. **Retirement keeps the slot.** The Hub drops a session after idle; its key shows `ended`, still opens the same thread and is not freed.
4. **Distinct states.** Active is blue; attention pulses even while active; an unacknowledged completion is green only while read evidence is not `read`; acknowledged is idle; uncertain freshness is violet; a stale feed turns every assigned key orange; nothing unknown is green.
5. **Codex focus.** Pressing slot 2 opens `codex://threads/<id>`, sees Codex foreground, a matching title with one row, taps `LeftAlt+L` and sees the composer focused; the key shows selected and nothing else is typed.
6. **Foreground alone is not enough.** Codex comes forward but the selected title does not match (unknown ID), or two rows share the title: error light, no keystroke after the link.
7. **Claude by ID.** With a qualified version and record `isArchived=false`, the link uses `local_<id>`; only the target's `lastFocusedAt` advancing verifies. Another session also advancing, an unknown version, a missing or malformed ID or an archived record each fail, the last one also releasing the slot.
8. **Task switch.** Slot 1 verified, slot 2 pressed: slot 1's target is gone at once, and a Send while slot 2 is still verifying is refused.
9. **Send once.** A verified target, current feed, no approval: one wheel click taps Enter once; a second click 200 ms later does nothing. If the keystroke rejects, the target clears and no retry happens.
10. **Approval blocks Send.** The Hub shows `approval` for the target, or `approvalVisible` is `true` or unknown: Send refuses; the key press before it acknowledged nothing (only GETs reached the Hub).
11. **Record.** Record after a verified target holds `LeftControl+LeftWindows`; releasing Record releases it and taps nothing. Record without a verified target, or released before checks finish, presses nothing.
12. **Loss.** A disconnect or `session-restart` during Record emits the synthetic release, the chord comes up, `releaseAll` runs and the next Send is refused until a fresh slot press.
13. **Profile reload.** An invalid edit keeps the last good profile and reports a path; a valid edit swaps in, clears the target, releases keys and replays no earlier press.
14. **Not Send.** Small-knob clicks 29-32, the volume click and turns of every encoder never tap Enter, and the profile refuses mapping them to Send.
15. **Claude release gesture.** Holding slot 4 (Claude) for 800 ms and pressing Loop releases slot 4 and persists it; the same on a Codex slot flashes error and keeps the slot.

## Risks / Trade-offs

- The Claude link and session store are undocumented → version gate, ID verification and #743 live observation.
- UI Automation may not expose the Codex selected row or composer → every unknown fails closed; #743 records what Windows exposes.
- Blocking Send on a stale feed makes Send depend on the Hub → an over-block is safer than approving a request with Enter.
- Persisting titles keeps personal data on the bridge host → private file, never logged or published.
- A session deleted rather than archived keeps its slot → visible as `ended`; the Claude gesture frees Claude slots; a Codex gesture needs an owner decision.

## Migration Plan

New files only. The routing `run` form needs the new flags; the earlier `run`, `probe` and `monitor --simulate` forms are unchanged. Rollback is stopping the bridge; `slots.json` can be deleted to start with empty slots.

## Open Questions

- #743 confirms the big wheel's control ID, Record and Back, and qualifies an approval-card selector. Until then the Windows adapter's `approvalVisible` is always `unknown`, so Send is refused in real use; focus and Record work.
- #743 confirms the wheel's detents and whether the default direction feels right; `scroll.invert` flips it.
- Extending the release gesture to Codex needs an owner decision.
