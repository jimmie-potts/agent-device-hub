## Why

Current documentation still directs readers to the pre-cutover system and contradicts accepted installed qualification. Hub #889 owns canonical documentation and stale-claim correction after the owner authorized the October 9 sweep cleanup.

## What Changes

- Point current entry points at apps/runtime and distinguish retained legacy operations and dated evidence.
- Correct qualification claims against #743 and #784, the agent-state notice sentence, and two stale anchors.
- Add an independent runtime architecture diagram with source provenance and separate render/browser/semantic evidence.
- Correct the dashboard requirement's legacy-service clause to preserve source for manual return rather than require the stopped old Hub to serve pages.
- Expose the absent qualified runtime upgrade procedure without inventing an installer or expanding installation authority.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-dashboard`: align retained-old-source wording with the accepted #840 fresh cutover and deferred #839 retirement. Dashboard behavior and scenarios remain unchanged.

## Impact

Refs https://github.com/jimmie-potts/agent-device-hub/issues/889. Current README, architecture, instructions, component/qualification guides, OpenSpec context and the runtime-dashboard specification. The new diagram is independent of Work Guide. No product code, runtime, settings, device operation or public publication changes. #890 retains shared-diagram extraction and remaining flow views; #891/#892 retain consolidation and Guide retirement.
