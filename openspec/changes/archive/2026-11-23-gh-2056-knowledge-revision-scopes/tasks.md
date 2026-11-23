## 1. Knowledge revision scopes

- [x] 1.1 Red: `knowledge-revision-scopes.test.js` accepts library, voice, Duck widget, correction, removal, fixture and archive commands after another conversation's step, and refuses each scope's stale, future and pre-restart commands. Evidence: on the assistant-wide check, 4 of its 5 tests fail at their first accepted case with `revision-conflict`; the fifth, a refusal in the running conversation itself, passes on both.
- [x] 1.2 Record the library and Duck widget scopes in `companion_scope_changes`, mark corrected, removed and imported conversations through #2027's table, and check each command against what it changes. Evidence: the same 5 tests pass, and so do `knowledge.test.js` and `assistant-concurrency.test.js`.
- [x] 1.3 Raise both scope rows at each start, and raise companion exchanges without a profile in `restarted()`. Evidence: the restart test passes; removing either raise fails it.
- [x] 1.4 Mutations: dropping the scope record, the conversation mark, the import's conversation set or either start raise each fails at least one of the new tests.

## 2. Documentation

- [x] 2.1 Update the companions README, `docs/development.md` and `apps/runtime/UPGRADE.md`. Evidence: readback.
- [x] 2.2 Synchronize `bunny-companion-knowledge` and `bunny-assistant-tasks` and archive this change. Evidence: `npm run check:workflow` passes.

## 3. Review round 1

- [x] 3.1 Red: with the Duck widget changed before the library, removing the Duck widget's raise at start passes every test. Evidence: the restart test now selects the Duck conversation first, then creates an entry and renames another conversation; removing either scope from the raise fails it.
- [x] 3.2 Red: a stale second removal of a message another page already removed is accepted. Evidence: the message test refuses it; dropping the removal-record fallback fails that assertion.
- [x] 3.3 Red: an import's removal and new-conversation branches have no failing test. Evidence: the new import test refuses a stale correction after an import removed a sibling message, and a stale rename after an import added MicroDuck's conversation and binding; mutating either branch to record nothing fails it.
