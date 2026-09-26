## Why

[Hub #323](https://github.com/jimmie-potts/agent-device-hub/issues/323) owns this scope. [codex-nanoleaf#113](https://github.com/jimmie-potts/codex-nanoleaf/issues/113) ([PR #164](https://github.com/jimmie-potts/codex-nanoleaf/pull/164)) makes the NL22 Light Panels a second device of the Nanoleaf controller, at the hub's pinned source `0043456deea4f224dfa39ae1bb9d4f289e77e3d1`. The Panels' `nanoleaf.integration/1.0` snapshot is read-only. It keeps the exact key set, lists no elements, pending wall edit, requests or outcomes, and marks `settings.set`, `elements.assign`, `task.assign` and `project.color` as `{supported: false, scope: "control"}`. The hub's closed snapshot validation requires `supported: true` for all four, so it answers `incompatible-controller` and the dashboard page for the Panels shows no general controls.

## What Changes

- The hub's closed `nanoleaf.integration/1.0` snapshot validation accepts `supported: false` with `scope: "control"` for the four configuration operations. Every other key keeps its exact validation, and `mode.set` stays `supported: true` on the controller v1 route.
- The dashboard shows each Nanoleaf configuration form (integration settings, element mapping, task mapping, project colors) only when the snapshot marks its operation supported. One line names the unsupported ones. The fresh read taken just before an edit is sent applies the same rule, so an operation withdrawn after the form rendered sends nothing. Mode, power, brightness and scene controls are unchanged.
- The Nanoleaf power and brightness hints say "Nanoleaf" and "this device" instead of "the wall", so they are accurate on both devices.

Unchanged: routes, the request consumer and its vendored fixtures, MCP tools, the Lines' snapshot shape and editing, and the credential boundary. The hub still forwards a Panels extension command to the owner, which rejects it with `unsupported-capability`.

Deferred: keeping the controller v1 snapshot and general controls when the integration read fails, which the issue lists as optional. Once the Panels' snapshot validates, no current device needs it. Revisit if an integration read fails on a device whose controller v1 snapshot is healthy. Panels animations and configuration edits remain Nanoleaf-side work (the #92 follow-up and codex-nanoleaf#47).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `standalone-hub-host`: accepts a read-only Nanoleaf integration snapshot.
- `unified-dashboard`: shows only the supported Nanoleaf configuration forms.

## Impact

`apps/hub/src/integration.ts`, `apps/hub/tests/integration.test.mjs`, `apps/dashboard/src/main.tsx`, `apps/dashboard/tests/{fixture,matrix}.mjs`, `apps/hub/README.md`, `apps/dashboard/README.md` and `docs/development.md`. Source only; no installation, device or configuration change. The design artifact is omitted: one validator value and conditional rendering in one view, with no state, concurrency, migration, timing or installation change.
