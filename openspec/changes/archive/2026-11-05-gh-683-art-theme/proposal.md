## Why

[Issue #683](https://github.com/jimmie-potts/agent-device-hub/issues/683) lets displayed art influence the dashboard's decoration while the owner retains control. The reviewed art presentation context now distinguishes decoded visible artwork from pending, stale and unavailable content, so theme changes can follow actual presentation safely.

## What Changes

- Derive bounded decorative colors from the validated palette of fresh, visibly presented artwork. Keep fixed semantic colors, readable contrast, typography and geometry.
- Add browser-local Follow artwork, Lock current colors and Restore default controls in Settings. Save explicit choices, including a default lock, without a backend owner or Home layout edit.
- Reject malformed palettes/preferences and arbitrary texture, URL or executable styling input. Keep the prior valid or default theme when artwork is unavailable.
- Update the style guide's accepted runtime-theme exception and add synthetic browser, contrast and persistence evidence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-dashboard`: allow bounded art decoration over Quiet glass and explicit browser-local theme preferences while preserving semantic states and geometry.
- `bunny-art`: define the presentation-driven palette handoff, invalid-input fallback and zero-generation/device effects of local theme application.

## Impact

The shared shell owns the decorative token application and browser preference. The art module remains the catalog and presentation source. No wire contract, backend storage, external asset, model request or device writer is added. Changes stay in runtime dashboard skin/components/tests, synthetic art evidence, the style guide and owning validation guides/CI. Installation and optical acceptance remain with [#687](https://github.com/jimmie-potts/agent-device-hub/issues/687).
