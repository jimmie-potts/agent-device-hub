## Why

[Issue #1586](https://github.com/jimmie-potts/agent-device-hub/issues/1586): today the only way to see how a saved routine will fare is Run now. Run now sends real commands and leaves the room changed: the #45 live check on 2026-11-08 had to restore a Pixoo playlist and mode by hand afterwards. The core already evaluates each action's preconditions immediately before its send, but it exposes that evaluation only through a real dispatch.

## What Changes

- Move the guard sequence in the routine run's `step` into one pure function, `checkAction`. A run keeps using it unchanged, so a preview and a run cannot drift.
- Add `preview(id)` to the core's routines. It reads each action's evidence as a run does and applies `checkAction`. Each action answers `would-send`, or `blocked` with the reason a run would log (`unavailable`, `mode`, `busy`) and the guard that failed, from a closed list. It sends, logs, claims and schedules nothing, and it leaves the in-flight mark alone.
- Add `GET /api/v2/automation/routines/<id>/preview` under read scope, answering `automation/2.0` `{id, atMs, enabled, next?, actions}`. An unknown routine is refused with `not-found` (404) and missing routines with `unavailable` (503), through the shared error body. Add the path to the gateway's route normalizer and the runtime README's route list.
- Add a Preview button beside Run now on the Automation page, a declared reply-shape check, and an inline result that is never stored and clears on the next refresh or edit.

The preview is a reply answered from the owner's current records, not a command (ADR 0012 *Message kinds*): it has no accepted/outcome lifecycle, no retry, no automation-log row and no new log level. Verdict words are reply fields, not error codes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-power-schedules`: a read-only preview of a saved routine's actions with the run's own guards, and its page control.

## Impact

- `apps/runtime/src/core/power-schedules.ts` (the shared guard and `preview`), `core.ts` (facade), `gateway/automation-routes.ts` and `gateway/gateway.ts` (route and normalizer).
- `apps/runtime/dashboard/src/routines.tsx` and `automation.tsx` (button, reply check, inline result).
- Runtime README, dashboard README and DEVELOPMENT.md.
- No storage, schema, migration, device module, contract package or MCP change. Previewing unsaved drafts, simulated times and event rules stay deferred, as the issue records. Installed acceptance belongs to the next deployment batch.
