## Why

The owner removed human UI approval and authorized routine installation through verified completion. Active Hub instructions and preflight still impose obsolete approvals, and pickup assessment can miss architecture changes made after planning.

Owning scope: [Hub #657](https://github.com/jimmie-potts/agent-device-hub/issues/657), its independently actionable UI portion and Wave 1 consumer amendments, coordinated with [agent-skills #136](https://github.com/jimmie-potts/agent-skills/issues/136) and [#137](https://github.com/jimmie-potts/agent-skills/issues/137).

## What Changes

- Reassess current direction, architecture, reusable patterns and related work at issue pickup using the existing assessment.
- Remove human UI approval from active instructions and preflight while retaining browser/accessibility validation, two independent review axes and CI.
- Recognize applicable standing installation authority without renewed human approval; preserve exact-plan review, ownership, compatibility, recovery and verified completion.
- Retain source-only exceptions as explicitly incomplete installation and distinguish source-stage preflight from final delivery.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `unified-dashboard`: remove human approval from candidate verification requirements.
- `runtime-install-contract`: recognize scoped standing authority in the existing exact-plan procedure and consumer instructions.
- `hub-runtime-upgrades`: align the Hub-specific root checkpoint with that standing authority.

## Impact

Active agent instructions, delivery documentation, installer procedure wording, preflight and focused fixtures. No product runtime, wire/schema, installer algorithm, new permission grant to downstream consumers, publication or physical-device behavior changes. Dated design snapshots and historical evidence remain intact. North Star drafting, host qualification, reviewer pilots and skill catalog cleanup are outside this change.
