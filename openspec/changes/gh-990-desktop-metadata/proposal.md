## Why

[Hub #990](https://github.com/jimmie-potts/agent-device-hub/issues/990) preserves the old Hub's archive admission and Desktop-home titles at the source-only runtime cutover. The existing module ports read evidence only.

## What Changes

- Read positive archive filenames and bounded session_index.jsonl titles in the existing child reader.
- Add metadata-observed to the existing lifecycle family; keep its envelope, routing and title format.
- Guard admission with ephemeral scoped archive evidence, and update titles without creating sessions or refreshing lifecycle evidence.
- Preserve missing/stalled fail-open behavior, fresh unarchive admission, explicit labels and source isolation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-codex-desktop`: archive and independent title observations alongside read evidence.

## Impact

Codex Desktop module, lifecycle/2.0 type/schema, agent-state title update, runtime core intake and direct consumer tests. No new service, migration, framework or producer changes; the old Hub remains unchanged. Installation belongs to #840. ADR0011/0012 apply; no cross-repository wire contract changes.
