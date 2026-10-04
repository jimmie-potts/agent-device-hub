## Context

Codex focus verification ([#742](https://github.com/jimmie-potts/agent-device-hub/issues/742)) needs a name to match against the selected sidebar row, because Codex records no selection by ID. The slot's title comes from the Hub snapshot, which carries a Codex title only when the owner set one: the #743 trial found titles on 5 of 127 sessions. Codex's local `session_index.jsonl` holds `id`, `thread_name` and `updated_at` lines for named threads and named 5 of the 6 open Codex slots.

## Decisions

- **Source.** The adapter looks up the thread's name in `<codex home>/session_index.jsonl` at verification time. Codex appends a line on naming or renaming, so the entry with the latest `updated_at` wins and a later line wins a tie. The sidebar shows Codex's name, so it takes precedence over the Hub title, which stays as the fallback for threads Codex has not named.
- **Contract.** `codexSelectedThread(threadId, fallbackTitle)` replaces `codexSelectedTitle(title)` so names never cross the adapter boundary, and the interface version becomes 2. The UI Automation helper's protocol is unchanged.
- **Timing.** The router still opens the link before verification. A thread with neither name now opens and then fails verification as `title-missing` after the bounded poll, instead of failing before the link. Opening only navigates; nothing is typed.

## Privacy

Thread names derive from prompts. The adapter reads only the three keys, keeps the parsed map in memory until the file changes, and never logs, persists or sends a name; router events keep slot numbers and reason codes only. No collection, retention or export changes, so ADR 0011's boundaries are unaffected.

## Failure and recovery

- A missing index is "no name" (fallback applies); a missing Codex home, an unreadable or oversized (over 16 MiB) index is unknown, and the Hub title still applies when present.
- Malformed lines, IDs that are not thread UUIDs and empty or overlong names are skipped.
- A wrong or stale name can only fail closed: the selected row must match the name and be the only row with it.

## Acceptance examples

| Example | Test |
| --- | --- |
| Hub title absent, Codex name present: focus verifies | `routing-router.test.mjs` "verifies by the name Codex keeps" |
| Codex name differs from a stale Hub title: Codex's wins | `routing-router.test.mjs` "takes precedence"; `windows-adapter.test.mjs` |
| Neither name: nothing typed, `title-missing`, no target | `routing-router.test.mjs` "neither a Codex name nor a Hub title" |
| Latest entry wins; malformed lines skipped; cache follows file changes | `windows-client-files.test.mjs` |
| Unreadable index falls back to the Hub title | `windows-adapter.test.mjs` |
