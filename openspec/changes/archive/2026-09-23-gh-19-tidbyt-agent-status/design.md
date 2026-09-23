## Context

The Tidbyt controller from #16 is the only writer for one Tidbyt. It accepts a `tidbyt.display` request, renders it to WebP and pushes it as a background installation. The shared agent-state owner exposes `snapshot()` and a per-consumer `subscribe()` that yields revision pointers or `resync`. Its sessions carry separate activity, attention, notices, read evidence and freshness. The #16 qualification saw no rate limits, confirmed that background pushes join rotation and that `DELETE` removes an installation. It did not establish how long an unrefreshed installation persists.

## Goals / Non-Goals

**Goals:** show the settled four-row layout from the shared feed, push only through the controller queue, bound push frequency and remove the installation when nothing needs showing.

**Non-Goals:** hub HTTP/SSE wiring, configuration files, a service, installation, foreground takeover, acknowledging notices and physical verification. #21 owns installation and visible acceptance.

## Decisions

### Session state and order

Rows show root sessions only; a session with known parent evidence is a child and is left out. Each shown session gets the first matching state:

1. `ASK` (amber): at least one attention entry of any kind.
2. `RUN` (blue): activity is `active`.
3. `DONE` (green): at least one turn-ended notice that the configured acknowledging consumers have not acknowledged.

Other sessions (idle, interrupted, ended or unknown with nothing outstanding) are not shown. Read evidence does not retire `DONE`, because read and acknowledged are distinct. By default any consumer's acknowledgment retires a notice. The publisher can instead name the consumers whose acknowledgment counts. The Tidbyt itself never acknowledges.

Within a state, newer `lastEvidenceAtMs` comes first, then the identity hash, so the order is deterministic. With more than four rows, three are drawn and the fourth reads `+N MORE`.

Alternative considered: one focused session, or counts only. The user chose rows.

### Labels and privacy

A row's label is the session's user label, then its user-chosen project ID, then a neutral ID: `C` for Claude or `X` for Codex and the first four hex digits of a SHA-256 over the full identity tuple, such as `C-3F9A`. Text is uppercased. Characters outside the 3×5 font become `-`, and labels are cut to ten characters. Snapshot fields other than these are never drawn.

### Uncertainty

A session with `freshness: uncertain` keeps its state word but is dimmed, and its marker becomes `?`. The feed is unavailable when `snapshot()` throws, times out or returns an invalid shape, or when the collector is not `running`. Then every row is dimmed and marked with `?`, built from the last good snapshot. With no good snapshot the frame shows `FEED ?`. An unavailable feed never removes the installation, because missing evidence does not mean idle.

### Publishing and cadence

The publisher runs one evaluation at a time. A change notification, `resync`, poll tick (30 s) or deferred timer requests another evaluation. Requests during an evaluation coalesce into a single rerun. Each evaluation reads the current snapshot, builds the frame and picks one action:

- rows to show and a frame different from the last sent one, or unchanged for 10 minutes: push;
- nothing to show, a running collector and an installation that may be present: remove;
- otherwise nothing.

A write happens at most once every 15 s, measured from the previous write's submission. An earlier request schedules a timer for the remaining time and then evaluates the latest snapshot, so intermediate frames are dropped.

Writes use the controller's current `nextRequestId`, configuration revision and generation from its snapshot. The publisher awaits the receipt. `sent` records the frame, or records that the installation is absent after a removal. `failed`, `cancelled` or a refused submission leaves the previous record unchanged, so the next evaluation tries again after the minimum interval. `uncertain` makes installation presence unknown and clears the sent frame. The publisher never resubmits an old request; a later write is a fresh request for the current state. The controller's authentication hold still fails writes locally, and its 429 hold still delays them.

At start, installation presence is unknown, so an idle start removes any leftover installation once.

### Controller removal

`tidbyt.remove` has the same request envelope as `tidbyt.display` and no other command fields. It passes through the same admission, FIFO, generation check, authentication and rate-limit holds and receipts. Its operation ID is `remove`. The connection sends `DELETE /v0/devices/{device}/installations/{installation}` and classifies the result like a push. This keeps one writer for every change to the device's installation.

## Risks / Trade-offs

- An unrefreshed installation's lifetime is unknown. The 10 minute refresh bounds it but is not qualified; #21 observes it on the real device.
- The display does not refresh itself between pushes. A session that becomes stale shows `?` only after the next poll changes the frame, up to 30 s later.
- Removal when idle leaves no "nothing running" frame. That is the chosen behavior.
- A `DONE` row persists until some consumer acknowledges the notice. Using a `clearOnNewTurn` consumer policy ends it on a new turn.
