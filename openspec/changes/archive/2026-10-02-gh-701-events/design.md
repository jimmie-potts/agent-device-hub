## Context

See proposal.md for the scope and owning issue. Lifecycle/controller schemas are closed and released. The agent-state owner already persists notices and per-consumer acknowledgment in atomic commits; its snapshot feed is latest-state recovery. Notices also disappear on session retirement/expiry, and hooks are best-effort. These facilities do not establish a general durable actionable-notification guarantee.

## Goals / Non-Goals

**Goals:** define one additive, language-neutral profile with executable validation and reference decisions; identify concrete adoption boundaries and notification gaps.

**Non-Goals:** no runtime migration, broker, outbox, store, service, Effect dependency, device effect or notification policy selection. Reference traces describe planned enforcement, not delivered producers.

## Decisions

- Use CloudEvents 1.0 structured JSON, specification revision 1.0.2. Require `bunnyprofile` (string `1.0`), `dataschema` (immutable schema URI), and `datacontenttype` (`application/json`). Registry binds event type, payload version, source owner family and delivery class. Keep payloads closed. Existing native wires use explicit future adapters, never an envelope silently added to released schemas.
- Keep context attributes scalar and small. Qualified correlation/causation references and safe-integer revisions live inside `data`, not CloudEvents integer attributes (which have a signed 32-bit range). `source` is a bounded configured neutral URN. Producer credentials bind it at the adoption boundary; a string cannot authenticate ownership.
- Store explicit unknown occurrence time and ordering in payload metadata. Known order includes authority, epoch and sequence; observation and receipt times never establish occurrence or provider order. A producer-local record ID identifies that record only. Stable `(source,id)` is retry identity, not proof of native provider uniqueness.
- Register representative typed facts for lifecycle observation, committed current state/selection, independent controller outcome, durably accepted notice, and live-only effect availability. None authorizes a command. A schema-valid notice acceptance claims a commit; a future authenticated accepting owner must prove it. No general arbitrary payload or free-form content is admitted.
- Reuse JSON Schema 2020-12/Ajv and Python jsonschema. Match finite byte/depth/node bounds and reject non-JSON values before validation. Share exact fixtures and expected reference outputs. No generated runtime or new validation library.
- Reference decisions cover latest-snapshot replacement, duplicate retry identity, durable acceptance versus unconfirmed capture, expiry versus handled acknowledgment, and live-only effects. They are pure specification examples, not a queue, scheduler or persistence layer. Require later adoption tests at each owning boundary.

## Risks / Trade-offs

- A profile could imply delivery that no current service guarantees → label source definitions and traces, list enforcement owners, keep runtime compatibility/adoption separate.
- Neutral ID fields could still carry sensitive strings → schema allowlists reduce exposure; producer policy and authenticated source assignment remain required. Do not claim schema validation can detect secrets encoded in permitted identifiers.
- Different numeric/Unicode handling across runtimes → shared boundary fixtures and safe-integer payload counters; ASCII context profile avoids CloudEvents string ambiguity.
- Retained notices are mistaken for a notification service → document session removal, capacity, deduplication and acknowledgment gaps with unchosen refinement decisions.

## Migration Plan

Expand only: add profile artifacts and checks, preserving existing package artifacts and transport bytes. Each subsequent adoption must identify its producer and consumer changes, authorization, compatibility negotiation and failure tests. No existing consumer is switched. Rollback of this source-only addition requires no state conversion. Migrate/contract phases require separately selected work; no old format is removed here.
