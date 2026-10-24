## Context

See proposal.md. The module's existing useWispr hook owns numeric reads, cancellation and privacy retirement; the shell already gates Home placement. The accepted full analytics page is a separate consumer with richer filtering and text protections. Design is included because read-lifetime/privacy transitions cross the adapter/presentation boundary.

## Goals / Non-Goals

**Goals:** A pure reusable presentation accepts a bounded summary and explicit refresh callback. A module-owned projection preserves producer calendar dates and sample semantics.

**Non-Goals:** No new backend/schema, chart library, preferences, collection, analytics-page redesign or live activation.

## Decisions

- Keep acquisition in WisprWidget and expose WisprCard through the browser entry. A self-fetching generic card would couple presentation to private resources; duplicating the adapter in the analytics page would add unnecessary reads. Open Wispr retains that page intact.
- Project exactly seven dates ending at the producer's seven-day window. Match daily rows by date; missing rows remain null and split line segments. Speaking minutes require speech samples. An expired Today window uses its captured date with Stale. A current-day missing row stays unknown even when earlier days are available.
- Keep the original lastSuccessAt for age and freshness. Extend the existing hook with an explicit pending flag so repeated clicks are disabled while a read is pending. Existing abort and identity fences retire obsolete replies; access refusals clear retained reads. No retry or timer.
- Use semantic glass tokens, native buttons/anchors, a small status disclosure and an accessible table. Day selection is ephemeral, independent of full-page filters.
- Preserve ADR 0012/diagnostic behavior by leaving gateway reads and error codes unchanged. There are no effects or command outcomes; local loading and read failures are presentation only. No new analytics logs or trace capture.

## Risks / Trade-offs

- Stale captures can belong to yesterday → explicitly label the captured date and retain age.
- Zero and unknown differ → require a captured row for words and positive speechSamples for minutes.
- Privacy retirement during refresh → retain existing module/gateway tests and exercise actual browser refusal; do not introduce a second read owner.
- Home may be hidden/unconfigured → synthetic exposed-card evidence and installed nonactivation readback remain separate.

## Migration Plan

No store/configuration change. Existing widget IDs and layouts remain compatible. Deliver through normal PR/main checks and the current qualified established-runtime forward-update procedure. Keep Wispr unconfigured; activation belongs to #1035. Recovery selection or snapshot restore needs its owning procedure and authority; fix forward for UI defects.
