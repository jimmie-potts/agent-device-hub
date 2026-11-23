## Context

A knowledge command stages a private input that names `expectedRevision`, the assistant revision the page read from a knowledge, profile, history or Duck widget view. Before this change, the knowledge engine refused the command unless that revision equalled the current assistant revision. Every committed task change of any conversation moves that revision. #2027 already replaced the same check for conversation commands with `assistant_conversation_changes`: a row per conversation holding the assistant revision of its last change, written by `AssistantStore.bump` for the conversations marked in the transaction, and raised at each start by `restarted()`.

## Goals and non-goals

Goals: a running conversation's steps never make a knowledge command stale; a command is still refused when what it changes changed after the revision it names, or when it names a revision the assistant has not reached; no wire change.

Non-goals: device-command guards, approval guards (Hub mode, coding worker), enable and disable, and the #2027 conversation checks, which stay as they are. Preference commands keep their own preference revision.

## Decisions

### 1. Scope rows beside the conversation rows

A new module table, `companion_scope_changes (scope TEXT PRIMARY KEY, revision INTEGER NOT NULL) STRICT`, holds the assistant revision of each scope's last change. There are two scopes: `library` and `duck-widget`. `KnowledgeLibrary` owns it on the SDK's one connection. The knowledge engine records the scopes a command changed in the command's synchronous outbox transaction, right after `assistant.store.bump()`, at the revision that bump published. Conversations stay in #2027's table: the engine marks each conversation the command changes with `assistant.store.touch`, and the same bump records it. Nothing awaits inside the transaction.

The check runs inside the transaction before the command applies:

```
revision > assistant revision
  or any scope it changes has changedAt(scope) > revision
  or any conversation it changes has changedAt(conversation) > revision
→ revision-conflict
```

A refusal is a typed `revision-conflict` before any effect, with the existing detail "The knowledge change was not saved.", and nothing retries it (ADR 0012).

### 2. Which action changes what

| Action | Scopes | Conversations |
| --- | --- | --- |
| `create`, `edit`, `import`, `set-active` | library | none |
| `set-voice` | library | none |
| `fixture` | library | none |
| `import-archive` | library | each conversation it adds to |
| `select-duck-conversation` | duck-widget | none |
| `correct-message`, `delete-message` | none | the message's conversation |

- Knowledge entries and voices are the library, as the issue says.
- `fixture` creates a synthetic Reachy–Duck exchange from the Companion knowledge page. It changes no existing conversation. Leaving it with no scope would mean the rule never applies to it, against the owner's decision to narrow the rule and not remove it. So it is checked and recorded on the library scope, and the existing test that refuses a fixture naming an old revision still holds.
- `import-archive` adds missing knowledge entries and voices, so it changes the library. It also adds to conversations. Section 3 explains which ones it is checked against.
- `select-duck-conversation` changes only the widget's selection row.
- A correction or removal changes one message, and the issue names the owning conversation's #2027 change revision for it. Once a message is removed, its removal record names the conversation (review round 1 on PR 2073), so a stale repeat removal or correction is still refused as a revision conflict, as it was under the assistant-wide check. A command for an unknown message names no conversation and is refused `not-found` when it applies.
- A preference merge inside `import-archive` is not checked against preference changes. Preference commands move only the preference revision, never the assistant revision the page reads, so the old check never covered them either.

### 3. An import is checked against the conversations it actually changes

An archive usually repeats conversations the store already has, including one that is running now. Checking every conversation the archive names would refuse a re-import of a current export whenever any conversation is working, which is the false refusal this change removes. The library therefore reads, before applying, the conversations the import will change: a conversation not yet saved, a profile binding not yet saved, a removal not yet known, or a message neither saved nor removed. The import is checked against those and marks them. An archive whose records are all present changes no conversation, so a running conversation never makes it stale.

### 4. A correction or removal is a change of its conversation

The message's conversation must record the correction, or a second correction bound to the same revision would be accepted. The mark goes through #2027's table, so that conversation's own commands (start, answer, cancel, rename, Read aloud) naming a revision before the correction are refused as well. That is the #2027 rule applied to one more kind of change; the check itself is unchanged.

The owning conversation's steps also move its change revision. So a correction of an earlier, finished message in a conversation whose next task is running is refused when that task took a step after the page's read. This follows from the issue's choice of the conversation's change revision. A finer message-level scope would need an owner decision.

### 5. Starts raise every row

`Knowledge.start()` raises both scope rows to at least the assistant revision at start, the way `AssistantStore.restarted()` raises conversation rows. `restarted()` now also covers companion conversations without a profile (`companion_conversations`), such as a fixture or imported exchange, because their messages can now be corrected under a per-conversation check. This only makes the check stricter, and only for revisions read before the start. It also fills the rows on the first start of this release and repairs rows that an earlier release left behind after a rollback. That release changes the library, widget and messages without recording them.

### 6. No wire change

The page keeps sending the one assistant revision it read. Every scope row holds an assistant revision, so comparing it with that revision is meaningful. No new field or schema is needed.

## Risks and trade-offs

- Commands of different scopes no longer conflict with each other. A Duck selection and a library edit made from the same stale read are both accepted, because neither changes the other's state.
- A correction is still refused after its own conversation's running step (Decision 4).

## Migration and rollback

The table is created on first open and filled at the first start. No record is rewritten. An earlier release ignores the table. Installing this release again raises its rows at the first start, so a command naming a revision from before that start is refused once. `apps/runtime/UPGRADE.md` records this.
