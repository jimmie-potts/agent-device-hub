## Why

[#2056](https://github.com/jimmie-potts/agent-device-hub/issues/2056), part of epic [#2035](https://github.com/jimmie-potts/agent-device-hub/issues/2035), follows [#2027](https://github.com/jimmie-potts/agent-device-hub/issues/2027) (PR #2055). #2027 checks each conversation's task commands against that conversation's own last change. The companion knowledge commands still compare `expectedRevision` with the assistant-wide revision, and every step of any running conversation moves that revision. So while a companion works, a library, voice, Duck widget or message command sent from a page read before the step is refused with `revision-conflict`. With several conversations running at once this is common.

The owner chose to keep the rule that refuses a command as out of date and narrow it, not remove it ([decision](https://github.com/jimmie-potts/agent-device-hub/issues/2056#issuecomment-7115342476)): each companion command is checked only against the state it changes. Device commands and the approval guards are unchanged.

## What changes

- Each knowledge command is checked against the scopes and conversations it changes, and records them as changed at the revision it publishes:
  - the **library** scope: knowledge entries (`create`, `edit`, `import`, `set-active`), `set-voice`, `fixture` and `import-archive`;
  - the **Duck widget** scope: `select-duck-conversation`;
  - the message's **conversation**, through #2027's per-conversation change revision: `correct-message` and `delete-message`;
  - `import-archive` also checks each conversation it adds to: a new conversation or profile binding, a removal not yet known, or a new message.
- A command is refused as a revision conflict when a scope or conversation it changes changed after the revision it names, or when the revision is ahead of the assistant's. The page keeps sending the one assistant revision it read; there is no wire change.
- A correction or removal counts as a change of its conversation, so that conversation's #2027 commands naming an older revision are refused too.
- Each start raises both scope rows, and every saved conversation including a companion exchange without a profile, to at least the current revision, as #2027's start does.
- Enable and disable keep the assistant-wide check. The #2027 per-conversation checks, device-command guards and approval guards are unchanged.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `bunny-companion-knowledge`: a new requirement, "Knowledge commands are checked against what they change".
- `bunny-assistant-tasks`: "Bounded execution per conversation" counts a message correction or removal as a change of its conversation, and a start counts every saved conversation, companion exchanges included.

## Impact

`modules/companions` (knowledge engine and library, assistant store) and its tests. One module table is added, `companion_scope_changes`; `apps/runtime/UPGRADE.md` gains an upgrade and rollback note. No event contract, SDK, runtime, page or diagnostic change. Delivery is reviewed source; installation joins the next runtime batch.
