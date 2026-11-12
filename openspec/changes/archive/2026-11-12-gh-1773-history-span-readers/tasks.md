## 1. Read API

- [x] 1.1 Write the tests first on given instants: open spans for the entities in a page with one lookup per entity, none for other rows, a page without them, an unknown start, a backward clock, a removal, a gap row, and `after` rows only (`apps/runtime/tests/history-open.test.ts`).
- [x] 1.2 Add `History.open` and `History.page`, `Core.historyPage`, and the gateway's optional `open` member; pin a page without spans byte for byte and an old reader that reads only `rows`.
- [x] 1.3 Keep `core_history` rows only and pin its published output schema (`apps/runtime/tests/inbox-gateway.test.ts`).

## 2. Timeline

- [x] 2.1 Write the model tests first: each row shape, an unknown start, a backward clock, one reading, very short and very long lengths, plural forms, a closing row followed by its removal, the open span's row, malformed members, and a row without any of these reading as before.
- [x] 2.2 Read `open` in the reader, attach it to its row, and add the lines to the card, hidden in a closed Home-shape entry.
- [x] 2.3 Extend the Timeline browser journey with a span, a gap, a closing row and an open span on a fixed clock, with screenshots.
- [x] 2.4 Show the negative controls: the new tests fail without the change.

## 3. Documentation and delivery

- [x] 3.1 Update `apps/runtime/README.md`'s history read section.
- [x] 3.2 Run build, typecheck, lint, the runtime suites, the MCP checks, the dashboard checks and journeys, and the workflow checks; record the results in the pull request.
- [x] 3.3 Sync and archive this change on the delivery branch.
