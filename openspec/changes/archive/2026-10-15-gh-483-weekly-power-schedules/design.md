## Context

See proposal.md for motivation and the delta specs for externally visible behavior. The current core AutomationPart composes AutomationStore with event-to-moment arbitration and the tracked dispatcher. AutomationStore already reserves routine rows, while the current event parser refuses them. The runtime host knows configured/admitted device identities; AutomationPart currently follows only mode participants, which cannot be used as the generic scheduling registry. The gateway already owns authenticated automation routes, and the React Automation page owns their management.

## Goals / Non-Goals

**Goals:** Deliver the minimum shared weekly-power path and editor with fake-target evidence under #483; preserve event rules, one core state owner, per-device admission and current tracking.

**Non-Goals:** Do not implement Wemo transport, native maximum-on rules, arbitrary ordered routines, presets, moments, MCP scheduling, new hosts, clock settings or any physical activation in this slice. No new scheduler service, broker, calendar language or timing library.

## Decisions

1. Compose a bounded power-routine executor with the existing core AutomationPart and private AutomationStore. Use the existing routine reservation and typed power-window definitions; event arbitration reads only validated event rows. Keep a clear boundary for later #359 actions without building their general executor now. A Wemo module scheduler/store would contradict the owner's reusable Hub decision; a new standalone service is unnecessary.
2. Management extends the existing authenticated automation namespace at /api/v2/automation/power-schedules and the shared page. Power-schedule inputs carry name, target, days (0 through 6), onTime/offTime (HH:MM) and an optional enabled field on creation; stored definitions also carry id and change identity. Keep this validator distinct from event-to-moment input. Existing event-rule endpoints retain their reserved routine rejection; stored power windows use routine rows with a versioned power-window discriminator, and the event reader excludes those rows. A device page may link to the shared editor and never creates a second store.
3. Supply configured/admitted device identities from the runtime host separately from the narrow Nanoleaf/Pixoo mode table. Use SDK-synced owner records for current capability, availability and command guards. Schedule power through CoreHandle.dispatch; do not read controller databases, poll the Hub for device state or import module implementations.
4. Use host-local weekday/time selection and one bounded timer for the next due boundary. Each saved schedule gets monotonic definition identity so edits, deletion or disable invalidate callbacks and pending reads. Mark a boundary before dispatch under the owning store lease, then send once; no automatic retry, catch-up or restoration. Recompute only future boundaries after startup. Admit a normal callback only within 60 seconds of its planned boundary; a later callback is dropped and future occurrences are recomputed. Recheck the definition/owner and the remaining boundary window after each asynchronous device read. Suspended/downtime boundaries do not create history reconstruction.
5. Keep schedule rows and minimal occurrence guards in the existing core-owned store and preserve event settings/logs. Use current tracking/inbox/history for command results, and distinguish admission from terminal/observed evidence in the UI. No new message envelope or error registry. Decision-point diagnostics follow ADR 0012 and the existing diagnostic vocabulary, with trace continuity into dispatched power requests and no private schedule/configuration text in outward errors.

## Risks / Trade-offs

- Hub sleep, outage or lost device path prevents scheduled switching: display that operating limit; never describe this scheduler as the plug's independent maximum-on protection.
- New routine state may be unreadable by an older event-only runtime: installation remains gated on actual release/state compatibility and recovery qualification, including preserving new definitions/guards. Source tests do not authorize a migration or qualify an older recovery release.
- Editing during an asynchronous device read can dispatch obsolete intent: compare the saved definition identity and enabled state again immediately before durable claim and dispatch.
- Timezone/DST framework expansion would exceed #359's accepted scope: use native host-local clock behavior and no custom zone conversion or matrix.

## Migration Plan

Source stays on the isolated #483 branch with no installed configuration edits. Define, test and document the routine/store format and actual release admission implications before first product write. Preserve existing event rows/settings/logs and verify reopening with new schedule rows. Before merge, synchronize/archive the completed shared slice only, obtain independent Standards/Specification/Acceptance reviews of the committed comparison and applicable CI. #483 remains open for Wemo and maximum-on qualification. Before any installed activation, read apps/runtime/UPGRADE.md and prove candidate/recovery compatibility with the installation's actual configured owners and new schedule state. Do not use the old Hub installer.
