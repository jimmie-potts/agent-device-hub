## Context

See proposal.md for motivation. `useCommand` and `EditForm` each held five pieces of state: status, tone, busy, locked and a watched ticket. Each had its own submit sequence and its own terminal-receipt effect, and they ordered refresh and ticket tracking differently. Behavior is specified by the `unified-dashboard` general-control requirements and the existing browser matrix.

## Goals / Non-Goals

**Goals:** one lifecycle implementation with the ordering and recovery rules written once; transition tests independent of React and the browser; unchanged wording, layout and consumer interfaces.

**Non-Goals:** a framework-wide form system, a generic device action engine, visual changes (#182), or changes to hub routes and controller contracts.

## Decisions

1. **A pure transition function plus one async driver (`lifecycle.ts`).**
   - `commandTransition` owns every state change. `runCommand` owns ordering: start, prepare, send, result, refresh, settle.
   - Neither imports React. The consumer supplies the device request, availability and wording.
   - *Alternative:* a single React hook with inline logic. Rejected because it can't be tested without a browser, and PR #239 showed that ordering bugs hide there.
2. **Wording as data.** `actionWording(label)` prefixes the label and adds the retry hint for `stale-generation` and `revision-conflict`. `formWording` appends "Your edit is kept." to rejections. Existing strings are reproduced exactly.
3. **Ordering.**
   - Start clears any watched ticket.
   - Preparation runs next: for device controls, the consumer's fresh device read plus, for forms, the draft revision check. Session label and acknowledgment forms have no fresh read and build from the snapshot their draft started from, as before.
   - A blocked or throwing preparation ends without sending or refreshing.
   - Otherwise the driver sends once and dispatches the result. It records the ticket only when accepted.
   - Then it awaits the refresh, swallowing a rejection so the result stays shown.
   - Then `settled` runs; forms use it to clear an accepted draft.
   - Finally the hook releases busy. Clearing the draft and releasing busy happen in the same turn, so a stale draft can't be resubmitted between them.
   - Forms previously released busy before refreshing after an uncertain result. They now refresh first, as actions did; the lock is unchanged.
4. **Single activation.** A ref marks an activation in flight. A second activation that arrives before React re-renders the disabled control returns without sending. The locked check remains.
5. **Observation.** An `observed` transition re-evaluates the watched accepted ticket whenever the source snapshot changes. A later uncertain or partial receipt locks. A rejected ticket is never watched, so another client's receipt on the same ticket can't be adopted.

## Recovery

A failed preparation or refresh leaves the control usable once the device read recovers. The existing stale-observation reason disables controls while reads fail. Every activation reads guards afresh. An uncertain or partial result stays locked until "Reload current values", which clears the watch and refreshes. Nothing retries automatically.

## Risks / Trade-offs

- [The hook guard, focus restoration and form draft rules still need a browser] → The existing matrix plus the new scenario exercise them on both consumers.
- [#182's skin and display-name change landed first (`e6de7c6`)] → The merge keeps its B.U.N.N.Y. wording in every string this change moved or added, including the single `unreadable` constant.
