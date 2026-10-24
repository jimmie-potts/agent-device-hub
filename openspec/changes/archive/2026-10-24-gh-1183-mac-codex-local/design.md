## Context

The owner approved a shared local Mac Codex feed, one private ingest credential,
hook setup, controlled activation and source publication. Installed hook schemas
do not distinguish Desktop from CLI. Local hooks do not cover cloud orchestration
even when its tools execute locally. The existing core and lifecycle SDK remain
the authoritative ingestion and storage path under ADR 0012.

## Goals / Non-Goals

Connect supported local Desktop and CLI root lifecycle observations to the
existing localhost dashboard, preserving core records and notify. Do not collect
prompt/reply content, paths or transcripts, infer subagent/approval/read coverage,
enable devices, add remote ingress or migrate history.

## Decisions

Use `provider: codex, client: local` and the existing host/source/session selector.
Existing cli/desktop/code identities remain separate. Local does not inherit
Desktop-only metadata or read evidence. Extend current consumers additively;
leave retained legacy transports outside this installed path.

The native wrapper accepts only SessionStart (excluding compact),
UserPromptSubmit, Stop, Interrupt and SessionEnd. An own agent_id property drops
the whole input. Only hook name, session_id and optional turn_id reach the existing
normalizer. Codex can supply text on stdin transiently; it is discarded, never
logged, saved, forwarded or used to open a path. A metadata-only option checks
producer configuration before consuming stdin and refuses lifecycle enrichment.

Use the existing source-derived credential ID and SDK grant. An explicit
BUNNY_INGEST_SOURCE opts the host-local profile into exactly one matching
ingest-only credential without role/robot grants. Absent selection still requires
an empty credential list. Browser sessions, Host/Origin checks, disabled modules,
effective loopback publication and private mounts remain unchanged.

Mac owns the private activation and tracker; PC integrates/publishes source.
Frozen source tests and independent review precede bearer creation and hook
activation. Preserve the prior image, selected Compose and core data, take a
stopped backup before runtime replacement, and update only this selected profile.
The producer uses the existing 2.9-second fail-open budget without retries or
agent-facing output. An unavailable hub may lose observations; absence is not
proof of completion or disconnection.

## Risks / Trade-offs

Shared local identity cannot identify which UI emitted an event. Missing turn IDs
and unknown ordering retain uncertainty. Hooks receive raw private fields before
filtering. A stolen ingest bearer can inject false lifecycle events but has no
read, control or administration grant. Private native storage and a hub-side
digest limit exposure; no secret enters GitHub or retained evidence.

## Validation and Recovery

Check shared JS/Python fixtures, state restart and snapshot compatibility,
consumer types, sanitizer privacy/child controls and exact credential admission.
Then qualify actual Desktop and CLI events independently on Mac, preserve notify,
verify the rendered feed and negative authorization, and repeat manual
stop/backup/start health. Recovery selection or snapshot restore is separate;
preserve latest state and prefer fixing forward without data replacement.
