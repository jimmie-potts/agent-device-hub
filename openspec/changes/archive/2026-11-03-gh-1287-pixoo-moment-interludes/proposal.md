## Why

Epic #677 needs art to appear on the Pixoo, and the owner decided on 2026-11-03 how it may: over Media, resuming in place, and over Monitor only when nothing needs attention, with a setting to turn that off. Attention ends it at once with no replay. The Pixoo declares moments unsupported today ([Hub #1287](https://github.com/jimmie-potts/agent-device-hub/issues/1287)).

## What Changes

- The Pixoo declares `capabilities.moments` and answers `moment-play` with a time-boxed presentation over the current base, a return to that base, a `moment-ended` occurrence and no replay after a restart.
- A new `pixoo-moments-set` command and a Monitor page control hold the owner's setting. `pixoo-display` gains an optional `moments` field and the `moment` value of `showing`.
- What a moment shows goes through one seam, `momentContent`, using mood-driven frames for now.
- ADR 0013 amends the Pixoo's ADR 0018, whose repository is archived.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-pixoo-module`: a new requirement for moment interludes. It succeeds the archived `agent-monitor-controls` specification's "Explicit display participation" requirement for this behavior.

## Impact

- **Code:** `modules/pixoo/src/presentation/` (`monitor-presentation.ts`, `moment-content.ts`), `modules/pixoo/src/module/` (`module.ts`, `control.ts`, `store.ts`, `schemas.ts`, `render-request.ts`), `modules/pixoo/src/frontend/monitor.tsx`.
- **Storage:** one new table, `pixoo_moments`, in the module's own SQLite file, created when missing. Older code ignores it, and the setting is one more row in `pixoo_state`.
- **Contracts:** `moment-play` and `moment-ended` are unchanged. `pixoo-display` and `pixoo-moments-set` are the module's own, and the new display field is optional.
- **Docs:** `docs/decisions/0013-pixoo-moment-interludes.md`, `modules/pixoo/README.md`.
- **Unchanged:** the core's automation does not yet route moments to the Pixoo; that integration belongs to #684. No installation, release or physical device command happens here; physical checks belong to #687.
