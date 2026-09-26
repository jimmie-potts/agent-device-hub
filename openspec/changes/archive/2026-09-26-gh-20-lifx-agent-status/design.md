## Context

Tidbyt's #19 delivery already computes a per-session highest state (ASK/RUN/DONE) from the shared agent-state feed and draws it as a 64×32 frame, with a hub feed reader (`HubStatusFeed`) and generic feed-cadence machinery (`EvaluationLoop`, `BoundedReader`) that any future status-consuming controller would need identically. LIFX's controller (#17/#22 qualification, #330 on-demand reads) has no automatic behavior yet: it only accepts explicit commands.

## Goals / Non-Goals

**Goals:** one shared home for the per-session ranking and hub feed reader; LIFX paints one shared color per shown-state transition on qualified bulbs in Work or Quiet; Free never paints; per-bulb brightness/quiet caps; modes persist across a restart; the dashboard's existing mode-control and content-gating pattern extends to LIFX.

**Non-Goals:** Beam or any unqualified bulb; lighting effects; a periodic poller replacing transition detection; changing Tidbyt's observable behavior, cadence or wire format; a new controller-contract wire value; installation or the physical check (#22).

## Decisions

### Package placement: `packages/agent-status`

Move `HubStatusFeed` and its bounded hub GET helpers (`hubOrigin`, `hubToken`, `hubJson`, `HUB_ID`), the per-session ranking (`sessionState`, renamed to the neutral `AgentState` values `attention`/`working`/`done`) and its whole-owner reduction (`highestStatus`), and the generic feed-cadence machinery (`EvaluationLoop`, `BoundedReader`, `systemTimers`) out of `controllers/tidbyt`. `controllers/tidbyt/src/runner.ts` re-exports `HubStatusFeed`; `controllers/tidbyt/src/publishing.ts` re-exports the loop/reader/timers; `controllers/tidbyt/src/status.ts` maps the shared `AgentState` values to its own `ASK`/`RUN`/`DONE` display vocabulary. Every existing Tidbyt test passes unmodified, proving the move is behavior-preserving. `STATUS_COLORS` (the RGB triples Tidbyt draws and LIFX now converts to HSBK) also moves to `agent-status` as the single source of truth both controllers read; Tidbyt's own `STATUS_COLORS` export is rebuilt from it.

Alternative considered: leave the ranking/feed code in `controllers/tidbyt` and have LIFX import from there. Rejected: it would make the LIFX controller depend on the Tidbyt controller package for logic that has nothing to do with a Tidbyt display, and the coordinator's placement checkpoint explicitly named this package.

### `highestStatus`: uncertain poisons the whole result

Unlike Tidbyt's per-row view, which dims an uncertain session but still shows a marker, `highestStatus` returns `unknown` if **any** shown session (one with a state at all) has uncertain freshness, alongside the existing `unknown` for an unavailable feed or non-running collector. A session with nothing outstanding never poisons the result even if its freshness happens to be uncertain. This follows directly from the issue's "no paint when...a session's freshness is uncertain": painting one color for the whole owner's status cannot assert a state some evidence cannot currently support, unlike Tidbyt's per-session rows which can dim just the affected row.

### LIFX controller: mode ownership, persistence and the internal paint

The controller, not the publisher, owns the mode. `LifxController` takes an optional `modeStateRoot`; the package has no default of its own, so without one every bulb advertises `modes: {supported: false}` regardless of qualification and `mode.set` is `unsupported-capability`. The owning host derives one from its own bulb-lease root (`<leaseRoot>/modes`), so modes exist only where a real writer lease already does, and no source test ever touches a real home directory by omission. Each bulb reads its persisted mode once at construction, keyed by a SHA-256 hash of its `deviceId` (not its address, which is private), defaulting to Free when the file is missing or invalid. Reading and writing that file follow the same fail-closed rules as this codebase's other private-file/lease checks: the directory is created at `0700` if missing, then required to already be a real, owner-only directory; the file is opened `O_NOFOLLOW` and must be a small, owner-only regular file to be trusted, so a symlink or a mismatched owner reads as Free rather than being followed or accepted. `mode.set` sends no bulb traffic: `execute()` gains an early branch that writes the mode file through an exclusive (`O_CREAT|O_EXCL`), non-following, owner-only temporary file and an atomic rename, and only then updates the in-memory mode, `state.desired.mode`, and notifies `onModeChange` listeners. An unsafe directory or a write failure throws, which the surrounding admission machinery turns into a failed receipt without changing anything.

The contract's receipt schema ties `outcome: "sent"` to `priorEffects: "confirmed-transmission"` (`allOf` `if`/`then` on `completedOperations` having entries); there is no valid receipt shape for "succeeded with certainty, nothing was transmitted." A successful `mode.set` therefore reports `outcome: "sent"` / `priorEffects: "confirmed-transmission"` / `completedOperations: ["set"]` like any other completed write; the persisted file is its own point of effect, with no possibility of a lost transmission, unlike a real transport write. A persistence failure reports `outcome: "failed"` / `priorEffects: "none"` / `failure.code: "transport-failure"` — the closest code in the closed set for "the attempt could not complete," since there is no dedicated local-storage failure code — and leaves the mode, `desired.mode` and bulb `serviceHealth` unchanged (health tracks transport, not local I/O).

The internal status paint (`paintStatus(deviceId, hsbk)`) mints its own envelope from the bulb's current `next` sequence, `revision` and `generation`, exactly as an admitted command would, and shares the bulb's queue, generation-cancellation and receipt bookkeeping (`retain`, `cache`, `pending`). Its command carries a private kind (`lifx.internal.status-paint`) that is never constructed from external input: `parsed()` only recognizes the public common-v1 union and the `lifx-light` profile schema, both of which reject this kind, so no HTTP route or public `submit()` call can reach it. A paint that cannot be admitted (queue at capacity, or the bulb unknown) is a failed attempt and is not retried by the controller; the publisher's own transition detection handles retry-by-next-transition. As defense in depth, `paintStatus` also rejects an unqualified bulb outright (`unsupported-capability`, no traffic, no pending entry) even though the publisher never calls it for one.

Alternative considered: model the paint as a `LightingCommand` variant validated by the public schema but filtered out of `parsed()`'s acceptance. Rejected: that would require either a schema change (forbidden — no wire values change) or an unenforced convention that a future edit could silently break; a kind the schema itself cannot accept is a stronger guarantee.

### Graceful shutdown: cancel what's queued, let what's in flight finish

`close()`/`cancel()` (unchanged) abort the active transport along with retiring queued work — correct for an unexpected stop, but too abrupt for the host's ordinary shutdown, where "a write already in flight completes and its receipt says so" is an explicit acceptance criterion. `closeGracefully()` bumps the generation (so every job still queued cancels itself the instant it starts, exactly as `cancel()` already makes happen for queued work) but never touches `this.active`, so the job currently executing keeps running under its own existing bound (`timeoutMs * (retries + 1)`) and reports its true outcome. It awaits the bulb's current drain-to-empty cycle (tracked as `Bulb#draining`, the same promise `enqueue()` already starts) before closing the transport, so it recognizes when every queued job has finished cancelling itself. The host calls it after stopping the status publisher, so no new paint is submitted while it drains.

### `LifxStatusPublisher`: transition detection and Quiet's collapsed key

One publisher instance manages every configured bulb for one controller, sharing one feed read per evaluation tick (default 30 s poll, 3 s read bound, matching Tidbyt) but painting each bulb independently so one bulb's failure or capacity limit never delays another's paint or the next evaluation — paints are fired without being awaited inside the evaluation.

Per bulb, a "shown key" (`attention`/`working`/`done`/`idle`/`none`) tracks the last **attempted** target, updated before the paint's outcome is known: "A failed paint is not replayed; the next transition is a fresh request for the current state" (the issue's own words) means the replay boundary is the next transition, not the next identical read. Recovery after an `unknown` tick (unavailable feed, uncertain session) therefore paints only if the newly-known state differs from the key set before the outage, which may itself have been a failed attempt — by design, matching the offline-bulb acceptance criterion where the next transition paints both bulbs regardless of one's earlier failure.

