## Context

The module writes two tiles through one queue, behind a lease, to the Tidbyt cloud. Its renderer, tiles and gate are backend-independent. Server v2.5.2's source and a disposable v2.5.1 run with synthetic credentials settled the API questions; `modules/tidbyt/README.md` holds the compatibility record.

## Goals / Non-Goals

**Goals:** one explicitly selected connection; no failover or second writer; real capabilities; no replay; both backends tested with identical frames.

**Non-Goals:** hosting (#1406), flashing and physical acceptance (#24), interrupt-then-return (#337), animated art (#681), dashboard controls, a shared contract change, recreating store apps.

## Decisions

**Selection is the section.** `backend` picks one connection at start, and a section may hold only that backend's settings, so no configuration can name both. The module builds exactly one connection in a run. Alternative rejected: keeping both blocks for a one-field rollback, because a retained second key file invites a competing writer; the owner keeps the prior section instead, as #24 requires.

**One connection shape.** `CloudQueue` and `TileWriter` take a `TidbytConnection` of `push`, `remove` and `list`. The queue gains `control` for a single command write behind the same holds. Nothing in the writer changes for the cloud.

**Differences found on the real server.**
| Server behavior | Module's answer |
| --- | --- |
| `background` defaults to false | Every push states it |
| An anonymous push queues up to a day | Every push names its installation |
| The list carries server-generated IDs | Presence is `GET` by name |
| A missing installation answers 404 `App not found`; a missing device `Device not found` | The text tells them apart |
| Brightness is stored unchecked, 101 and -1 included | Percent scales to `BRIGHTNESS_CEILING` |
| A deleted installation keeps its pin, and a re-pushed one gets a new ID | The pin is reconciled after each tile write |
| A push is accepted without validating the image, and with no device connected | A 200 is transmission evidence only |

**Modes, not a contract change.** `capabilities.modes` already holds "the device's own native modes". Pin, enable/disable and immediate push become `pin-<tile>`, `hide-<tile>` and `interrupt`, with `rotation` the default. Hiding is done by the module removing the tile: the server recreates a pushed installation as enabled on its next push, so a server-side disable would not last. A dedicated `tidbyt-display` family was rejected because no consumer needs more than these values today.

**The gate.** The Tronbyt default stays 15 s until #24 selects a value. Configured values run from 1 s to a day. A disposable run answered writes 1 s apart, which qualifies the server's API alone, not the device's rendering.

## Boundaries and outcomes (ADR 0012)

- **Entry points:** `configure`; tile evaluations; `bunny.cmd.brightness-set.<id>` and `bunny.cmd.device-mode-set.<id>`.
- **Refusals (no effect):** other families and modes `unsupported-capability`; stale guards `revision-conflict`; reused ID `duplicate-conflict`; no lease or stopping `unavailable`; more than 8 waiting `capacity`.
- **Outcomes:** `succeeded`/`transmitted` on a 2xx; `failed`/`none` on a refusal, a hold, a pre-send failure or expiry; `uncertain`/`none` when the write went out unanswered or the server answered 5xx. `observed` is never claimed.
- **Retry:** no command is sent again. A pin that failed or is uncertain is a fresh write for the current mode after 60 s. Device hold (`device/2.1`) is not adopted: the record stays `device/2.0`, tile writes stay independent of brightness, and the next tile write is already a fresh one for the current state.
- **Diagnostics:** `command.executing`, `command.completed`, `operation.failed` and `operation.completed` with `bunny.operation` `mode`, `brightness` or `startup`; `bunny.device.call` spans. No server, device ID or key in any of them, and no trace context to the server.
- **Fault cases:** tested in `tests/tronbyt.test.ts`: server silent, connection refused, lost answer, 401/403/404/429/5xx, stop or crash during a write, and a database that refuses a commit through the existing paths.

## Risks / Trade-offs

- A dangling pin while the device is away: `/next` clears one itself on v2.5.1, so the module's explicit clear is redundant while a device polls and needed when none does.
- The body-text 404 distinction depends on fixed server text. A changed text falls to `unknown-device`, which makes the Tidbyt `unavailable` visibly rather than deleting anything. The optional check exercises it on each upgrade.
- Plain http carries the bearer key on the LAN, as the server documents. The URL rule refuses http to any public-looking host.

## Migration and recovery

**Storage.** `tidbyt_connection`, `tidbyt_display` and `tidbyt_requests` are created when missing. A database with no connection row belongs to the cloud, so an upgrade on the cloud keeps tile memory and pushes nothing. Selecting another backend deletes `tidbyt_tiles` and `tidbyt_display` rows: both are recomputed, and the next start reads presence by name. No frame is stored.

**Rollback.** Restore the previous section and restart: the handoff runs the other way, and the cloud's first write is fresh. Rolling back the code itself leaves the new tables ignored; older code then trusts `tidbyt_tiles` rows written for the server until its 10-minute refresh, which is cosmetic.

**Writer handoff.** The runtime stops a module before starting it with another section, and stop ends the call in flight. The cloud keeps its last tiles and hears nothing more. Each backend has its own lease, under the same module database that one runtime keeps to itself.

## Open Questions

- The installed gate value, and whether tiles should default to `interrupt`, are #24's owner decisions.
