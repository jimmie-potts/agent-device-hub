## Context

The core already owns weekly power schedules: a local-clock timer, strict future-only selection, a per-rule occurrence watermark claimed durably before dispatch, enable/disable routes, the Automation page and a catalog scenario. Each definition is one on/off window on one power-capable target. #1297 needs an ordered list of typed commands at one time, with content actions gated on the device's mode. #1276 gives the Pixoo an atomic admission check for `requireMode`.

## Goals / Non-Goals

- Goals: one routine model and one editor; the existing scheduler, watermark, log and dispatcher paths reused; content actions never displace a status display; one occurrence per routine in flight; an explicit Run now; existing event rules, power windows and log rows survive through one forward migration.
- Non-goals: MCP tools, timezone selection, missed-run history, one-off dates, holidays, catch-up, suspension, conditions beyond mode, new device command kinds, retry or rollback.

## Decisions

- **One definition shape.** `trigger {schema: "routine/1.0", days, time}` and `action {definitionId, actions: [{target, family, data, requireMode?}]}` in the existing `rules` table. A power window becomes two routines (on at `onTime`, off at `offTime`) through a one-transaction migration at the core's first open: the on routine keeps the row id, definition identity and watermark; the off routine gets a new id and a copy of the watermark. Alternative considered: keep `power-window/1.0` rows readable beside routines with two editors; rejected because it keeps two scheduler shapes and two editors for one feature. Lost convenience: an on/off window needs two routines.
- **Families by convention.** Allowed families are the general device families plus `pixoo-media-show` and `lifx-color-set`; the command type and payload schema follow the shared naming convention (`org.bunny.<entity>.<verb>.requested`, `<family>/2.0`), so the core imports no module package. The payload shape is checked per family at parse time with exact keys; capability and availability are checked on the current record immediately before each send, as the power schedule does.
- **Mode precondition in two places.** The core checks `desired.mode` and pending `device-mode-set` on the record it is about to send with and logs `blocked`/`mode` when it fails; the mode-checked families also carry `requireMode` so the Pixoo refuses at admission when the mode changed in between. Nanoleaf content actions use the core check alone (`free`).
- **Ordered, independent actions.** Each action has its own request id and a child trace of the occurrence; a refusal, failure, skip or uncertainty records its row and the next action runs. An edit, disable or delete between actions stops the remaining ones. A scheduled occurrence still claims the watermark before any action; Run now claims nothing and ignores the enabled state, because it is an explicit owner action.
- **Busy, not queued.** One occurrence per routine in flight; an overlap logs one `blocked`/`busy` row and is dropped, consistent with "nothing is queued or retried".
- **Routes renamed.** `/api/v2/automation/routines` with the same CRUD, enable/disable and a new `run`; the dashboard is the only client and ships with the change.

## Risks / Trade-offs

- An older release cannot read `routine/1.0` rows: recovery to it stays unknown unless separately qualified; fixing forward is preferred, as the upgrade procedure already states for routine rows.
- A migration that cannot read a legacy row refuses the core's open, as an unreadable row does today; the transaction leaves every row unchanged for inspection.
- Log rows reuse the existing `blocked` outcome with reasons `mode` and `busy`; the dashboard shows them as the admission outcome and policy, as it does for `unavailable`.

## Migration Plan

One forward migration at the core's first open after the upgrade, inside the automation store's transaction. No data is deleted. The upgrade's focused change assessment names the `rules` trigger/action JSON shapes and the copied `automation_power_guard` rows.

## Open Questions

None.
