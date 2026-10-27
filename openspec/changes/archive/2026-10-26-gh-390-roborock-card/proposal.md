## Why

The owner approved the quiet Roborock card and asked to reuse it on Home and the Roborock page. The current page exposes observation tables and Home uses a generic device card, so neither presents that design. Owning issue: https://github.com/jimmie-potts/agent-device-hub/issues/390.

## What Changes

- Export a module-owned presentation component and a shell-context adapter.
- Keep the vacuum illustration and card dimensions stable across Status, Last run and Care tabs.
- Replace the generic Roborock Home presentation without changing saved placement identifiers; expose an unavailable card when configuration or source data is missing.
- Use the same card on the Roborock page and preserve existing observations, history and sample evidence behind an explicit disclosure. Add a module-local History address for the card footer.
- Read only retained status/run data. Add a fixed one-record `latest-run` projection because existing history pages use archive insertion order, which does not identify the most recent run. Keep unknown fields, independent timestamps and safe refusal codes visible through concise labels and a corner warning disclosure.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `roborock-observations`: reusable passive card and truthful source-bound presentation over the existing module interface.

## Impact

Changes are confined to the Roborock browser contribution, its additive page/content declarations and indexed private-store read, dashboard composition/catalog, tests and owning documentation. No wire schema, collector, store schema or ownership, device command, dependency or shared package changes. Existing ADR 0012 transport/error/trace handling remains authoritative. The issue's source-only delivery boundary remains; installation and physical evidence are separate.
