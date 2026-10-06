## Context

See proposal.md, "Why". The schema criteria for a design apply. This change sets a data model that every module consumes. It also fixes how 1.x data migrates at the cutover (#840). ADR 0012 sets the message kinds, the envelope and the blocks. This document records the payload-level decisions.

## Goals / Non-Goals

**Goals:**
- One closed schema per family, built from the blocks, with fixtures for every family and kind.
- No lifecycle evidence lost: attention, parent, turn, ordering and native identity.
- Title and project precedence kept.
- Removal, expiry and sync membership shown end to end with a reference consumer.

**Non-Goals:**
- No runtime publisher or SDK consumer. #830 and #831 own those; the reference consumer is test-only.
- No device-specific payloads. Modules define their own families.
- No inbox views, Hub mode overrides or tracker records. #782 and #695 own those and may extend these families with a minor version.

## Decisions

1. **One schema file per family, registered in a fixed order.** The session schema holds the agent definitions that the other agent families reference by URI: identity, parent, attention, notices, display text and the occurrence base. The alternative was a shared definitions file. The validator has no API for a schema that is not a payload family, and adding one would widen #828's surface.
2. **Cross-field rules are validator checks, not schema rules.** JSON Schema cannot compare two fields, and Ajv's `$data` extension is non-standard. `register(dataschema, schema, check?)` runs the check after the schema passes. A failure is `invalid-message` with a detail that names where it failed. `registerCoreFamilies` also binds each family to one kind and one type.
3. **A session's entity ID is the SHA-256 of its identity.** It is deterministic, so a hook, a consumer and the owner agree without a lookup. A recreated session reuses the ID, and `generation` tells the two records apart, as snapshot 1.1 does. The alternative, an ID the owner assigns, would need a lookup before a hook could name the subject.
4. **Lifecycle ordering names its source as the authority.** The ordering block requires an authority. Lifecycle sequences are meaningful only within their producing source, so the authority is `identity.sourceId`, and a check enforces it.
5. **Notices stay on the session record; the inbox item is separate.** 1.x notices are per-consumer, cleared by consumer policy and gone with the record. ADR 0012's inbox items stay until handled, with no expiry. Different meanings get different homes. The turn-ended inbox item names the notice by `noticeId`.
6. **Read context is derived, not published.** `observationAgeMs` and playback `ageMs` change every millisecond, so consumers compute them from `lastEvidenceAtMs` and `observedAtMs`. **For confirmation:** freshness and playback availability stay in the record, and the owner publishes a new revision when they flip. In 1.x a read computed them without a revision.
7. **Commands name no device.** `mode-set` and `moment-play` carry no device, controller or ticket fields; the envelope subject names the target. **For confirmation:** a moment's start is one wall-clock `startAtMs` on the runtime's clock instead of a per-device controller-monotonic start. Modules share the runtime's process and clock, so one instant serves every target. The 60 s lead limit and `toleranceMs` keep 1.x's missed-start rule.
8. **The receipt splits into a reply and an outcome.** Admission refusals become a reply with the error. Later results become an outcome. Merged codes keep the 1.x code in `detail`. **For confirmation:**
   - `priorEffects: possible` maps to evidence `none` with result `uncertain`. ADR 0012 reads `none` as "nothing reached the device".
   - `completedOperations` and `uncertainOperations` have no home in the closed outcome payload.
   - `request-order` maps to `revision-conflict`.
   - `moment-duplicate` maps to `invalid-state`.
9. **The `mode` family is the Hub selection, lowercase `work`, `free` or `quiet`.** Device-native modes stay in module families. Overrides belong to #695.
10. **The mood vocabulary narrows to kebab-case.** **For confirmation:** every mood declared today is kebab-case, and the blocks require kebab-case enum values.

## Risks / Trade-offs

- [Unconfirmed decisions 6, 7, 8 and 10 change a 1.x meaning] → each is marked in MAPPING.md and the coordinator's report. A change is a schema edit before any consumer exists.
- [Fields with no core home: `completedOperations`, `uncertainOperations`, `collector` and `lossCount`] → MAPPING.md records a disposition for each. The receipt fields stay with the module, or profile 2.1 adds them to the outcome. The health fields go to the runtime's module health.
- [The reference consumer keeps removal tombstones without a bound] → it exists only in tests. The SDK consumer (#830) owns the real bounded buffer and watermark.
- [Agent families depend on the session schema's definitions] → `coreFamilies` fixes the order, and a test registers them all.

## Migration Plan

No runtime migration happens here. The cutover (#840) migrates stored 1.x data with MAPPING.md's rules. Rollback is a source revert, because nothing consumes the families yet.
