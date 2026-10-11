## Context

See proposal.md for motivation. The controls module already has a leased SQLite database, private files, serialized command queue, five-second ADB operations, SDK state/outbox and content/MCP contributions. The accepted qualification contract supplies the native reader boundary. Significant persistent-data, privacy and scheduling changes require this design under the schema.

## Goals / Non-Goals

**Goals:** Keep the existing ONN owner authoritative; retain selected originals before publishing history state; keep control outcomes independent of collection; make reads bounded even as private history grows indefinitely.

**Non-Goals:** Separate collectors/databases, protocol providers, helper repair, account imports, inferred watching/identity, aggregate watched time or new shared SDK contracts. Refer to the proposal for the owner-selected feature deferrals.

## Decisions

- **Reader artifact:** Package fixed Java source, a small Dex and source/artifact hashes in the owning module. An offline/pinned D8 build and JDK synthetic tests check the artifact. Polling checks the one fixed owned device path/hash and invokes it with a dedicated result descriptor; unrelated startup output is discarded. Runtime compilation or automatic deployment would expand device effects and startup dependencies, so setup remains separately approved.
- **Wire intake:** A TypeScript validator admits only `onn-metadata/2.0`, the two apps, fixed nullable fields, declared omissions and qualified numeric/UTF-8 bounds. Narrow credential exclusion runs before persistence, with the same declared syntax and limits as the reader. Invalid replies produce safe unavailable evidence without retaining raw failure output.
- **Scheduling:** Extend the existing poll path; each cycle obtains one device-operation slot. Controls retire a pending/in-flight read before starting their own operation; a busy poll records a gap. The five-second operation deadline covers artifact checks, source reads and exit together. Metadata failure does not erase current-app reachability or force controls to fail.
- **Storage:** Add immutable intake/session/gap tables to the existing database lease and retain every accepted selected projection. Idempotent intake IDs and atomic original/projection writes distinguish durable acceptance from delivery. Occurrence identity is conservative: supported stable IDs can group continuous observations; absent identity stays unsupported and never joins items solely because titles match. Empty/source/clock/restart gaps retire continuity. Current state is a derived record, not a replacement for originals.
- **Bounded query service:** Both content and MCP call one stored-data service. A cursor binds filters, a maximum evidence sequence and deterministic ordering. Indexed app/evidence-sequence access scans at most 500 candidates per call; date/title filtering cannot issue an unbounded archive scan. Evidence order and cutoff remain stable through host-clock jumps; received time is an explicit date filter. Occurrence revisions at the cutoff preserve page stability. Detail observations are paged too. Field projection and serialized-response bounds report omissions without changing the stored original. Read tools expose no device/helper/path override.
- **State and consumers:** Add a module-owned history state family with collection status, current selected sessions, last accepted evidence and gaps. Keep existing device/ONN-control families intact. #1041 consumes these interfaces; shared dashboard registration remains automatic.

## Risks / Trade-offs

- Missing source IDs and same-title content can remain ambiguous → retain originals and explicit unsupported identity, preferring separate records to a false join.
- Polling can miss transitions between samples → expose collection start, finite cadence and gaps; never infer watched time or exact playback start/end.
- YouTube ads can report the selected video's title → label YouTube as selected-title observations and preserve source progress without main/ad classification.
- Credentials can occur in arbitrary prose → redact the declared recognized syntax and document detection limits; preserve ordinary text and explicit omissions, with no claim of universal secret detection.
- Slow reads, disk pressure or a growing archive can affect controls → cancellation, one bounded device slot, atomic storage failures, indexed bounded windows and explicit loss; no retries or deletion of older originals.

## Migration Plan

Create additive tables when the existing owner opens its database; old control-only configuration defaults collection off. Source delivery performs no installed migration or device action. After reviewed protected merges and main CI, #1044 uses the current qualified runtime upgrade procedure, an exact private configuration/artifact deployment plan and one separately approved consolidated acceptance session. Recovery preserves latest private state and earlier originals under that procedure; no reader/command replay occurs.
