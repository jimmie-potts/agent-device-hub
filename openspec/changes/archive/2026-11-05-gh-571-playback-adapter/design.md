## Context

See proposal.md for motivation. Main `11cb8c10` has one playback owner, receiver
pollers, a durable command journal/outbox and `playback/2.1` consumers. The local
position reader proves a bounded native boundary but has no producer registration
or controls. This cross-component, credential and persistence change needs a
design under the spec-driven schema.

## Goals / Non-Goals

Add one explicitly configured Mac/library source to the existing owner. Preserve
the exact playing-or-paused, freshness, configured-order ranking, receiver
behavior and old native entry points. Source fixtures substitute every native
process/permission/event API. This delivery performs no installation, credential
provisioning, actual Music calls, audio capture or route changes. It does not
qualify recording association or speaker timing.

## Decisions

- Use a separate `music-playback-producer` credential, fixed source
  `bunny/parts/music-playback`, and existing SDK endpoint capabilities. New
  profile-2.0 families are endpoint, observation, work, result and gateway-only
  lost. Widening capture authority would couple independent capabilities.
- Keep a Music input in `modules/playback`, separate from the HTTP receiver
  transport. A cached read must not acquire a fresh receipt timestamp. Accept
  source intervals through an evidence-time presentation path.
- Preserve `playback/2.1` and publish `playback-position/2.0` under the same ID.
  A shared owner high-water revision supports mixed sync, while position ticks
  do not invalidate the ordinary playback revision. Update the existing revision
  row and outbox atomically; restart publishes unavailable above the saved mark.
  Receiver-only configurations still serve only playback. Mixed sync reads the
  last durable snapshot; failed commits never expose optimistic replacements.
  Receiver artwork retains its existing publication-attempt gate separately.
- Keep one native child and use a distinct helper with typed read/control modes.
  Read budgets are five seconds, with the final second reserved for output.
  Control budgets are three seconds including prior-read cancellation. The
  owner initially waits four seconds, then records uncertainty without replay.
- Use the existing journal for all commands. Hold bounded correlation for the
  original live endpoint/process/operation so late definitive evidence can pass
  through the same outbox, preserving ADR0012 reconciliation and conflicts.
  Restart retires that endpoint and leaves unfinished intent uncertain.
  Transient missing reads disable controls but retain the original live process
  correlation. The owner bounds command correlations and retired endpoint IDs
  at 64 each; exhausting endpoint retirement capacity requires an owner restart.
- The native digest identifies a process; persistent item IDs identify local
  library items. A neutral operator-selected library scope is declared, not an
  observed library fingerprint. Matching before/after item checks bound an
  interval only. Selected outputs carry Music-declared provenance and no
  speaker or audible-time claim.
- Qualify native monotonic origin by parent bracketing. Qualify runtime wall
  mapping by request-send/receipt bounds, preserving the established 50 ms
  registration skew, 25 ms drift and 100 ms combined uncertainty bounds.
  Original read times determine age; clock discontinuity invalidates Music.
- Use 16 KiB maximum NDJSON, 4 KiB discarded stderr, 64 KiB descriptor data,
  256-byte display fields, 128-byte output labels/identifiers and eight selected
  outputs. These bound one operator's observation, with refusal rather than
  hidden identity truncation. No broad library/device catalog is collected.

### Boundary and failure examples

| Boundary | Admission and outcome | Evidence and recovery |
| --- | --- | --- |
| Credential to endpoint | Fixed role/source, empty ordinary scopes, configured Music slot, one live endpoint | Wrong authority refuses; endpoint replacement retires old messages |
| Native read to producer | Closed descriptors/JSON, process pin, per-field intervals and byte limits | Partial fields remain partial; unknown child exit blocks another child |
| Producer to playback | Sequence/process/clock checks and source-derived age | Late samples never become fresh; explicit process/permission loss disables Music controls |
| Operator to owner | Existing expectedRevision, current source and supported action checks | Intent commits before dispatch; storage refusal sends nothing |
| Owner to producer | Exact endpoint/process, single operation, original expiry | Known unsent fails with none; Music acceptance succeeds transmitted; timeout is uncertain |
| Late result to owner | Same still-live endpoint/process/operation and retained journal entry | Definitive evidence reconciles uncertainty; no retry, redirect or newer-generation completion |

The command trace remains the parent of endpoint work and the owner's device-call span.
Diagnostics use registered events and fixed codes only, never listening metadata,
native strings, token values or device names. Selected personal data stays in
private declared observations/history under ADR0011 and current capacity limits.

## Risks / Trade-offs

Music's scripting dictionary does not prove field availability, atomic reads or
packaged permissions. Fake descriptors prove source behavior; installation needs
separate qualification. Bounded reads may report partial data on a slow host.
Native controls can reach Music before their reply is lost, so uncertainty must
survive without resending. A fresh paused Music-first source may outrank a playing
receiver, as the accepted selection rule requires.

## Migration Plan

This source addition uses existing storage and additive wire/configuration
contracts. Old one/two-receiver sections and legacy conversion remain unchanged.
The Music source is absent until an operator explicitly places it in the private
source order and provisions its separate producer. No installed migration runs
in this delivery. Focused restart/full-store tests protect revision/outbox
behavior; any later installed release follows the runtime upgrade procedure.
