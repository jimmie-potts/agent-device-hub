## 1. Tests first

- [x] 1.1 Red: tests for every profile on the configured provider with its persona (`assistant.test.ts`), the section that names only B.U.N.N.Y.'s model with the real adapter behind a fake transport (`configure.test.ts`), companion titles and their spend rows (`conversation-titles.test.ts`), a companion meeting the spend limit (`assistant-spend.test.ts`), MicroDuck's quacks-only speech rule with Reachy as the negative control (`assistant.test.ts`) and the rail profiles without a kind (`conversation-rail.test.ts`). Evidence: before the change 6 of 9 selected tests fail; the explicit synthetic provider and the no-title-model tests pass as preserved behavior.

## 2. Implementation

- [x] 2.1 `engine.ts`: `provider(profile)` and the title seam serve every profile; `#speak` and the `speak` control apply the persona's audio rule. Evidence: the selected tests pass.
- [x] 2.2 Frontend: no Demo label in the rail, header, note or Details; Details names the configured model for every profile; MicroDuck's note replaces Read aloud; the spend notice applies to every profile. Evidence: unit tests and the browser journeys.
- [x] 2.3 Browser journeys and the verification capture that checked the Demo labels. Evidence: the focused browser runs.

## 3. Documentation and archive

- [x] 3.1 Companions README, dashboard and verify READMEs, `docs/development.md` and `apps/runtime/UPGRADE.md`. Evidence: readback.
- [x] 3.2 Sync and archive this change. Evidence: `npm run check:workflow` passes.
