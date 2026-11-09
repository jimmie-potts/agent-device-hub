## 1. Contract

- [x] 1.1 Add the closed `art-show/2.0` schema, its family on subject routing, browser-safe identity helpers in `v2/art-show` and valid, reply, outcome and invalid fixtures; `npm run test:events:built` and the Python contract and event checks pass with the new fixtures.

## 2. Core command and plan

- [x] 2.1 Admit `art-show` through the tracked dispatcher as `mode-set` is admitted, give it the `moment` deadline class and answer it in a core part; `apps/runtime/tests/art-show.test.ts` shows a direct bus command is `forbidden` and nothing is sent.
- [x] 2.2 Check the artwork and targets against the art owner's published record and the configured art displays, holding one show slot; the same test shows `not-found`, `unsupported-capability` and `capacity` refusals send nothing and a target without a composition is skipped and logged while the browser proceeds.
- [x] 2.3 Build the plan at now + 20 s with the schedule's tolerance and cutoff, `event`, the request's `coversStatus` and 10 s / 30 s durations, run `ArtPlans.present` with the owner permit and complete the show's operation after the handoff; the test shows one preparation and one moment per display with exact compositions and durations, one browser present at the start, one trace, `succeeded`/`observed`, a display refusal failing that surface alone, and a restart leaving the show `uncertain` with nothing replayed.
- [x] 2.4 Log each surface as an `art-show` automation log row with origin `owner` and `priorityClass` `event`, and read the art record for a show while scheduling is disabled; `art-schedule.test.ts` shows on the manual clock that a show in quiet hours after a scheduled appearance leaves the schedule record, flourish count and reservations unchanged and the next appearance still runs, and the permit unit case shows attention refuses while quiet hours and budgets are not consulted.

## 3. Consumers

- [x] 3.1 Add `GET /api/v2/automation/art/targets` and the control-scope MCP tool `core_art_show` returning each surface's request IDs; `automation-routes.test.ts` and `gateway.test.ts` show the read, the tool list for operator and reader, a core refusal in the shared error body and a reader's refused call.
- [x] 3.2 Add Show now to the gallery with surface choices, the shell's tracked attempt and per-surface lines from operation records; `modules/art/tests/frontend-model.test.ts` shows only showable surfaces are sent and transmission is never presented as display, and `apps/runtime/dashboard/tests/automation.test.ts` shows owner rows read their operations.
- [x] 3.3 Exercise Show now in the Art browser check on the simulated Tidbyt and the `art-show` runtime scenario on the simulated Pixoo and Tidbyt, both in Linux; record the runs in the PR.

## 4. Records

- [x] 4.1 Update the runtime, art and contract guides and the development checks, validate this change strictly, synchronize `bunny-runtime` and `bunny-art`, and archive it on the delivery branch before final review.
