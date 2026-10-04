## Context

Codex focus verification ([#742](https://github.com/jimmie-potts/agent-device-hub/issues/742)) needs a name to match against the selected sidebar row, because Codex records no selection by ID. The slot's title comes from the Hub snapshot, which carries a Codex title only when the owner set one: the #743 trial found titles on 5 of 127 sessions. Codex's local `session_index.jsonl` holds `id`, `thread_name` and `updated_at` lines for the threads it has named; when this change was written it named 5 of the 6 Codex slot threads (4 of 5 after one was archived).

## Decisions

- **Source.** The adapter looks up the thread's name in `<codex home>/session_index.jsonl` at verification time. Codex appends a line on naming or renaming, so a thread's last line is its current name; in the owner's index (541 lines, 41 threads with several) timestamps never go backwards and the newest entry is always the last line. A last line with an unusable name or timestamp, or older than an earlier line, makes the name unusable rather than reviving an older one. The sidebar shows Codex's name, so it takes precedence over the Hub title, which stays as the fallback for threads Codex has never named.
- **Uniqueness.** The sidebar's duplicate count sees only rendered rows; collapsed projects and archived or deleted threads are missing. The adapter therefore also fails closed when any other thread in the index currently has the name it would compare, Codex's or the fallback. The owner's index had 5 names shared across 494 threads, so this rarely blocks a press, and renaming a thread clears it.
- **Contract.** `codexSelectedThread(threadId, fallbackTitle)` replaces `codexSelectedTitle(title)` so names never cross the adapter boundary, and the interface version becomes 2. The UI Automation helper's protocol is unchanged.
- **Timing.** The router still opens the link before verification. A thread with neither name now opens and then fails verification as `title-missing` after the bounded poll, instead of failing before the link. Opening only navigates; nothing is typed.

## Privacy

Thread names derive from prompts. The adapter reads only the three keys, keeps the parsed map in memory until the file changes, and never logs, persists or sends a name; router events keep slot numbers and reason codes only. No collection, retention or export changes, so ADR 0011's boundaries are unaffected.

## Failure and recovery

- A missing index is an empty index (the Hub title applies). A missing Codex home or an unreadable or oversized (over 16 MiB) index is unknown, and the press fails closed even with a Hub title, because uniqueness cannot be checked.
- Malformed lines and IDs that are not thread UUIDs are skipped; an unusable last entry fails closed for that thread.
- A wrong or stale name can only fail closed: the selected row must match the name, be the only rendered row with it, and no other thread may hold it.
- The UI Automation name of a sidebar row is expected to equal `thread_name`; the #743 trial confirms it live.

## Acceptance examples

| Example | Test |
| --- | --- |
| Hub title absent, Codex name present: focus verifies | `routing-router.test.mjs` "verifies by the name Codex keeps" |
| Codex name differs from a stale Hub title: Codex's wins | `routing-router.test.mjs` "takes precedence"; `windows-adapter.test.mjs` |
| Neither name: nothing typed, `title-missing`, no target | `routing-router.test.mjs` "neither a Codex name nor a Hub title" |
| Last line wins; unusable or out-of-order newest entry is unusable; cache follows file changes | `windows-client-files.test.mjs` |
| A name another thread holds, rendered or not, fails as `title-not-unique` | `routing-router.test.mjs` matrix; `windows-adapter.test.mjs` |
| Unreadable index or unset home fails closed even with a Hub title | `windows-adapter.test.mjs` |
