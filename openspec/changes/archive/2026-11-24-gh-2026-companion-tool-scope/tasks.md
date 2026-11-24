## 1. Tests first

- [x] 1.1 Tests: the companions' offered tools with a device and a catalog tool allowlisted, and B.U.N.N.Y.'s full set (`assistant.test.ts`); a persona whose audio is not speech is never offered, refused with generic text, and shows the note (`assistant.test.ts`); the upgrade path from a synthetic-left waiting task (`configure.test.ts`); a paid Reachy and MicroDuck in Details and the spend notice (`conversation-state.browser.ts`). Evidence: each fails against the reverted code (PR).

## 2. Implementation

- [x] 2.1 `tool-scope.ts`, `permittedTools` by profile, `spokenAloud`, generic `UNSPOKEN`, Details' per-profile tools, the persona-driven note and the voice panel wording. Evidence: the tests pass.

## 3. Documentation and archive

- [x] 3.1 Companions README. Evidence: readback.
- [x] 3.2 Sync and archive this change. Evidence: `npm run check:workflow` passes.
