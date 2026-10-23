## Why

[Hub #662](https://github.com/jimmie-potts/agent-device-hub/issues/662) makes Duck's latest intended meaning visible on Home, with older conversation elsewhere. The owner selected one explicit, clearly labelled Reachy–Duck conversation; #636 already owns its private records.

## What Changes

- Save one optional conversation selection through the existing companion controls.
- Add a read-only Home catalog card showing that conversation's latest Duck message, its original time and qualified evidence.
- Open bounded separate history using the same record owner and shared message presentation.
- Invalidate displayed content on correction, removal, selection change or access loss; reads never produce audio or device effects.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-companion-knowledge`: explicit widget selection, private latest/history read and read-only dashboard presentation.

## Impact

Companions owns a small local selection record and `duck-widget/1.0` content document, reusing `assistant-input/2.0`, assistant-state invalidation and the existing SDK database/outbox. The runtime Home catalog mounts its browser export through the current module scope. No new package, service, model, sensor, microphone, audio route or installation. Existing companion/runtime/browser suites and independent review qualify source only; #643 retains installed acceptance.
