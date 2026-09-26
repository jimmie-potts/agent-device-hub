## Context

`highestStatus` in `packages/agent-status` reduces a shared agent-state snapshot to one state for the LIFX status publisher. Since #20 it returned `unknown` when any shown root session had `uncertain` freshness, and the publisher paints nothing on `unknown`. Agent-state marks a session uncertain after five minutes without evidence and keeps restored sessions uncertain until new evidence, so the rule blocked painting on the installed setup almost all the time (#22 trial, 2026-09-26).

## Goals / Non-Goals

**Goals:** paint the reported highest state whatever a session's freshness; keep `unknown` for an unavailable feed or a collector that is not running.

**Non-Goals:** changing agent-state freshness, retirement or expiry; changing the Tidbyt tile; outside-change detection (#362).

## Decisions

- Rank by the owner's reported state regardless of freshness (owner, 2026-09-26). Done still comes only from an unacknowledged turn-ended notice, so silence never means done.
- Rejected: dropping uncertain sessions from the ranking, which would show idle while an unread finished turn exists; blocking only on restart-uncertain sessions, which fails the same way after every hub restart because idle done sessions send no new evidence.

## Risks / Trade-offs

A session that stopped without a delivered end stays working until it ends or reaches the 24-hour evidence expiry, as it already does on the Tidbyt. The owner can switch a bulb to Free to stop painting.
