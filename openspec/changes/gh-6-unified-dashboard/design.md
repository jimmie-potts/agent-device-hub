## Context

See proposal.md. The delivered Linux hub authenticates bearer credentials and enforces same-origin Host/Origin/Fetch-Metadata checks. Controller clients already serialize each device independently. The new UI consumes those services; it creates no state owner or device writer. A design is required because this introduces a frontend pattern, dependencies, browser authentication and concurrent state.

## Goals / Non-Goals

Keep browser intent separate from remote observations, and retain each owning API's exact contracts. Do not copy the wall editor or add a generic raw-command UI. Installation, live sessions and device acceptance remain outside this source delivery.

## Decisions

- Serve a bundled React/TypeScript application on the hub origin. Separate-origin hosting would require a new CORS/authentication boundary and is unnecessary for this local release.
- Use an explicitly provisioned hub browser credential held in memory. Native controller credentials remain private; no query-string, local-storage or embedded credential. Expose the principal's permitted component aliases, control permission and configured consumers in an authenticated dashboard context. Do not expose arbitrary controller endpoints.
- Keep a small component registry with common navigation/status/settings and typed Nanoleaf/Pixoo views. Unknown components render read-only unavailable controls. New production components need their own contract and integration work.
- Read snapshots sequentially per controller and concurrently across controllers. Use bounded SSE reconnect plus periodic snapshot refresh, with request-generation guards and elapsed observation ages. Reconnect never reissues writes.
- Pin draft intent to the revision and request ticket observed when editing begins. Preserve drafts and focus across refreshes; show conflicts and uncertain outcomes without silently replacing tickets or retrying writes. Monitor labels/acknowledgment use the existing owner commands and server-issued IDs.
- Reuse the Nanoleaf approved dark HUD palette and selection/pending patterns from merged revision ec133b8519f41a7f57e0c4b9830d7c38d5173355. Use semantic HTML controls instead of copying its wall-specific SVG.
- Advanced editor URLs are operator configuration, validated as credential-free numeric-loopback HTTP links without query or fragment. They are links only, never proxy destinations.

## Risks / Trade-offs

- Stale or failed snapshots can mislead users. Retain the last evidence, mark it stale, grow its age and disable writes until current authority is available.
- An accepted HTTP command does not prove physical output. Display receipt and configuration outcomes separately from last successful transmission and unknown optical results.
- A bearer credential in a browser is sensitive. Use memory only, restrictive CSP, no third-party assets, no credential logs, explicit disconnect and existing server revocation.
- Rapid feed updates can starve refreshes or destroy drafts. Coalesce refresh work and keep React keys, selection and draft state independent of snapshot replacement.

## Migration Plan

Build and package static assets with the hub; existing API-only configurations continue to work. Document explicit browser credential provisioning and optional validated editor links. This delivery neither installs nor starts a personal service. Rollback restores the previous source package; no stored-state migration is introduced.
