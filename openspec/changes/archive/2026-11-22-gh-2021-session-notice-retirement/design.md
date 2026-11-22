## Context

The core's session reducer (`apps/runtime/src/core/session/reducer.ts`) was ported from agent-state with the same limits: 128 notices, 256 watermarks, 256 retry keys and 256 retired turns per session. Retry keys and retired turns are first-in, first-out windows. Notices and watermarks only grow, and past their limits the reducer returns `capacity` and the transition refuses the observation. The `session/3.x` schemas bound a record's notices at 128.

The dashboard consumer keeps its notices across a new turn (`clearOnNewTurn: false`) and acknowledges only through the notice override, which acknowledges the latest notice. Nanoleaf and Pixoo acknowledge earlier notices when a new turn starts. So in a long Claude session, almost every earlier notice is acknowledged by Nanoleaf and Pixoo but not by the dashboard. A rule that retires only notices every consumer acknowledged would not stop the refusals.

Owner decision 3 of Hub #1865 (2026-11-18) made `noticeCounts` the one place that decides whether a notice still describes the session's finished turn. A notice of a known turn stops counting once the session is on a different known turn. Status, each reader's acknowledgment policy, the dashboard's unread mark, companion opportunities, read receipts and the override all read only notices that still count, or the latest one. Only the dashboard's Retained notices list shows superseded notices.

Watermarks are kept per dimension and epoch. Only the native assistant source sends known ordering today, with one epoch per conversation, and each attention ID is its own dimension (`attention:<id>`).

## Goals / Non-Goals

**Goals:**

- A session can keep taking turns and questions without a `capacity` refusal from its own notices or watermarks.
- No notice that still counts is ever dropped, and evidence older than what the session already took stays stale.
- No stored-format, contract or reader change, and no migration.

**Non-Goals:**

- A marker for lost outcome evidence when counting notices alone pass the limit. That would need a `session` contract minor and is left as a refusal (coordinator decision 2).
- Changing which notices count, or how consumers acknowledge.

## Decisions

1. **Retire superseded notices at the limit only (coordinator decision 1 on #2021).** After an observation's effect and before the capacity check, the reducer retires superseded notices, oldest first, until the session holds 128. Oldest first keeps the dashboard's Retained notices list a contiguous run of the newest turns. Below the limit nothing changes, so the dashboard's Retained notices list, the completion memory that the held notices give unordered late events, and retirement guards behave as before. Notices only grow at a turn end, so in practice only a turn end retires. The rejected alternatives were the literal rule from the issue (retire only fully acknowledged notices), which does not stop the refusals, and retiring every notice as soon as it is superseded, which changes every session's record and the completion memory below the limit.
2. **Refuse when counting notices alone pass the limit (coordinator decision 2).** This can happen only through turn ends without a known turn, or while the session's own turn is unknown. At 128 notices it includes a turn end that would make the session's own turn ambiguous, such as a hook Stop for a prompt whose start the core never saw: that end is refused and changes nothing, and the next known start and end apply as usual. Refusing drops nothing and needs no contract change. It heals when a known turn makes earlier notices superseded. Notices without a known turn always count, so a provider that names no turns stays refused until expiry, as it is today.
3. **Watermark floor (coordinator decision 3).** Past 256 watermarks, the reducer drops the watermarks of attention it no longer holds, lowest sequence first, and keeps the highest dropped sequence per epoch as a watermark with the reserved dimension `floor`. An ordered observation in a dimension without its own watermark, at or below the floor, is stale: it is older than evidence the session already took. This keeps a late duplicate of an answered question stale after its retry key rotates out. Activity, read and unavailability dimensions, and those of held attention, are never dropped. Held attention is bounded at 64, so there is always room. Without the floor, a late duplicate could raise answered attention again. Making attention on retired turns stale was rejected because it changes attention semantics.
4. **No migration or start cleanup (coordinator decision 4).** The reducer refuses before commit, so no stored session holds more than 128 notices or 256 watermarks. A session stored at 128 notices recovers at its next turn end.

## Risks / Trade-offs

- [The dashboard's Retained notices list shows at most the newest 128 notices] → Each turn end stays whole in history, and no status depends on the retired notices.
- [A late unordered event for a turn whose notice retired] → The turn is in the session's 256 retired turns, which keep it stale. A turn older than both windows can apply, as any turn past the retired-turn window can today.
- [A device acknowledgment of a retired notice] → It is refused with `not-found`. Nanoleaf and Pixoo acknowledged superseded notices at the next turn and have no reason to acknowledge them again.
- [A reordered first observation of a new dimension at or below the floor becomes stale] → Only evidence older than discarded evidence is affected; the native source delivers in order.

## Migration Plan

None. Stored sessions keep their shape. A rollback to an earlier release reads them unchanged: counts stay within its limits, and it never matches the `floor` dimension, which counts as one of its 256 watermarks. Installation goes with the [#1869](https://github.com/jimmie-potts/agent-device-hub/issues/1869) batch.

## Open Questions

None.
