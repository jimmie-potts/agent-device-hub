## Context

See proposal.md, "Why". The schema's criteria for a design apply: this change sets a data-model member that the dashboard (#922) and the inbox (#923) consume, and versions a shared family for the first time. ADR 0012's "Errors, effects and outcomes" sets the hold's semantics: an uncertain write is never retried, and a person or a later definitive outcome resolves it. #918's design (`openspec/changes/archive/2026-10-06-gh-918-device-families/design.md`) sets the record's other members. This document records the member's shape, the versioning and the Nanoleaf storage.

## Goals / Non-Goals

**Goals:**
- A consumer of `device` can tell a held device from one degraded for another reason, and find the operation to resolve.
- The change is additive: every record valid today stays valid, under the version it names.
- Nanoleaf sets and clears the member exactly where its hold begins and ends, across a restart too.

**Non-Goals:**
- No dashboard or inbox code (#922, #923).
- No release command: a person still releases a hold the way each module documents. For Nanoleaf that is an explicit mode command or a fresh control.
- No hold in LIFX, playback, Pixoo or Tidbyt, none of which holds a device today.

## Decisions

1. **`held: {requestId, heldAtMs}`, optional, present only while held.** `requestId` is required: every hold under ADR 0012 follows one operation's uncertain write, and naming it lets the tracker (#782) and the operation's one inbox item (#923) be found from the record. Its outcome is `uncertain` with `uncertain-result`. `heldAtMs` is when the hold began, an instant on the runtime's clock named by the profile's `<name>AtMs` rule. The member is absent when nothing holds the device. The module always knows its own hold, so absence means "not held", not "unknown"; this is unlike observations, where missing evidence is a tagged unknown.
   - Rejected: `{since, requestId?, kind}`, the issue's example. An optional request ID allows a hold that no tracker entry or inbox item can point at. `kind`, the command family, repeats what the tracker holds for that request, and `since` breaks the `<name>AtMs` rule.
   - Rejected: a guard entry, such as the generation at which writes stop, or a list of holds. A device has at most one hold, the record already carries its generation, and a guard says when the hold applies, not what a person resolves.
   - Rejected: a new `held` availability value. It changes a closed enum, which is not additive for `device/2.0` consumers, and it conflates reachability with the hold: a held device can also stop answering.
2. **The hold keeps the device out of `available`.** A module does not present a device while a hold stops its writes, so a held device is `degraded` while it answers, `unavailable` while it does not, or `unknown` before it has answered. The validator refuses a held record that is `available`, so a consumer that reads only `availability` never sees a held device as fully available. It also refuses a hold that begins after the envelope `time`, as for every other evidence time.
3. **How a hold clears.** The module drops `held` from its next record when it releases the hold: after a person's later command to the device, or when it learns the held operation's fate from a later definitive outcome. Each module's README names its release. No command releases a hold by itself, so a person releases one through a command to the device. An inbox action that releases a hold directly would need a release command family, which no story has asked for (hand-off to #923).
4. **A minor version beside `device/2.0`.** `device/2.1` is `device/2.0` plus `held`, in its own schema file, `device.2.1.schema.json`. A test keeps the 2.1 schema equal to 2.0's apart from `held`, its `$id` and its description, so the copy cannot drift. Both register through `registerDeviceFamilies` and appear in `deviceFamilies`, so every validator and module test kit accepts both. A `device/2.0` record that carries `held` is refused (`payload / additionalProperties held`). A producer chooses its version: Nanoleaf publishes 2.1; LIFX, playback, Pixoo, Tidbyt and the runtime's fixture devices keep 2.0. Consumers key on the family, as the SDK's sync already does.
   - Rejected: deriving 2.1 from 2.0 in code. A reader could no longer read the 2.1 schema in one file, and the equality test gives the same protection.
   - Rejected: moving every module to 2.1. They hold nothing, and a 2.0 record stays valid.
   - The package version stays 1.0.0 and the exact pins do not move. The package is a private source package that no separate repository consumes, and #918 added the device families without a version change.
5. **Nanoleaf records the held operation with the hold.** The port's hold stays `controller_hold_revision` in `meta`, which the recorded Python cases compare row for row. A new journal table, `control_holds`, keeps the device's held request ID and the hold's start in milliseconds. `hold` writes both in the caller's transaction, and `release` deletes both. A hold already in place at the same mode revision keeps its first operation. `holdOf` names the operation only while `held` is true, so a mode revision that moves past an old hold ends both. The worker and the runtime's restart recovery pass the runtime's clock into `hold`. The device record, its availability, the wall view and the hold's log records all read the same `holdOf`.

## Risks / Trade-offs

- [Two versions of one family in `deviceFamilies`] → a consumer that keys by family name sees `device` twice. The registry keys by `dataschema`, the gateway's readable families and the SDK's sync key by family name, and a test lists both entries.
- [`held` without its operation] → `hold` always records both in one transaction, so `held` and `holdOf` agree. A database written before this change could hold a hold with no recorded operation, but the module has never been installed (#840 installs it).
- [The issue's `kind` is not in the record] → a dashboard that wants the held command's family reads the tracker by `requestId`, as it does for any other operation.

## Migration Plan

No migration. Nothing installed publishes or consumes `device` records yet; the cutover (#840) starts the module with an empty journal. Rollback is a source revert.
