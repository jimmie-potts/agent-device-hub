## Context

See proposal.md for the outcome. Hub already emits observability 1.1 canonical records to stderr; `validateRecord` supplies strict schema/catalog validation. The existing Hub installer owns runtime plan, compatibility, switch, health and recovery. Dotfiles #9 now owns the one cross-repository execution supervisor. The prior Hub-only qualification is implementation evidence, not installed acceptance. ADR 0011 supersedes the earlier planner-proposed evidence expiry.

This design is required by the schema because it crosses process ownership, public mutations, privacy and recovery boundaries.

## Goals / Non-Goals

Goals: a small TypeScript intake command, exact issue handoff, inspectable private recovery state, fixed publication operations and a local factual report.

Non-goals: another scheduler or delivery engine, new diagnostic schemas/exporters, a custom GitHub review service, a database/archive platform, consumer updaters or physical-device commands.

## Decisions

1. **Reuse the serial host owner.** The supervisor invokes one trusted, fingerprinted intake command while holding its global delivery claim. Stdin names operation (`intake` or `reconcile`), run ID, deadline, authority and private evidence directory. Stdout returns complete/blocked/uncertain plus exact authorized selections. A second Hub timer would create competing ownership and is removed from this design. The supervisor owns delivery/review/merge/install effects after admission.
2. **Bound stream processing.** Query configured user units with journalctl JSON, `--all`, explicit fields and UTC bounds. Bound lines before parsing, then messages at the released 8 KiB contract. Accept only selected unit/time records. Preserve query gaps, rejected counts and incomplete subprocess outcomes. No source completeness or optical claim follows from service logs.
3. **Separate evidence from publication.** Preserve accepted original messages, journal provenance and planner returns in owner-only files. Give the planning worker only a sanitized finding projection and current repository context. Public issue content excludes private record IDs, cursors, local paths and raw logs. Retention is explicit; capacity limits refuse new work rather than evicting history.
4. **Use installed planning and repository policy.** A bounded subscription-backed Codex investigation follows plan-work in proposal-only mode, with existing issue/source reads and no implementation. Fixed code validates the returned shape, allowed repository, source references and publication representation. Logs cannot provide instructions, command arguments, authority IDs or arbitrary targets. Expected incidents and unsupported performance/general-improvement proposals are deferred.
5. **Record intent before effects.** Each finding has a stable fingerprint from registered service/scope/event/operation/outcome/reason dimensions. Persist a publication marker and intent before creation. Read all relevant GitHub pages and reuse existing matched work. After uncertainty, reconcile exact markers; unavailable or conflicting results block replay. Queue deduplication belongs to #9 and preserves its parked/completed states.
6. **Keep adapters concrete.** GitHub calls use fixed REST operations and structured JSON. Command execution uses argument arrays, trusted configured executables and bounded output/time. No command is assembled from model or telemetry text. The installed worker, permission profile, rules and hooks remain intact; denied operations are reported.
7. **Test at the responsible boundary.** Intake tests cover validation, source selection, deduplication, uncertain writes, privacy and the supervisor protocol with deterministic adapters. The shared runner tests own review/CI, guarded merge, installation and process claims. One disposable integration scenario joins those boundaries before final acceptance; #734 still requires the real installed scheduled delivery.

8. **Keep owning closeout semantic.** Validate the complete published installation receipt and exact selected issue/merge before a separate bounded plan-work assessment of current public acceptance and related records. The worker acceptance classifier cannot discharge omitted client or physical criteria. Reuse the canonical recommendation parser/upsert, preserve criterion-specific pending obligations and bind effects to current body/comment/relationship snapshots. Fixed effects may refresh advice, remove a satisfied sole dependency hold, close the selected issue and set its existing Project status; unsupported semantic changes remain pending. Durable intent and read-only reconciliation prevent replay; installed evidence survives a tracker gap. No parent outcome follows from child count. A source-only exception requires an exact reviewed-body reason and linked installation issue, independently confirmed before source closure; its receipt and public comment keep overall installation pending.
9. **Recover without renewing work.** An expired existing intake run can use a separate bounded read-only reconciliation interval under the retained supervisor claim. Its original identity/deadline remains unchanged; unknown runs and new query, planning or mutation are refused.

10. **Wrap the existing Hub installer.** A fixed owner/configuration adapter runs native plan first, records digest-bound intent, and forwards upgrade to the existing operation engine. A native 600-second reserve check runs before operation entry and after staging before durable mutation intent; admitted switch/recovery is never killed by a wrapper timeout. Lost responses require private intent plus authoritative native receipt/current process/read-only health under the existing native lock. Active machinery changes and unqualified migration wait for their owning stopped boundary. Terminal refusal/recovery settles only with fresh healthy baseline and clear barriers.

## Risks / Trade-offs

- Journald retention and diagnostics enablement may leave gaps → report coverage as partial/unavailable and qualify actual query access in #734.
- A model can return an unsupported proposal → validate its structured result, bind source evidence and refuse uncertain or unsafe publication; the delivery workflow repeats issue freshness before implementation.
- External writes may succeed despite a timeout → durable intent and authoritative lookup prevent blind retries.
- Manual clients outside the adopted claim protocol remain outside its exclusion guarantee → activation must qualify participating entrypoints; never claim universal same-user fencing.
- Exact host controls are not established by source tests → retain #734's role/permission evidence and no-interactive-input acceptance.

## Migration Plan

No existing source or runtime data is migrated. Merge reviewed source and package the intake with its exact dependency closure. Install the pinned command and private configuration as the existing supervisor's intake adapter under #734. Verify hashes, retained permissions, effective controls and a bounded query before enabling that adapter. Disable admission through the supervisor; reconcile in-flight issue effects before replacement. Preserve private evidence across uninstall or rollback. Routine deployment of product fixes continues through each repository's installer and verified receipt.
