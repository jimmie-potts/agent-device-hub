## Context

A routine run (`fire` → `step` in `apps/runtime/src/core/power-schedules.ts`) reads each target's record, then checks after the read that the target is configured, the evidence is fresh and from the same owner, configuration and generation, the device is available, not held, supports the family and is not externally controlled, and, for an action with `runsOnlyIn` (ADR 0014), that the desired mode matches with no pending `device-mode-set`. A failure logs `blocked` with `unavailable`, `unsupported-capability` (an otherwise usable device that lacks the action) or `mode`; an overlapping occurrence logs `busy`.

## Goals / Non-Goals

**Goals:** answer, without any effect, which actions a run would send now and which it would block, with exactly the run's reasons.

**Non-Goals:** previewing unsaved drafts, simulating a time of day, quiet hours or `expired`, event rules or moments, and any change to Run now or scheduled fires.

## Decisions

- **One guard function.** `checkAction({action, configured, owner, ownerNow, read, current})` returns `{ok:true, record}` or `{ok:false, reason, detail}`. `step` calls it after the occurrence-window check and sends `record`, so a run's behavior is unchanged and the preview cannot diverge. Details are a closed list: `not-configured`, `no-evidence`, `stale`, `not-available`, `held`, `unsupported`, `external`, `pending-mode`, `mode-unknown`, `wrong-mode`, plus `in-flight` for the preview's `busy`. Among mode failures, a pending mode change is reported first because it explains a desired mode about to change.
- **Reading, not dispatching.** `preview` takes the same `read` then `current` path a run does. A rejected read becomes that action's `no-evidence`, not a failed preview. When the routine is in flight, every action is `busy · in-flight` and nothing is read. The routine store is only read, so storage faults cannot occur.
- **A reply, not a command (ADR 0012).** `GET` under read scope with the gateway's existing request span and authority recheck; no `bunny-request` header, since nothing changes. Refusals come from the existing registry via the route's `AutomationError` mapping. The normalizer keeps the routine template `/api/v2/automation/routines/{id}`, as enable, disable and run do.
- **Dashboard state.** The result belongs to the snapshot it was read beside. It is held with that snapshot's routines array and shown only while that array is current, so the next refresh or an Edit clears it without an effect. The reply passes a declared shape check, like Run now's. Failure text is the page's fixed `AutomationFailure` text.

## Risks / Trade-offs

- A preview is a reading, not a promise: evidence can change before a real run, and the owning module's admission remains the authority at send time. The page says so beside every result.
- `would-send` covers the core's guards only; module admission can still refuse a sent command.

## Migration Plan

None: no stored data or schema changes. Rollback removes the route and button; saved routines are untouched.
