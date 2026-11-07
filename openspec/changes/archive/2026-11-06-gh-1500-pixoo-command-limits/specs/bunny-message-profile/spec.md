## ADDED Requirements

### Requirement: Long exact-art stages

Art SHALL use the existing dispatch and stage contracts through 256 frames. Above 256 frames it SHALL use the extended staging contract only for a currently resolved Pixoo advertising extended GIF staging and adequate byte capacity. The core SHALL verify the target owner and capability before admitting the extended dispatch, forward it once under the tracker and omit image bytes from its durable operation identity. The extended dispatch SHALL accept only staging. All versions SHALL preserve the shared 160 KiB and 300,000 ms stage budgets.

#### Scenario: Extended stage on a declared Pixoo

- **WHEN** Art presents more than 256 frames to a current hosted Pixoo declaring extended staging
- **THEN** the core accepts the Art module's `art-dispatch/2.2` and forwards one `art-stage/2.1` to that target
- **AND** an identical retry returns the existing tracked result without replay

#### Scenario: An ineligible target or dispatch

- **WHEN** extended staging names a Tidbyt, a stale or undeclared target, or an extended dispatch requests an ambient change
- **THEN** it is refused before tracking or writing to a device
