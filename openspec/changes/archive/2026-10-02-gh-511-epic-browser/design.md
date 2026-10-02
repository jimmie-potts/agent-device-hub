## Context

See proposal.md and the approved epic-guide definitions. The legacy topic Guide has a separate generator and remains usable. The Project is currently private; public collection must not read its contents. Design is required by the schema because this change combines collection, release binding and browser performance/privacy behavior.

## Goals / Non-Goals

Build one static candidate and one shared DOM renderer. No model, write endpoint, scheduler, device writer or production cutover is added.

## Decisions

Use authenticated gh only in the local collector; the browser receives sanitized canonical facts. REST collection records every page and independently reconciles open issue numbers with GraphQL or a complete Search inventory below its API cap. Resolve required native relationships recursively, leaving unnecessary child/dependency collections on closed references explicitly unknown, then reread source facts and inventory to detect a changed collection attempt. Failed required reads abort the whole attempt. Optional seven-day failures retain observed items and explicit incomplete receipts.

Keep approved offline references immutable. Production Node validation/resolution modules port their algorithms and import the approved schemas/catalog; conformance tests compare them with the references. Existing Python fence-aware story and recommendation parsers supply normalized metadata in a bounded batch.

Generate ordinary views and their resolved page models once. The browser consumes records and resolved view configuration without fetching GitHub or parsing bodies. It pins all required bytes before navigation; URL query parameters select canonical pages and filter state. Bounded DOM rendering and Show more keep large epics compact while full records remain searchable.

Write content-addressed release directories and replace a small entry page only after complete validation. The entry binds a release manifest and loads hash-verified records, catalog, page models and renderer bytes. Existing clients retain all validated bytes in memory and check only for a newer release. This avoids multi-release navigation races. The manifest carries generator provenance; release build time does not change content identity.

Publish only records from verified public repositories, with credential screening before artifact generation. Keep inference projection disabled until the protected query consumer provides its approved policy. No private Project or session metadata enters the candidate. #540 can provide an explicitly permitted complete public/cached snapshot; otherwise values stay unknown. No inference is called.

## Risks / Trade-offs

- Concurrent issue changes → fail the whole attempt on inconsistent rereads; retain last good data.
- REST rate limits → bounded concurrency and diagnostics; no fabricated empty relationships.
- Many page models → content-addressed assets and bounded initial DOM; test the largest realistic epic.
- A static snapshot ages → show source dates and dataset asOf; readiness is qualified against that snapshot, never live permission to start.
- Duplicate production/reference algorithms → explicit fixture conformance tests; the approved bundle stays unchanged.

## Migration Plan

Generate the new candidate under docs/work-guide/outputs/epic-browser alongside the legacy output. Publication, hosted checks and cutover remain #317, #654 and #656. Failure preserves the previous entry and release. An already-open browser retains its complete release in memory and offers reload after a newer deployment.
