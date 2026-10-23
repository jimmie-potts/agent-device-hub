## Why

[#695](https://github.com/jimmie-potts/agent-device-hub/issues/695) lets the owner keep the Hub in Work while saving Free for one device. #924 already supplies the global owner and dispatch; exceptions belong on the existing device cards, with compact inspection on the existing Hub card.

## What Changes

- Extend the current core mode owner with persistent per-participant choices and guarded individual commands; global selection clears them.
- Retain registration of `mode/2.0` and its global fields; publish the full choice through `mode/2.1` with individual overrides.
- Reuse the existing Hub, lighting and Pixoo cards, adding device-level controls and neutral collapsed exception details. Existing Inbox warnings retain failures.
- Retain zero-participant global selection, independent outcomes, bounded busy refusal, durable identity and no replay.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-hub-mode`: individual choices, ordering, compatibility and reusable dashboard surfaces.

## Impact

Event-contract families, core mode owner/tracker integration, HTTP/MCP and shared dashboard/module presentation. Existing module writers/native mappings remain authoritative. Real-device installation and #1050 installed acceptance are separate; #415/#635 remain future consumers. No cross-repository wire contract change or legacy #67 API is introduced.
