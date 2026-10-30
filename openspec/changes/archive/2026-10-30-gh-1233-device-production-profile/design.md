## Context

See proposal.md for motivation. The entrypoint and host operator separately enforce the existing browser profiles. Shipped registrations already declare dependency order and simulation factories. The SDK owns module configuration and private-secret checks. Security and multi-boundary admission require this design under the schema's design criteria.

## Goals / Non-Goals

Reuse the fixed runtime and existing private ingress with explicit configured-module admission. Keep device ownership, credential scopes and actual target qualification with their existing owners. No wire-format, database, physical-device or host-dependency implementation changes.

## Decisions

- Add `BUNNY_ACCESS=production`, using the current private-proxy edge requirements and credentials policy. Widening either existing browser profile would change its accepted restrictions, so both retain their current behavior.
- Select configured shipped registrations in existing order, require their declared dependencies, and use existing module configuration checks. Allow only canonical private secret references under `/run/secrets/bunny`. With disabled control retain the non-device path and refuse devices. No new simulation environment flag is exposed in production.
- Keep the gateway at host loopback TCP 18788 and the existing ordinary dedicated bridge. Add a separate optional Pixoo override for one private host IPv4 at TCP 41240, matched to its hosted-GIF configuration. A generic arbitrary-port allowlist would add no current value.
- Provide no host dependency mounts. Production accepts only the established private named volumes and temporary directory; ONN/Roborock missing dependencies keep their module outcomes. Additional host setup is qualified under #565/#568.
- Reuse the local lease before runtime effects. It cannot exclude a PC writer; #568 owns that shutdown. Invalid profile input refuses before state effects with fixed errors. Module startup keeps existing failed/refused/unavailable outcomes and no command retry.

## Risks / Trade-offs

- A control flag could select all shipped devices. Require sections explicitly and preserve disabled defaults and both old profiles.
- Extra network publication could expose the gateway. Validate configured/effective bindings independently, with only the bounded optional Pixoo binding.
- Fresh state could be mistaken for a handoff. Document PC writer exclusion as a separate required cutover step and perform no device action here.
- Tests could silently reach a device. Inject the existing simulated factories only in test construction and run acceptance inside a network-disabled disposable container.

## Migration Plan

Install the reviewed image on the established Mac through its stopped-backup/manual image replacement procedure. Keep its existing private-proxy configuration and control disabled for readback. Preserve latest state and prior image; no state-format migration or automatic snapshot rollback. Selecting production and physical targets remains #568's separately authorized operation.
