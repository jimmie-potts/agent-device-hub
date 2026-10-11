## Context

See proposal.md for the observed failure. The playback module receives a private thumbnail URL from the configured Sony source, then independently validates it before fetching. The existing requirement uses HTTP origin equality; origin includes the port. The owner approved the receiver's verified port 58080 after the live probe returned a valid image from that same IP.

This design is required by the schema's security criterion: the fetch allowlist changes. There is no wire format, state migration or ownership change.

## Goals / Non-Goals

**Goals:** admit this verified Sony service while retaining a finite network boundary and all existing acquisition limits.

**Non-Goals:** arbitrary same-host ports, other hosts, receiver discovery, redirects, Sonos artwork, configurable network grants, or display policy changes.

## Decisions

Admit the existing configured origin and HTTP port 58080 only when the candidate's host equals the already-validated configured receiver IPv4 address. Keep credentials, fragments, whitespace/control characters and relative URLs refused. Both candidate preparation and the fetch boundary use the same validator, so fetch cannot bypass admission.

An arbitrary-port same-host rule would needlessly expand the fetch surface. A new artwork-origin setting would add configuration and upgrade work for a single qualified receiver service. Rewriting the thumbnail port to the API port would request a different resource. The bounded additional port matches the owner's selected setup without any of those changes.

## Risks / Trade-offs

- Another HTTP service on the selected receiver port could be fetched if advertised by that receiver. The owner accepted this narrow expansion; host binding, no redirects/credentials, byte/pixel limits and deadlines remain enforced.
- A different device's artwork service may use another port. It remains refused until separately qualified and selected; this change makes no general Sony-port compatibility claim.
- A track can change during acquisition. Existing generation/candidate association and late-result guards remain unchanged and retain their regression coverage.

## Migration Plan

No configuration or state migration is needed. After source review and CI, use the qualified current-runtime upgrade procedure and verify the selected build and health. The epic's authorized camera trial checks actual current artwork, transition, fallback and restoration. A normal qualified recovery to the retained baseline restores the original validator if required; no decoder bypass or direct display writer is introduced.
