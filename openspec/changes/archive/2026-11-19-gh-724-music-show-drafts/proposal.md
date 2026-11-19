## Why

[#724](https://github.com/jimmie-potts/agent-device-hub/issues/724) adds an optional way to draft a Nanoleaf show using Music measurements and the operator's direction. The existing editor, save and playback paths remain the way to review and use a draft.

## What changes

- Add explicit generation and cancellation to Saved shows.
- Validate Claude's declarative cues against the supported show recipes and available measurement spans.
- Explain measurement coverage, model route, disclosure and cost before or after generation as appropriate.
- Allow the operator to edit and explicitly save an immutable version before separately starting playback.

## Capabilities

### Modified capabilities

- `nanoleaf-show-library` adds measured and generic AI draft authoring.

## Impact

Nanoleaf owns the draft and separate Music spend records. The dashboard uses existing tracked commands and authenticated content reads. Source tests use synthetic data and a fake provider. Installation and physical playback remain with [#725](https://github.com/jimmie-potts/agent-device-hub/issues/725).
