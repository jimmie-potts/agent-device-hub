# Volcano module

The private history of one enrolled VOLCANO HYBRID ([#615](https://github.com/jimmie-potts/agent-device-hub/issues/615)).
It records what a host-local collector observes when the owner uses the physical
buttons, and serves it through authenticated reads. It reaches no device: nothing in
it can start a heater or pump, or change a setting. The card is
[#616](https://github.com/jimmie-potts/agent-device-hub/issues/616); installation and
physical acceptance are [#617](https://github.com/jimmie-potts/agent-device-hub/issues/617).

A session is heater activity. It is not consumption, dose or inhalation, and a pump
run is not a filled balloon. Connection state says nothing about the heater: a
disconnect is never off.

## Configuration

```json
{"id": "volcano", "label": "Volcano", "hostId": "<collector host>", "sourceId": "<feed>"}
```

The section names one feed, whose collector credential is derived from those two
identifiers. It has no serial, Bluetooth identifier or path. The module is fixed in
the shipped list and `hostLocal`, because it touches nothing on its host but its own
database. Its section names no device for control, so it is no mode participant or
automation target.

## Stored facts

Facts are added, never rewritten, in the module's private SQLite file. There is no
delete or release control (owner decision, 2026-11-03), and history is kept
indefinitely. Every fact keeps `observedAtMs`, the collector's clock, and
`receivedAtMs`, the module's, separately.

| Fact | When |
| --- | --- |
| `heater` | On change, with raw `status1` and an `edge`: `observed`, `first-observation` or `after-gap`. |
| `pump` | On change, with raw `status1`. The device ran its pump bit for about a second by itself on reaching its setpoint (`0x2623`, against `0x3623` from the button), so a pump run never implies a press. |
| `setpoint` | On change. |
| `temperature` | While the heater is on, at most one per 30 s, plus at transitions. |
| `counter` | On change. Whole minutes: `hours*60+minutes`. |
| `link` | On change: `connected`, `disconnected`, `unavailable`, `identity-mismatch` or `stale`. |
| `collector-restart` | When the collector's epoch changes. |
| `gap` | An unobserved interval, with the heater on each side and the counter's gain across it: a broken link, a feed silent for over 15 s, a skipped `sequence` or a new collector epoch. |
| `discontinuity` | `counter-decrease`, `counter-jump` (a gain larger than the time that passed), `identity-mismatch` or `clock-step`. No delta crosses one. |

Decoding follows the live trial on [#614](https://github.com/jimmie-potts/agent-device-hub/issues/614): the heater is `status1` bit `0x0020` and the pump
`0x2000`. `status2` bit `0x0200` means the display is in Fahrenheit, exposed as
`displayFahrenheit` for the card; temperatures are always stored as degrees Celsius
times ten. `status2` bit 13 flips by itself and is never a change. Counter persistence
across power-off is not verified, so any decrease is a discontinuity. The hour rollover
is not verified either: the collector publishes a pair torn across it as unread, so
one reaching this module is a real change, apart from the first read described under
[Accepted limits](#accepted-limits). A gap that ends with no counter has no
credit, and neither does the next one if no counter has been read between them.

A snapshot repeating its epoch and sequence is dropped, and so is one whose
`observedAtMs` is not newer than the last. Once the feed has been stale for 15 s, or has
a stale marker, or the host's clock is over a second behind the last receipt, such a
snapshot moves the ordering baseline instead, so a clock that stepped back holds the
feed for one freshness window and one cycle; the next snapshot taken records a
`clock-step` discontinuity. Facts, continuity and the state messages commit in one
transaction through the outbox, so a restart repeats no fact, and one between a commit
and its publication sends the stored messages again.

## Sessions

Sessions are derived when they are read. Heater-on stretches separated by less than
the gap threshold, 15 minutes by default and owner-adjustable from 1 to 240, form one
session; a separation of exactly the threshold starts a new one. Changing the
threshold regroups all history and rewrites nothing.

- A stretch first seen on, at first connection or after a gap, is
  `startedBeforeObservation` from the time it was first seen. No earlier start is invented.
- A stretch last seen on before a gap and then seen off has no `endAtMs`, only
  `lastObservedOnAtMs` and `endedUnobservedBy`.
- A gap with the heater on at both edges stays inside its stretch, whatever its
  length, and creates no boundary. `observedHeatingMs` excludes it, and
  `creditedMinutes` holds the counter's gain across it, separately.
- A stretch with no end evidence yet stays `open`. An identity or clock
  discontinuity closes it with no end time.
- The separation from a stretch with no observed end is measured from the first time
  it was seen off, and is marked `uncertain` in the gap distribution.

## State and reads

The device publishes `bunny.state.device.<id>` (kind `volcano`, every capability
unsupported, observed unknown) and `bunny.state.volcano-status.<id>`
(`volcano-status/2.0`). A feed stale for 15 s, or a link not connected, makes
availability `unavailable` and heater and pump `unknown`, never off. Repeated
snapshots publish nothing. A running module takes no state from its store: until the
next snapshot it reads unavailable.

This module is the only owner of usage history. Core history keeps neither the raw
snapshot nor `volcano-status`, so the dashboard's Timeline shows no heater, pump,
temperature or counter. It does keep the device record, whose fields move only with
availability, so its rows say when the device became available or unavailable. A
threshold change stays in core history as the tracked action it is.

All reads are fixed projections with closed, checked documents, at most 256 KiB, at
`/modules/volcano/content/<ref>` under the gateway's existing read authorization.

| Ref | Query | Document |
| --- | --- | --- |
| `status` | none | `volcano-status/2.0`, also the MCP tool `volcano_status`. |
| `timeline` | `from`, `to` (ms), `cursor`, `limit` up to 200 | `volcano-timeline/2.0`: facts by observation time. |
| `sessions` | `cursor`, `limit` up to 25, `gapMinutes` (a preview that changes nothing) | `volcano-sessions/2.0`: newest first, each with up to 32 stretches and a count of the rest. |
| `totals` | `zone` (required, IANA), `cursor`, `limit` up to 366 | `volcano-totals/2.0`: per local day, observed time split at local midnight. |
| `gaps` | none | `volcano-gaps/2.0`: the distribution of separations between stretches, for choosing a threshold. |

## The threshold command

`bunny.cmd.volcano-session-gap.<id>`, type `org.bunny.volcano-session.gap.requested`,
through the core's tracked dispatcher (`POST /api/v2/commands/volcano-session-gap`):
`{requestId, gapMinutes, expectedConfigurationRevision?}`. It never reaches a device.

- Stored: outcome `succeeded`, evidence `observed`, in the same transaction.
- `gapMinutes` outside 1 to 240: accepted, then outcome `failed`, `invalid-request`.
- A non-integer: refused by the family's schema.
- A repeated `requestId` with the same content is accepted and reports nothing twice;
  with other content it is `duplicate-conflict`. A stale expected revision is
  `revision-conflict`, an expired command `expired`, and a full disk `capacity`, before
  anything is accepted.

## Diagnostics

Link changes are `device.unavailable` and `device.available`. A connection, a collector
restart and a discontinuity are each one `feed.changed`: a connection has `bunny.operation`
`feed` and `bunny.outcome` `current`, a restart `startup` and `current`, and a
discontinuity `feed`, `stale` and the nearest `bunny.reason` (`invalid-input` for the
counter, `unauthorized` for another device, `invalid-context` for a stepped clock). A
refused commit is `operation.failed`. The module's records carry registered codes and
the device's routing ID. No usage, serial, raw host ID or raw source ID reaches a log.
The runtime's own message records may carry the routing key, whose last token is the
hashed feed ID, as for the other feeds.

## Accepted limits

The owner accepted these on 2026-11-03 as rare enough not to change the timing code.
Revisit them if one shows up in the installed history. Facts are never rewritten, so
what these cases store stays.

- **A clock stepped forward.** The host cannot tell the step from real silence, so it
  stores a gap as long as the step, facts stamped during it can land on a later day in
  the totals, and the time allowed for a counter gain widens. A real upward counter
  jump in that window can be stored as credit. The corrected clock records a
  `clock-step`, and no credit crosses it.
- **A clock stepped back by just over a second.** Under busy publishing this can record
  a false `clock-step`, which closes the open stretch with no end time.
- **A first read torn across an hour boundary.** A new process has no last good counter,
  and a reconnect after a long absence allows a large gain, so such a read can be taken
  as read. It can record false discontinuities. When the absence is long enough to allow
  the false gain, it can also store a wrong credit, too high or too low, that later facts
  do not correct.

## Simulation

`SimulatedVolcano` has no radio. Its actions, for the scenario harnesses, are
`online`, `offline`, `heater-on`, `heater-off`, `pump-on`, `pump-off`, `setpoint`
(`deciC`), `tick`, `counter-reset`, `other-device` and `collector-absent`. The section
is `VOLCANO_SIMULATED_SECTION`.

## Checks

See [Volcano checks](../../docs/development.md#volcano-checks). They use synthetic data
and do not establish what the owner's firmware does.
