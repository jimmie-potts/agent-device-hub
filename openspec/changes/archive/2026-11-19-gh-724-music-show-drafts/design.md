## Context

The measured show path already accepts qualified position and capture evidence, keeps a scoped item identity and replays saved cues deterministically. Claude selects a cue plan. The module checks it and publishes the tracked outcome. It does not give Claude any playback or device interface.

## Goals / Non-Goals

- Generate one bounded draft from either the current measured excerpt or an explicitly selected generic sequence.
- Use the approved field disclosure, separate Music limits and no automatic retry.
- Preserve the editor's current draft, saved versions and favorites through refusal, invalid output or cancellation.
- Existing device authority and installation practices continue to apply.

## Decisions

Use the authenticated dashboard command and result tracking path. After the owner records a terminal result, the dashboard reads an authenticated draft by request ID. An explicit read of the latest successful draft supports reload and reopen without another call. Only the save command creates a library version. Authored saves use nanoleaf-show-version/2.1 for provenance and existing manual versions stay on 2.0. A saved generated version uses the existing play route and requires no model access.

The owner binds a fresh Music title and artist to the approved request. Measured input uses the module's admitted derived spans, with no scoped identifiers, audio, device data or trace sent to Anthropic. Generic input has no analysis and receives generic elapsed-time labels. The measured output may only use covered span edges. The module validates all output through the existing show validator.

Use Claude Fable 5.2 through the Messages API, which retains prompts and completions for at least 30 days with policy exceptions. A workspace-scoped key must differ from every configured device token. The separate Music ledger admits at most one attempt per request and reserves against USD 20 monthly and USD 3 daily limits at the higher supported regional rate. Reported usage and inference geography settle the estimated spend, and the ledger retains uncertain exposure if a call may have reached the provider.

The module uses registry codes and tracked outcomes under ADR 0012. Invalid inputs refuse before the provider. Invalid output fails generation and retains any recorded spend. Cancellation aborts local waiting and cannot undo a sent call. The tracker remains live through the local cancellation deadline. Inbox history cannot launch another paid attempt. A transient storage failure retries the terminal transaction without another provider call. Accepted jobs are never replayed after restart.

## Risks / Trade-offs

Partial measurements support an excerpt only. The draft labels this coverage and allows a clearly labeled generic sequence when the operator chooses one. Only supported declarative effects enter the editor. A pricing or provider change requires updating the bounded reservation and disclosure together.
