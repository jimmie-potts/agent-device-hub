## Why

Installed acceptance for [#1044](https://github.com/jimmie-potts/agent-device-hub/issues/1044) found that the production reader returns unavailable metadata even after correcting its raw ADB result channel. The successful qualification probe initializes Android's process-local media service manager; the production reader and its synthetic Android fixture omit that prerequisite.

## What Changes

- Initialize a missing process-local media service manager before requesting selected sessions; preserve an existing manager.
- Exercise the actual Java reader against both standalone and initialized Android fixtures, including bounded failure through raw ADB output.
- Reproduce and pin the corrected Dex artifact with a new reader source version. Preserve the wire contract and previously stored reader provenance.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `onn-title-history`: bounded collection supports the qualified standalone reader process, preserving existing initialization and honest unavailable results.

## Impact

ONN native reader, its synthetic tests, release pins and owning collection specification/documentation. TypeScript remains the scheduling, storage, API and dashboard owner. No new Android permission, setting, installed app, service, metadata field, transport fallback or deferred feature is selected. Device deployment and installed/physical acceptance require separate current authority and evidence.
