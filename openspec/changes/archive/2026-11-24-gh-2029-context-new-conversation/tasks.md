## 1. Tests first

- [x] 1.1 `conversation-context.test.ts`: builder order, budgets and stated trims; recent messages and tool results fixed at task start, without removed messages; no other companion or exchange; New conversation refused while running, waiting or uncertain and accepted after cancel, with its own conversation, session, title, change rows and empty recent section, and the earlier one readable and listed; the knowledge switch per companion and scope; the preview equal to the next call's sections before a task, during one and after a restart; a reference outside the budget; a legacy task; the device, artwork, troubleshooting and read-only follow-ups; the Duck widget across several conversations; archive import of earlier conversations. Evidence: negative controls in the PR.
- [x] 1.2 Update `anthropic.test.ts` (section order and the stable prefix across tasks), `assistant.test.ts` (sections and the stated preference trim) and `conversation-history.test.ts` (earlier conversation reads and the list). Evidence: they pass.

## 2. Implementation

- [x] 2.1 `context.ts` builder and the provider contract's `PromptContext`; the Anthropic system prompt from the sections. Evidence: `anthropic.test.js` passes.
- [x] 2.2 Store: `contextThrough`, `recentContext`, `newConversation`, `owns`, `conversations`, the knowledge switch table and `latest()` for current conversations. Engine: the context, preview, New conversation input and the `assistant-context`, list and earlier-conversation reads. Evidence: `conversation-context.test.js` passes.
- [x] 2.3 Knowledge: `set-context-knowledge` under the `context` scope, `knowledgeContext` in the profiles document, archive import of a profile's earlier conversations; `read_saved_art` names source requests. Evidence: the knowledge tests pass.
- [x] 2.4 Page: New conversation, its held note, Details' conversation list, the read-only earlier conversation, and the Companion knowledge page's switch and model context preview. Evidence: `conversation-context.browser.ts` passes at 1280 and 390 px.

## 3. Documentation and archive

- [x] 3.1 Companions README, `docs/development.md` and `apps/runtime/UPGRADE.md`. Evidence: readback.
- [x] 3.2 Sync and archive this change. Evidence: `npm run check:workflow` passes.
