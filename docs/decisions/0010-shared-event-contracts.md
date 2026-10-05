# ADR 0010: Shared event profile with staged adoption

Status: superseded by [ADR 0012](0012-bunny-event-platform.md) on 2026-10-05.
It was accepted for source definition, with runtime adoption left to scoped work.

## Context

Existing components exchange provider observations, snapshots, commands and
receipts under different owning contracts. A shared envelope must retain their
identity, authority and evidence limits without requiring one language or runtime.

## Decision

Use the [B.U.N.N.Y. profile](../event-contract.md) of CloudEvents 1.0 structured
JSON, with typed versioned payloads and portable TypeScript/Python validation.
Preserve released contracts through explicit adapters and staged adoption.

Separate latest-state delivery, recoverable actionable notifications after
confirmed durable acceptance, and time-sensitive effects that cannot replay on
recovery. Keep complete history independent from notification delivery. Inspect
existing retained-notice recovery before selecting further infrastructure.

The profile selects no broker, event router, storage service, Effect dependency
or repository-wide migration. Native Hub SSE subscription work can proceed under
its current wire contract. Effect remains an optional bounded investigation.

## Alternatives and consequences

A custom envelope would duplicate a standard's context conventions. Replacing
all current formats at once would break closed schemas and qualified consumers.
A TypeScript runtime dependency as the contract would exclude Python consumers
and confuse in-process concurrency with durable delivery.

CloudEvents standardizes context but supplies neither authentication nor delivery
guarantees. The profile therefore keeps enforcement with the state owner,
authenticated services and designated controller queues. Source validators and
reference traces do not prove deployed adoption, upstream capture or physical
success. A new notification service is unnecessary until a concrete recovery gap
and its owner-selected policy justify it.
