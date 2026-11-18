## Context

Audio already has per-light revision, control status, tracked outcomes and Stop. The Nanoleaf module publishes immutable version metadata to authenticated readers.

## Decisions

Follow the catalog with the dashboard participant already used by Audio. Reuse the show's existing catalog follower and the light's existing Start attempt so overlapping live and saved requests share its lock. The version selection remains explicit, and the browser sends only its identity. The core retains revision and generation checks. The Nanoleaf worker retains layout, Free mode, power, alert and writer admission.

## Faults

A stale catalog disables Start. The core or worker may still refuse a fresh selection if state changes. The existing tracker carries admission, expiry, uncertainty, evidence and trace context. The dashboard never retries a command. The selected version stays visible when a newer one is published.

## Migration

This uses the existing wire contract and stored versions. It needs no data migration or new grants.
