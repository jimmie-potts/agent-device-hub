## Context

The coding coordinator owns job identity, worker responsibility and observations.
Conversation already uses authenticated content reads and tracked assistant input
commands. The dashboard follows coding state for refresh and bounds each read.

## Goals / Non-Goals

- Share one job projection between the Jobs page and individual Conversation cards.
- Keep owner-read grants and per-attempt authority at the runtime boundary.
- Keep host-native session launch in the native client feature.

## Decisions

- Extend the existing authenticated Jobs content read with bounded keyset pages
  and exact job lookup. Filter visibility before forming a page or its cursor.
- Reuse the tracked assistant input for explicit controls. Bind both the stable
  job ID and the selected attempt and refuse a stale pair.
- Interpret only explicit job instructions as job controls. Offer eligible
  choices when a label or repository identifies multiple jobs. An ordinary
  Conversation prompt stays on its selected supervisor.
- Display queued, harness-accepted and observed evidence as separate facts.
  Preserve unknown values when a harness supplies no model, usage or result.
- Present a worktree reference through the reviewed attempt projection. Raw
  host paths, credentials and transcripts stay outside shared Jobs responses.

## Risks / Trade-offs

- A connection loss can leave an instruction's fate uncertain. Preserve the
  attempt identity and show known evidence through reconnect without resending.
- An older worker may offer stop only. Its message control explains the
  unsupported capability without trying a replacement launch.
