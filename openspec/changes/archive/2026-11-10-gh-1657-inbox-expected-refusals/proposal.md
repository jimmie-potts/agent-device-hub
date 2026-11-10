## Why

On 2026-11-10 the owner's Inbox held 13 items dated 2026-10-27 to 2026-11-10 ([#1657](https://github.com/jimmie-potts/agent-device-hub/issues/1657)). None needed action, and 10 could only be dismissed, because Send again would have been refused for them. They were scheduled art moments refused by a display, a core-dispatched Music lighting start refused by the light, unconfirmed companion speech lines and an assistant mode change refused for a stale revision.

Owner decisions, 2026-11-10:

- D1: a refusal that holds no device and could only be dismissed, because Send again would be refused for it, stays in history and opens no Inbox item, including one the owner triggered.
- D2: no auto-clear. Items still never clear by age or on a later success.
- D3: an unconfirmed companion speech line (`uncertain-result`, no device hold) opens no Inbox item.

## What Changes

- **One rule for Send again and for opening an item.** The core's inbox decides in one place whether Send again would refuse an operation: MicroDuck commands, moments naming art, commands whose payload was not retained, a Hub mode change refused for a saved revision that can never match again, and the dispatcher's requester rules (only the core sends Music lighting work, only the companions module sends speech, each art family has one requester). Send again and the open rule both read it, so they cannot drift.
- **Refusals that only Dismiss could clear open no item.** A rejected reply (the owner refused the command before acting, so it left no effect and holds no device) opens no item when Send again by the dashboard would be refused for it. Its tracked operation and history keep the result, code and detail.
- **Unconfirmed speech opens no item.** A `companion-speech-*` operation whose result is `uncertain` opens no item. A definitive failure after acceptance still opens one.
- **Stale mode revisions.** Send again of a mode change refused `revision-conflict` for its saved expected revision is refused with `revision-conflict` before anything is handled or sent. Before this change it handled the item and sent a command that the mode owner was certain to refuse again, which opened a fresh item.
- **Assistant mode changes.** An approved assistant mode change stays bound to the revision it was proposed against (`bunny-assistant-tasks`), so approving an older proposal never overrides a mode the owner set by hand in between. The core's `revision-conflict` refusal is explained in the assistant's tool result ("the Hub mode changed since this was proposed; nothing was changed"), and it opens no item under the rule above.
- **Unchanged:** every other failed, uncertain or conflicting outcome opens an item, including uncertain device writes that may set a hold, conflicts, failures after acceptance, expired commands and refusals the dashboard can send again. Items have no time limit, a later success clears nothing, handling never releases a hold and nothing resends automatically. Codes stay registry codes; no message format, error shape or polling path is added.

## Capabilities

### Modified Capabilities
- `shared-inbox-history`: which outcomes open an item, and Send again's refusal of a stale mode revision.

## Impact

- `apps/runtime/src/core/inbox.ts` and `tracker.ts`: the shared resend rule and the open rule.
- `modules/companions/src/assistant/engine.ts`: the stale approval's conflict reply.
- Runtime and companions tests, the runtime and dashboard READMEs and ADR 0012's Inbox paragraph.
- No contract, schema, storage or migration change. Items already open stay open until handled. Installation follows the runtime upgrade procedure separately.
