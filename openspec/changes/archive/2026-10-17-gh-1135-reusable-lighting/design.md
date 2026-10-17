## Context

See proposal.md and issue #1135. The current React shell already owns one SDK connection, scoped records, retained command identities and tracked outcomes. Core parts persist metadata and publish in the core transaction/outbox; ModePart demonstrates authenticated dispatcher admission. LIFX publishes its own color family; Nanoleaf publishes its own geometry. The approved prototype supplies the visual direction, not a device transport or evidence source.

This design is required by the schema because a durable model and multiple component boundaries change.

## Goals / Non-Goals

**Goals:** keep presentation reusable, save private composition once, and preserve existing device admission and evidence on every view.

**Non-Goals:** qualify new device models, build native effects/timers, replace advanced editors, or deliver the broader widget-grid editor. The browser never owns durable room assignments or a physical-device queue.

## Decisions

1. **Presentation and commands have separate inputs.** A lighting card accepts member summaries, artwork and explicit action bindings. Shared aggregation and capability intersection live beside it and are tested independently. Device-specific forms adapt public module contracts. Each target reuses the existing retained-attempt mechanism; group admission checks every member before starting independent requests. This keeps device transport and a second lifecycle reducer out of the card. Copying the prototype's simulated request counter would fabricate integration.
2. **Core owns one lighting layout.** A new core part stores a closed, bounded JSON record in private SQLite, guarded by its prior revision. Rooms, assignments, group scope and selected Home targets commit together. SDK sync publishes it through the existing connection; a tracked operator command uses existing admission/outcome machinery. Browser storage is limited to transient tab choice/request identities. Per-browser layout storage would not satisfy the second-browser requirement; a new service would duplicate existing ownership.
3. **Groups are views over current records.** Room membership is resolved on render. A custom group's references stay scoped to its view; its members do not render individual controls there. Unknown references remain visible/unavailable rather than disappearing into another target. Brand membership is checked against the current owner before controls are admitted. Grouping and Home selection save metadata only. Group action outcomes stay per device; there is no atomic lighting transaction.
4. **Keep the image outside the control flip.** Native labelled tabs reveal one control face. Rapid changes cancel the previous transition; reduced motion switches instantly. Stable face height keeps artwork stationary. The scoped glass tokens live in the skin layer and preserve fixed status colors. Other app pages keep their established skin.
5. **Use actual module capabilities.** LIFX color/temperature records follow their declared owner on the same participant. Native color and temperature commands preserve module semantics; changing a tab changes no device setting. Missing timers and scenes explain their absence. Native scene admission keeps its explicit mode requirement. Device settings remain reachable for mode changes and detailed evidence.
6. **Use module-owned artwork through a public frontend seam.** The shared card takes a visual node. Nanoleaf owns interpretation of its saved geometry and renderer; the dashboard does not copy a second geometry reducer. Generic bulbs and unsupported bars use identified illustrative placeholders.

## Risks / Trade-offs

- A stale client can overwrite assignments → required expected revision, visible conflict and explicit refresh; no automatic retry.
- A lost save reply can have committed metadata → tracked operation lock and fresh sync, never a replay of the draft.
- A member becomes unavailable after preflight → existing owner admission decides that member's independent result; expose partial outcomes without claiming atomicity.
- Desired state or transmission can look like observation → compact status preserves the distinction, with the full evidence in Details.
- A capability exists in the prototype but not the runtime → render its unavailable reason and keep the owning feature separate.
- Personal room labels can leak through evidence → synthetic fixtures only in Git/CI, private runtime storage, and diagnostic identifiers without submitted values.

## Migration Plan

Create the core part's new table additively with an empty layout. It does not import legacy layout, guess room membership or execute a saved action. Existing routes and owners remain usable. Validate new storage through restart tests and the owning runtime upgrade procedure before installed adoption. A source revert leaves the new private table intact and unused; recovery eligibility still follows UPGRADE.md and exact release/latest-state evidence, not this design. No new installation or device permission follows from source checks.
