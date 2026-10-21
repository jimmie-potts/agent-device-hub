## Context

See proposal.md for the selected outcome. The private prototype has reviewed canvas geometry, routes and a ten-slot allocator. Current main has a quiet-glass React shell, one SDK session copy and an allowlisted static-asset gateway. The earlier six-burrow design is hibernated.

## Goals / Non-Goals

Goals: retain pixel composition and saved customization while adopting the existing shell connection and normal application lifecycle. Non-goals: another service, iframe, transport, renderer dependency, core reducer, storage owner, real playback or unqualified mobile/Claude app links.

## Decisions

Mount a scoped DOM/canvas renderer within React, with a typed controller over the shell's existing session records. Preserve the reviewed renderer's JavaScript geometry with module factories, explicit cleanup and maintained JS lint rather than rewriting hundreds of pixel coordinates. New policy/controller/preferences code is strict TypeScript. An iframe or separate preview connection would duplicate lifecycle and isolate preferences unnecessarily.

Keep the stable ten-slot policy and state helper precedence. Reconcile only after authoritative sync; disconnected evidence freezes occupants. Local assignment and appearance state remains browser-local and contains no titles or transcripts. Selection/navigation sends no commands and does not mark conversations read. Known child records do not consume slots; unknown parentage is not inferred.

Scope renderer styles beneath its root; controls use the current semantic skin roles and artwork remains bitmap. Continuous habitat motion is an explicit ambient-page exception with pause, document visibility and reduced-motion controls. Route unmount aborts listeners, timers/demo actions and animation frames; remount creates fresh geometry and restores local preferences.

A bounded, whitelisted local settings file transfers the existing preview's eight preference keys between browser origins. Import validates before writes, backs up receiving values, rolls back partial failure and remounts after success. File data is read locally and never uploaded. Failed/unmounted/stale imports cannot mutate state. Original preview preferences remain untouched.

## Risks / Trade-offs

- Renderer DOM lifecycle leaks: abort listeners and pending actions, cancel animation frames, and test route leave/reentry.
- Artist-approved alignment regressions: preserve art bytes/geometry and retain capacity/routing tests.
- Old preview origin cannot share localStorage: explicit export/import with private backup.
- Canvas unavailable: keep a readable session list/status fallback and no crash.
- Browser URI navigation does not prove native app focus: retain separate normal-use limits.

## Migration Plan

Deliver reviewed source through PR and exact-head/main CI. Import preview preferences explicitly after opening Habitat. Follow the established runtime upgrade/admission/lock/receipt procedure; no hook, module activation, configuration or device command is added. If that procedure refuses, retain the source result and report the specific installation gate. Keep the hibernated art and private original unchanged; rollback uses the qualified runtime recovery procedure and preserves browser preferences.
