## Context

The supervisor forks both entry points with an IPC channel and preloads the same network guard. It currently obtains the child's HOME from a process-environment file after readiness. The existing private-state check consumes that observed path alongside open database locations, default-state existence and credential-file mode. See proposal.md for the authority conflict.

## Goals / Non-Goals

Preserve actual-child evidence, including for the shipped entry, without reading another process's environment. Keep the same private boundary report. No general process inspector, environment serialization, diagnostic record, installed behavior, network guard or cleanup policy changes.

## Decisions

- The guard sends one `runtime.home` IPC report only from its main thread with an IPC channel. It selects HOME directly and never constructs an environment object. The payload contains only its discriminator and one absolute, normalized HOME string of at most 4096 UTF-8 bytes, without NUL or line breaks; an unusable value becomes missing evidence.
- A small observer binds evidence to the exact child object and generation. Every spawn resets it. The supervisor consumes HOME messages separately from device simulation messages, validates exact keys, and ignores old children or generations. Malformed reports cannot establish a path; an outside-run path remains visible to the existing boundary check and fails it.
- IPC and stdout have separate delivery order. After the runtime's ready line, wait at most one second for that generation's HOME report. A malformed report ends the wait with missing evidence; timeout does too. Neither creates an inferred path or passes a boundary. This is a bounded startup observation, with no resend.
- Install disconnect handling before sending the report. A synchronous send error or failed callback takes the same silent, bounded stop path as a disconnected supervisor, without publishing exception text or resending.
- Preserve the existing open-file check and process identity/cleanup. Assigning the parent's intended home at spawn was rejected because it proves configuration intent, not the child's observation.

## Risks / Trade-offs

- A missing or late report fails verification even if HOME was configured correctly. The bounded wait admits normal IPC ordering while preserving a failed check when evidence is absent.
- The source regression catches reintroduced process-environment file paths without executing them. Protocol checks prove exact shape, bounds and child/generation binding; real repaired fixture/shipped runs prove integration. This is not a general static security analyzer.
- A child controls its own IPC channel; this preserves the existing trusted candidate model, not protection against a malicious runtime. No new actor receives private evidence.

## Migration Plan

Source-only tooling. Build the repaired candidate before any supervisor run. Rebase dependent delivery branches onto the merged repair and rerun their interrupted or deferred verification; no installed target changes.
