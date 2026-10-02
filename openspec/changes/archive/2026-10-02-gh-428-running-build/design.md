## Context

`package-hub.mjs` already ships a versioned manifest. `startHub` owns both read endpoints; Connections receives `Context` through the existing authenticated client. See proposal.md for the issue and pinned contract. A design is included because packaging, server startup and browser state share this identity.

## Goals / Non-Goals

Load an allowlisted identity relative to the executing module and capture it before the listener starts. Preserve all existing health and permission decisions. This does not verify an installed archive's trust chain, adopt instrumentation or change live paths; the installer owns trusted archive verification.

## Decisions

- A small package-stamping helper checks repository identity, full HEAD and tracked/untracked dirt before staging and again before writing the manifest. Unknown or changed source produces `unknown`. Looking up Git at runtime would describe a checkout rather than the running bytes.
- A bounded manifest reader accepts only the Hub artifact and valid version/revision strings. Each startHub instance captures the result once; neither endpoint reopens a mutable path. Invalid fields become `unknown` without returning raw metadata or errors.
- Connections adds a compact build card using existing components and styles. A short revision is visible; the full revision can be copied or selected. Missing build context from older hosts has an explicit fallback. No configuration option supplies or overrides identity.
- Tests use copied release modules and disposable state to exercise current-link changes and restarted hosts, plus isolated Git fixtures for clean/dirty/same-version packaging and browser checks for known/unknown/copy behavior. Installed processes and private state are excluded.

## Risks / Trade-offs

- A syntactically valid manifest alone is not a trusted installation receipt → document this boundary and leave archive/source verification to the approved installer contract.
- Clipboard access can fail → retain selectable full revision and report the copy failure.
- A checkout build has no package manifest → show unknown instead of inferring its checkout revision.

## Migration Plan

The endpoints gain additive read metadata; the UI tolerates older contexts. Source delivery requires current-candidate owner UI approval. Installation and rollback stay in Hub #427.
