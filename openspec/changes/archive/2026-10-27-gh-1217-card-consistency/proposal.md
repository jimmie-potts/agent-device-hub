## Why

The reusable cards share the Quiet glass palette, but their individual styles still use different padding, title sizes, tabs and footer targets. [Issue #1217](https://github.com/jimmie-potts/agent-device-hub/issues/1217) selects a consistency pass across the existing cards without changing their controls or artwork.

## What Changes

- Add a shared runtime card presentation layer using the existing semantic skin tokens.
- Align outer frames, responsive padding, card titles, tab controls and footer links across Home and feature pages.
- Preserve device-specific art and control-face sizes, attention surfaces, state evidence and command guards; omit only Music's neutral initial command placeholder through its existing presentation adapter.
- Extend the existing hosted browser entry with a synthetic real-runtime card comparison and retain the full browser suite.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-dashboard`: consistent reusable card presentation, responsive controls and accessible shared visual treatment.

## Impact

Runtime dashboard CSS, its style import, the Music adapter's initial feedback presentation, browser checks and owning guide. No module backend, protocol, API, dependency, durable format, configuration, legacy dashboard or device command changes. The established WSL installation uses its qualified routine update procedure; actual iPhone and physical-device evidence remain separate.
