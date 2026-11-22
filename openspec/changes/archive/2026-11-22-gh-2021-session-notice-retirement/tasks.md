## 1. Reproduce

- [x] 1.1 Red on main 48ba0994: a Claude-shaped session and a native conversation ending 136 turns each have 8 turn ends refused with `capacity`, and a native task asking 264 questions has 18 question observations refused (`apps/runtime/tests/core-session-retention.test.ts`, manual clock).

## 2. Notices

- [x] 2.1 Past the limit, a turn end retires superseded notices oldest first, whatever their acknowledgments; nothing retires below the limit or on an acknowledgment or start (retention tests 1-3, 5).
- [x] 2.2 Counting notices alone past the limit are refused with `capacity` and none is retired (retention test 4).
- [x] 2.3 A session stored at the limit across a restart takes its next turn end (retention test 3).
- [x] 2.4 A notice without a known turn among superseded ones is kept; negative control: treating it as superseded while the session's turn is known fails that test.
- [x] 2.5 At the limit, a Stop for a prompt whose start was never seen is refused with `capacity` and changes nothing, and the next known start and end apply.

## 3. Watermarks

- [x] 3.1 Past the limit, a native session drops answered attention watermarks and keeps one floor, the activity watermark and a held question's (retention test 6).
- [x] 3.2 Evidence at or below the floor is stale and evidence above it applies; a late duplicate after retry-key rotation raises nothing (retention tests 7-8).
- [x] 3.3 Negative control: without the floor check, retention tests 7 and 8 fail.

## 4. Specification and checks

- [x] 4.1 Update "Session capacity" in `bunny-runtime`, then sync and archive the change.
- [x] 4.2 Run the runtime, contract, agent-state, dashboard, consumer, build, typecheck, lint and workflow checks that AGENTS.md lists.
