## Why

The ONN owner retains selected-title observations, but its controls page cannot
show them. [Hub #1041](https://github.com/jimmie-potts/agent-device-hub/issues/1041)
adds the current content and stored history needed to identify previously
observed YouTube titles and Stremio episodes.

## What Changes

- Show current source metadata beside the existing ONN controls, with freshness,
  unavailable/disabled states and collection gaps.
- Browse bounded history by app, explicit local dates and title; inspect each
  occurrence and its contributing observation pages.
- Label YouTube as selected-title evidence and position/duration as source
  values. Empty sessions clear current content; uncertain identity remains visible.
- Verify keyboard operation, phone/desktop layout, accessibility, failed reads
  and reconnect without sending a device command from history interactions.

## Capabilities

### New Capabilities

- `onn-history-visuals`: Module-owned current content and searchable observation
  history through the shared authenticated dashboard.

### Modified Capabilities

None. The existing `onn-title-history` and `onn-controls` contracts are consumed
without changing their ownership, wire values or persistence.

## Impact

Changes stay in the ONN React contribution and its tests, with scoped shared
browser/catalog verification, CI and development-guide registration. The SDK
frontend context, shared dashboard shell and existing owner queries provide
the interfaces. No new dependency, database, device writer or collection source
is needed. ADRs 0011/0012 govern private data and event ownership. Watched totals,
completion, ad classification/Skip, topic inference and recommendations remain
outside this change. Installation and real-device acceptance belong to #1044.
