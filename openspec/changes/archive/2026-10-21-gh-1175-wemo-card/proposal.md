## Why

The Wemo integration still uses the generic device card. The approved focused card should identify the connected lamp and expose frequent controls with less repeated text. This delivers [Hub #1175](https://github.com/jimmie-potts/agent-device-hub/issues/1175).

## What Changes

- Reuse one Wemo card on Home and existing device routes, with a large desk-lamp illustration and a smaller plug.
- Switch only the controls between Power and Auto-off while retaining artwork position and card dimensions.
- Use observed-state On/Off buttons; remove routine duplicated power/reporting labels, Smart plug, Armed and the standing warning beneath Save limit.
- Keep exceptional outcomes visible and retain existing observation/enforcement evidence in a collapsed device evidence disclosure.
- Preserve command and maximum-on behavior through the existing adapters.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-dashboard`: reusable concise Wemo presentation with stable tab geometry, truthful observations and retained control/recovery semantics.

## Impact

Runtime dashboard presentation, Wemo composition, optional compact presentation in PowerLimitPanel, existing Wemo browser journey and owning guides. No API, event, storage, transport or dependency changes. ADR 0012 command/outcome and diagnostic contracts remain unchanged. Existing bunny-wemo and bunny-power-limits requirements remain satisfied through controls and collapsed evidence. Installation uses the qualified routine current-runtime upgrade; acceptance uses simulated devices and passive installed browsing.