Quiet paints only attention: its key is `attention` or `none` (everything else collapses to `none`, which paints nothing and leaves the bulb alone). This makes an attention→working transition under Quiet a real transition (`attention`→`none`), so Quiet correctly stops the attention paint once the state moves on, even though it never showed `working`. Entering Work or Quiet (via `onModeChange`, which also triggers an immediate evaluation instead of waiting for the next poll) resets the key to `undefined`, so the first known evaluation after the mode change paints once, matching "Host start or mode.set into Work paints the current state once."

Free is never evaluated for painting; the publisher still holds the mode-change subscription so a later return to Work or Quiet resets correctly.

### Colors and caps

Colors reuse `agent-status`'s `STATUS_COLORS` (RGB), converted to LIFX wire-unit hue/saturation with a standard RGB→HSV formula; idle is hue 0, saturation 0, kelvin 2700. Brightness uses the bulb's configured cap (default 50%) for every painted state except Quiet's one painted state (attention), which uses the quiet cap (default 20%). Both caps are read once at publisher construction from the host's per-bulb `status` config, not live-reloaded.

### Host wiring: opt-in per bulb, opt-in feed

Painting requires three things together: a qualified bulb, its own `status` block (brightness/quiet caps), and the host-level `lifx.status` feed block. A qualified bulb without a `status` block still advertises `modes` and accepts `mode.set` (so `mode.set` from the dashboard's generic mode control always works once qualified) but is never painted — the publisher's own bulb list is built only from bulbs that opted in, so there is no special-case check needed elsewhere. This mirrors #289/#330's existing pattern of the host reusing the Tidbyt runner's `HubStatusFeed`-shaped configuration.

### Dashboard: reusing the existing generic mode control

The dashboard's Mode `EditForm` (shared across every non-Pixoo device declaring `capabilities.modes`) and the Switch-to-Free one-click pattern (previously Nanoleaf-only) both generalize to LIFX by widening a handful of `component.kind==='nanoleaf'` checks to include `'lifx'`, and by threading the Switch-to-Free button into `LightingControls` (not `GeneralControls`' scene slot, since LIFX has no scenes capability) instead of `GeneralControls`. A new `lifxContentReason` mirrors `nanoleafContentReason` (pending mode change, unknown mode, or "in Work/Quiet and presents agent status; color and temperature need Free") and feeds into `lightingReasons` alongside the existing capability-missing and general-disabled reasons.

