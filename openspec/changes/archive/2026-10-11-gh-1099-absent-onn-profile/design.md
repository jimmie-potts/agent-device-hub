## Context

See the proposal's motivation and #1099. The manual operator composition shares one health guard between preflight and post-start verification. Its known-module list excludes ONN even though the current runtime ships it. State inspection already rejects ONN configuration and retained files.

## Goals / Non-Goals

**Goals:** Admit only the observed unconfigured ONN row, preserve both verification paths and prove the conservative state boundary.

**Non-Goals:** No ONN configuration, state migration, device action, new profile registry, admission schema change or installed operation. BB-8's broader qualification remains separately owned.

## Decisions

- Add ONN to the existing explicit known-module and absence lists, while explicitly refusing configured ONN. A generic unknown-module exception would remove the qualification boundary.
- Keep the state reader unchanged; regression tests prove configuration and every retained ONN file shape refuse without opening or modifying them. Adding ONN as a durable owner would require separate complete qualification under #1044.
- Exercise the existing composed preflight and running-check fixtures. Keep an actually unknown row as the negative control after ONN becomes recognized. Existing trace, private evidence and fixed refusal-code behavior remain unchanged.
- Create this design because installed admission is a security and recovery boundary, despite the small code change. Runtime ownership and architecture stay unchanged.

## Risks / Trade-offs

- An overly broad exception could admit active ONN → require the exact row and retain configuration/state refusals in both paths.
- A later BB-8 profile could replace this boundary → coordinate its integration after this reviewed revision and preserve both scopes.
- Source qualification could be mistaken for installed acceptance → keep #1099 source-only; #1054 retains exact admission, upgrade and physical evidence.

## Migration Plan

Deliver the reviewed source and procedure through a guarded PR and successful merged-main CI. No migration or service operation runs in this story. The separate #1054 routine upgrade uses its qualified plan and recovery procedure; source tests do not grant new effects.
