## Context

See proposal.md. The installed hub exposes a selected-owner snapshot envelope; TidbytStatusPublisher already implements rendering, coalescing, stale indication, idle removal and queue submission. Design is required because this change introduces installation, credential handling and process lifetime coordination.

## Goals / Non-Goals

Goals: make the released libraries runnable against one existing hub and one configured cloud device. Keep the hub, hooks and controller databases private to their existing owners.

Non-goals: new shared APIs, new renderer policy, firmware changes, a second reducer, service auto-discovery, host migration or automatic installation during source validation.

## Decisions

- A small CLI in the Tidbyt package reads an owner-only JSON file naming the hub URL, expected owner, read-token file and Tidbyt credentials file. File descriptors use no-follow and size/owner/mode checks. Paths resolve outside Git checkouts; only paths appear in arguments. This avoids changing the hub's startup or exposing a new network surface.
- Poll the authenticated sessions endpoint through StatusFeed at the publisher's released 30-second cadence. No SSE adapter is needed for this personal installation. Snapshot decoding is bounded and uses the existing validator. The feed's 2.5-second deadline precedes the publisher's 3-second timeout. Wrong-owner responses become unavailable evidence rather than a silent source switch.
- Hold a SQLite exclusive transaction in a dedicated runner lease file under the Linux user's private state directory, keyed by a SHA-256 of the cloud device ID. This is a lock only, never a controller or shared-owner database. OS process death releases it without stale PID-file recovery. Different installation IDs for the same device still share a lease. This coordinates this runner on one host; the owner must stop any writer on another host.
- SIGINT/SIGTERM stop the publisher, close the controller to cancel queued work, await its current evaluation, then close the lease. Stop does not delete the status installation; this preserves the delivered publisher's stop semantics. A healthy idle feed removes it through the queue on a later run. No automatic fallback or replay follows failure.
- Install a pinned reviewed source revision outside the working checkout with Node 24 and its lockfile. A single owner-operated process is sufficient; persistent service enablement is a separate owner action. Keep runtime configuration, credentials and lease files outside that release tree.

## Risks / Trade-offs

- Polling can take up to 30 seconds to notice a state change, followed by the existing cadence gate. Hold each acceptance state long enough to observe it.
- Stopping leaves the last cloud installation present, and its expiry is unknown. Record that observation; remove it through the owning queue only with the selected cleanup authority.
- A local lease cannot fence a process on another host or an unrelated API client. The installation owner confirms the sole writer before physical work.
- Installed provider signals may not cover attention. Report actual client/version and missing coverage; synthetic lifecycle events cannot establish real-client acceptance.

## Migration Plan

No shared state migration. Build and review source, install the immutable revision, supply private configuration referencing the existing read credential and Tidbyt file, run the single owner process, then perform authorized visual acceptance. Rollback stops that process; the hub and hooks remain unchanged. Retain the pinned release and receipts outside Git.
