## Context

Sources read at pickup on 2026-10-07, main `8590332f` (#835 merged): the issue and #835's hand-off (producer grants
through `grantCredential` and SIGHUP, checked with `/api/v2/authority`; an `ingest` grant publishes only
`bunny.event.lifecycle.*` with the lifecycle family; grant operations deferred by the owner);
[ADR 0012](../../../docs/decisions/0012-bunny-event-platform.md) "Failure isolation", "Errors, effects and outcomes" and
"Observability"; the old hook (`apps/hub/bin/monitor-hook.mjs`), the Hub's setup (`producerPrincipal`, the producer
file and its receipt), the Hub's Codex Desktop reader and its tests; agent-state's normalizers; the core's mapping
(`toEnvelope`) and intake; the gateway's grants, `convertHubEdge`; the SDK's remote client and edge; the module test
kit; and the LIFX and Tidbyt modules as patterns. The issue stays aligned; the adjustments below are within its scope.
Rebased on 2026-10-07 onto `2298cc7c` (#972, on main `c83f6697` with the Pixoo and Nanoleaf modules): the module now
ships last, after them, since it only syncs from the core and publishes to it, and the harness's new simulation check
lists the marker's actions and takes `sessions` only with `list`.

## Goals / Non-Goals

**Goals:**
- Hooks report to the runtime unchanged for the clients: same command path behind the link, same producer files, the
  same bounds and fail-open behavior.
- Codex Desktop's marker gives the same read evidence through the core, and a stalled mount touches nothing else.
- Measure the hook's latency to the edge, which the issue lists as unmeasured.

**Non-Goals:**
- Producer grant and revoke operations (owner decision, 2026-10-07); the installer (#935) and the cutover (#840).
- The Hub's two other uses of its Codex Desktop setting, archive admission (#195) and Desktop titles from the Codex
  index, which the issue does not name; they are handed off.
- Prompt, response and transcript capture (#425); new providers.

## Decisions

- **The hook derives its source; the producer file stays unchanged.** The edge requires a message's `source` to be its
  credential's. The cutover's `convertHubEdge` gives each Hub credential `bunny/parts/<ID>`, and the Hub's setup named a
  producer's credential `hub-` plus 32 hex digits of the SHA-256 of its source configuration without the hook name. The
  hook computes the same from the producer file, so no file changes. Alternative rejected: a second call to learn the
  source (`/api/v2/authority` names only the scope), which would double the hook's round trips.
- **One call, no stream.** The edge's `publish` call needs no stream, so `publishOnce` posts once with `node:http`,
  which tells a refused connection (nothing sent: `rejected` with `unavailable`) from a call that reached the edge and
  lost its answer (`uncertain` with `uncertain-result`), as ADR 0012's rejection-proves-no-effect rule needs. `fetch`
  would hide the difference in an exception's `cause`, which the safe-error rules forbid reading.
- **The hook loads light and is relocatable.** `bin/monitor-hook.mjs` arms the 2.9 s deadline before it imports
  anything, then imports only `@jimmie-potts/runtime/hook` by package name, which loads the normalizers, the SDK and the
  contracts, never the rest of the runtime, so the installer can place it behind the hook link. Measured, it costs
  about 15 ms more than the old hook.
- **The 1.x envelope maps one way.** `observationOf` is the inverse of the core's `toEnvelope`: kebab-case kinds,
  `eventId` as `nativeEventId`, known ordering with its source as authority; a consumer's acknowledgment, a command in
  2.0, maps to nothing. A test checks the round trip for every kind.
- **The marker's reader is a child process.** On Node 24 a thread blocked in a file system call that does not return
  keeps `worker.terminate()` and `process.exit()` waiting, and the libuv pool is the whole process's; measured with a
  FIFO's `open`. The Codex home lies on a Windows mount, so the reader runs in its own process, forked on the first read,
  unreferenced, given the home over IPC and never in its arguments, and killed at the module's stop. It costs about
  5 MiB above an idle Node process (49 MiB resident against 44 MiB). Alternative rejected: worker calls per poll, which
  leak a thread per stalled poll and keep the runtime from exiting.
- **Policy A for the folder.** Evidence comes only from a read that answered. A read past 5 s makes the marker
  unavailable (`DeviceAvailability`: one warning and summaries), and the next read waits for the one under way. A
  failed reader backs off 4 to 60 s. Start never waits.
- **Evidence once per record revision.** The Hub ingested again every 2 s while the reducer left the state unchanged;
  in the runtime each publication is a message the core logs, so the module remembers what it sent for each record's
  revision and sends again only after the record changes.
- **Module API 1.2 for settings.** The module shows `hostId` and `sourceId`, never the home; the process test now takes
  each shipped module's API version from its manifest.
- **Tier 2 drives the real script.** The harness contract gains `hook`, which spawns the script with an unchanged 1.x
  producer file. A run's supervisor writes that file once it knows the runtime's port and can hold the runtime stopped
  during a restart, so the hook meets a stopped runtime as a client's would.

## Risks / Trade-offs

- [A producer credential whose ID is not the Hub's derivation] would authenticate but be refused `forbidden` as another
  source, and its hooks would be lost silently. Every producer the Hub's setup made has that ID; the installer can check
  each producer file with `producerSource` against the converted credentials (handed to #935).
- [The reader process] costs a Node process. Accepted for isolation; measured.
- [A stalled reader that never returns] keeps one process stuck until the mount recovers; the module never starts a
  second while one is outstanding.
- [Lost observations while the runtime is down] are the fail-open contract; the session's freshness shows the gap.

## Migration Plan

Nothing migrates in this story. At the cutover the installer places `apps/runtime/bin/monitor-hook.mjs` as
`bin/monitor-hook.mjs` behind the hook link with `@jimmie-potts/runtime/hook` resolvable there, converts the Hub's
credentials with `convertHubEdge` (each producer keeps its ID, digest and `ingest`), and writes the module's section with
`convertHubCodexDesktop`. Rollback is the cutover's.

## Open Questions

None for this story. The archive admission and Desktop title gaps need their own story before #840.