## Risks / Trade-offs

- [The receipt-schema tension around `mode.set`'s `outcome`/`priorEffects`] → Documented above and in `controllers/lifx/README.md`; the coordinator confirmed the code choice, and the wording nuance (a message that says "the device" for a change that never touched it) is a minor, pre-existing pattern shared by every config-only command in this schema, not a new problem this change introduces.
- [A new shared package changes the build/typecheck/test chain order] → `packages/agent-status` sits right after `packages/agent-state` in `build`/`typecheck`, matching dependency order; every consumer's existing tests pass unmodified, and its own tests cover the moved code directly.
- [Test pollution of a real default mode/lease directory] → the package itself carries no default (structural prevention, not just a testing discipline); every test that starts a controller, publisher or host still passes its own explicit temporary directory, and the host's own default is derived from its already-isolated lease root rather than a separate constant. Encountered as an actual pollution incident before this fix landed; see tasks.md.

## Migration Plan

No data migration. A running installation gets automatic LIFX status only after an explicit host-configuration change (`lifx.status` and a bulb's `status` block) and a restart; without that change, behavior is identical to before. Rollback is deleting those configuration blocks and restarting.

## Open Questions

None outstanding; Q1-Q5 raised during planning were resolved by the coordinator before implementation (see the PR/issue thread for the record).
