## Context

See proposal.md for the owner-approved outcome and #390 for source-only acceptance. Initial discovery used main `27103712e796e53a9917da670b135000d6d74341`. The delivery was rebased onto `d5cbc7a0aa5f559db833f2a9ecf7b211b05eab06` and then `b722ed86d43a4e4383644d9e5d3dd2a9c35bb0b4` before final review. The first update changed SDK literals/CI and verification policy; the second added opted-in speech and shell connection facilities. Renew affected validation and keep this passive card independent of speech endpoints, without changing its scope. The module already provides validated status sync and bounded status/runs/run/samples reads. The shared Home catalog selects generic device records by owner and instance; saved layouts use those identities. ONN supplies the existing module-card composition pattern.

This design is required by the schema because module presentation and dashboard composition share source timing, cleanup and failure behavior.

## Goals / Non-Goals

**Goals:** One pure presentation component, one module-owned read adapter, and reuse in the current Home editor and module page. Preserve full prior evidence and all recorded measurements.

**Non-Goals:** New cleaning commands, room estimates (#377), event/moment integration (#391), maps, collection, storage format/ownership changes, dependency updates or live installation. The Roborock app remains the cleaning control surface.

## Decisions

- Keep the current per-device Home IDs and use the existing Home catalog extension rather than adding a second placement registry. Register the card's source/size metadata in the existing widget catalog without creating a duplicate default placement. A missing module source remains selectable through an explicit unavailable module placeholder. Preserve saved source identities and never infer an alternate robot.
- Extract the existing status hook and read helpers into browser-only module code. Page and card share one status copy per mount. A pure card accepts a typed display model; its adapter validates existing messages/documents and binds one expected target on Home. It exposes no command callback. A second participant or direct device/store reader would violate existing ownership.
- Read the run with the greatest reported start time through the fixed `latest-run` reference, on entry, explicit reload or an actual status revision change. Cancel/ignore superseded reads. No timer requests content. The local display clock only expires retained timestamps. Existing full history still uses its insertion-ordered bounded pages unchanged. Inspection showed that `listRuns` sorts by archive sequence, so its first entry can be an older reconciled run. The new projection returns at most one validated `roborock-runs/2.0` record and refuses all query keys. The store already enforces `startAtMs === recordId * 1000`; selecting the greatest indexed record ID therefore selects the greatest reported start without a schema/index migration or a scan of all history in the browser.
- Use a 120-second maximum status age, two normal idle collection periods. Missing/future observation times remain unknown; disconnected copies are stale. Care has its own timestamp and age. Only fresh cleaning shows active counters. Completion requires `complete=1`; cleaned area never falls back to reported area. A robot timestamp is labelled as robot time with clock qualification available.
- Keep the prior observations/history behind a closed Evidence disclosure, mounted on explicit opening with the same status copy. Add `#/module/roborock/history` for the footer and reuse the existing History component. Old status bookmarks remain valid.
- Use shell semantic glass tokens and module-scoped material artwork. Fixed tab-plane height and reduced-motion CSS preserve layout. Warning disclosures expose safe codes, evidence age and app guidance rather than permanent paragraphs or a card-wide warning.
- Existing authenticated API/SDK ownership, refusal codes, cancellation, deadlines and host trace/diagnostic decision points remain unchanged under ADR 0012 and the diagnostic contract. The browser displays fixed context and registered codes only, adds no logging/export surface and never catches-and-logs forwarded errors. There are no command admission, effects, retry or outcome states in this component.

## Risks / Trade-offs

- A retained run can change while current status stays healthy → bind reads to the actual status revision and ignore obsolete completions; mark unavailable reads rather than inventing empty history.
- The status stream can be live with old care/status evidence → age each timestamp independently and preserve last-observed labels.
- A vendor clock cannot establish reliable local run time → label robot time and retain unqualified context; add no relative today/yesterday claims.
- Existing detailed-page tests must follow the new disclosure → preserve their assertions and open Evidence before exercising them. New tests cover the quiet default page separately.

## Migration Plan

This source change adds no stored data or configuration migration. Preserve saved Home IDs and prior status bookmarks. Deliver through a PR with exact-head independent Standards, Specification and Acceptance reviews and required CI. The selected issue ends at source delivery; installed and physical evidence remain separate. A source revert restores the prior presentation without touching private state.
