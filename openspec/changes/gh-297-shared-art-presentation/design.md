## Context

See proposal.md for the motivation and the linked issue for delivery scope. The current Art owner already retains compositions, stages through core-tracked commands, follows their outcomes and publishes candidates. Catalog reuse currently reports its own durable admission before staging finishes. The runtime automation owner already owns device followers, common starts and tracked dispatch, but its generic moment derivation uses one intent for every target. The widget currently chooses from recent catalog entries.

This design is required because the change crosses the Art owner, core automation, versioned messages and the browser, and adds private persistent references. ADR 0012 and the existing Art/device contracts remain authoritative.

## Goals / Non-Goals

Keep generation, preparation, selection and actual presentation distinct. Reuse the Art store, core tracker, SDK copies and device writers. The caller chooses the opportunity and supplies the timing; #684 will own durable schedule claims and arbitration. No new generic scheduler, public client dispatch route, palette-lighting implementation or source of personal data is introduced.

## Decisions

### Add explicit preparation and selection commands

Register `art-auto/2.1` beside 2.0 with closed `prepare` and `present` actions, retaining the 2.0 start alternative. Preparation names one artwork, its exact composition and the configured device ID. Art verifies that the composition belongs to that artwork and that its current display-owner copy resolves the same target ID before forwarding. A configuration change cannot redirect preparation to a different device. Selection names an existing browser composition. The core remains the only requester and sender, and Art validates ownership again. The gateway gains no general access to this core-only family.

Keep catalog `reuse` behavior unchanged. Overloading its admission outcome would change an existing owner's UI contract and still leave core automation with an owner-only command. Preparation instead remembers its admission and links a child stage before sending anything. Its successful outcome is emitted only when the matching child stage succeeds. A bounded private preparation record links the original request, stage and terminal result. On restart, pending dispatched work becomes uncertain, with no replay. Complete the row and outcome atomically through the existing outbox.

### Store one selected browser reference

Add an optional singleton selection record in the Art database. New state uses `art/2.1`, while validators retain both minor versions and all existing 2.0 schema files remain unchanged. The record names artwork and composition, with no new image bytes or prompt fields. Selection is committed with its outcome and the corresponding state update. Its artwork is retained through ordinary pruning; explicit deletion clears selection atomically. A failed change leaves the old reference intact.

The frontend follows this reference through the existing authenticated artwork content API, even beyond the recent catalog page. Its response adds the existing creation time so the same bounded artwork parser can validate both catalog and selected artwork metadata. Existing decoded-presentation state remains the only source of visible palette evidence. Gallery browsing remains local and cannot change authoritative selection as a side effect.

### Extend the existing automation owner

Add a focused art-plan controller under the existing automation owner, using its configured device identities and SDK followers. Keep the current generic rule path unchanged. A plan identifies one artwork, an optional browser selection and per-display composition/duration. Browser selection is sent at the common start, while each display is handed off as soon as its own preparation succeeds before the cutoff. No group barrier or late target moves that start. The owner uses tracked prepare operations and current staging evidence; a caller-provided preparation cutoff and common start prevent a slow target from shifting ready targets. Each target is dispatched independently when eligible. The existing committed operation state stream wakes bounded preparation waits; a direct tracker read closes the subscription/admission race. No Hub polling or new operation API is introduced. The caller receives each target's stable request identity and truthful admission result; later device completion remains its independent tracked operation.

Do not add Tidbyt to generic mode commands merely to discover it. Use the configured automation-device inventory and current owner records. Require affirmative art support, current state, available and unheld targets, and device-specific duration bounds. Send exact-art 2.1 only after those checks, and keep each module's final refusal authoritative. Strengthen the core tracker so a non-core requester cannot submit an art-bearing moment. Preserve the existing generic 2.0 request path.

### Keep replay and uncertainty explicit

The Art owner deduplicates prepare and present requests with its existing receipt pattern. The core tracker retains each target's operation independently. Requests and target IDs are stable within a plan; neither a lost reply nor a restarted owner creates another send. Preparation does not require provider credentials or modify spending. Selection success records a committed choice, not rendered pixels or device proof.

Before dispatch, the existing core automation store binds a plan ID to the digest
of its complete stable fields, including timing and every selected composition.
The additive `automation_art_plans` table retains only this identity receipt,
never executable plans. Like `core_operations`, these receipts have no eviction:
forgetting an ID would let changed timing borrow old preparation and revive a
missed opportunity. A conflicting ID or failed receipt commit sends nothing.
This is command identity, separate from #684's occurrence claims and arbitration.
Activity and deadlines are checked again after the synchronous permit callback.

## Risks / Trade-offs

- An admitted preparation can outlive its caller. Its tracked deadline and terminal evidence remain separate from the caller's cutoff; late success cannot revive an expired opportunity.
- Browser decoding is asynchronous. The existing selection identity and cancellation checks must apply to authoritative selections as well as local gallery choices.
- Device lifetimes and holds differ. Keep independent bounds, including Pixoo's 10-second maximum and the qualified Tronbyt 30–60-second hold, rather than stretching one duration across both.
- Additive storage retains new references. Test opening existing stores, selected-art pruning, deletion, restart uncertainty and duplicate handling. Recovery eligibility remains a separate installed assessment.

## Migration Plan

Add new tables with the existing idempotent Art store initialization, with no rewrite or deletion of retained data. Register both minor schemas and migrate the shipped producer, core consumers and frontend together. Source tests and the assembled disposable journey precede merge. #687 assesses the exact installed formats and performs the documented routine upgrade; this change does not authorize snapshot restoration or a new host.
