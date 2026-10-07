# Codex Desktop module

`@jimmie-potts/codex-desktop` is the runtime's Codex Desktop module
([Hub #926](https://github.com/jimmie-potts/agent-device-hub/issues/926)), written
against the [module API](../../packages/sdk/README.md#modules) 1.2 under
[ADR 0012](../../docs/decisions/0012-bunny-event-platform.md). It turns Codex
Desktop's read marker into read evidence for the core's sessions, as the old Hub's
reader did (Hub #191), and replaces that reader at the cutover
([#840](https://github.com/jimmie-potts/agent-device-hub/issues/840)). Until then
the installed Hub keeps `apps/hub/src/codex-desktop.ts`, which stays unchanged
until the retirement story ([#839](https://github.com/jimmie-potts/agent-device-hub/issues/839)).
Nothing installs this module yet, and its tests and disposable runs use a
synthetic or simulated marker only.

The runtime ships it last, after the Nanoleaf module (`apps/runtime/src/modules.ts`):
it only syncs from the core and publishes to it, so no module waits on it.
`codexDesktopFactory` builds it with `folderReader()` for the real Codex home, or
with `SimulatedMarker` under `--simulate`. A runtime without a `codex-desktop` section
in its [configuration file](../../apps/runtime/README.md#configuration) refuses
the module with `not-found` and runs on. The factory's `simulatedSection`,
`CODEX_DESKTOP_SIMULATED_SECTION`, configures the simulated build; its home is
never read.

## Provenance

Ported on 2026-10-07 from `apps/hub/src/codex-desktop.ts` at main `8590332f`, with
its tests, under the strict profile and the module boundary. The module imports
only `@jimmie-potts/sdk` and `@jimmie-potts/event-contracts`.

| Source | Module file | What changed |
| --- | --- | --- |
| `codexDesktopOptions` | `src/configuration.ts` | The same three members and checks, as `configure`; a refusal is the shared error body with fixed text. `convertHubCodexDesktop` is new, for the installer. |
| `unreadSessions` | `src/marker.ts` | Unchanged. |
| `createDesktopRead`'s `refresh` | `src/marker.ts` (`readMarker`), `src/reader.ts`, `src/transport.ts` | The same stamp, size bound and reread of a file that changed while it was read, now synchronous in the reader's own process. The reader never reads a special file, and its open cannot block on one. |
| `readEvents` | `src/evidence.ts` | The same rules on the core's `session/2.0` records; each piece of evidence is a `read-observed` lifecycle observation. |
| `startDesktopRead` | `src/module.ts` | The same 2 s poll, one read at a time, now with a read deadline, the marker's availability and evidence once per record revision. |
| `tests/codex-desktop.test.mjs`: the parser and configuration cases | `tests/marker.test.ts`, `tests/configuration.test.ts` | The same cases. |
| The read state, settle and unusable marker cases | `tests/module.test.ts`, and with the real core `apps/runtime/tests/codex-desktop.test.ts` | The same decisions, observed as published observations; the real core's reduction in the runtime's test. |
| The host's polling case | `apps/runtime/tests/codex-desktop.test.ts` | The real reader process on a synthetic marker, through the real core. |

Not ported, because the issue covers the read marker only: the Hub's other two uses
of its `codexDesktop` setting, which the runtime does not have yet. Each needs its
own story before the cutover:
- **Archive admission** (`archivedSession`, Hub #195): the Hub's agent-state owner
  refuses a hook for a Desktop conversation whose rollout file is in
  `archived_sessions`, so a late hook never brings an archived conversation back.
  The runtime's core reads no Codex file.
- **Desktop titles** (`enrichCodexTitle`): the Hub adds the title from Codex's
  `session_index.jsonl` in this Codex home to each Desktop hook's observation.
  The 2.0 hook reads only its own process's Codex home, which need not be
  Desktop's.

## Configuration

The module's section of the runtime's configuration file, the old Hub's
`codexDesktop` setting as it is:

```json
{"home": "/mnt/c/Users/<user>/.codex", "hostId": "<host id>", "sourceId": "<Codex Desktop source id>"}
```

- `home`: the Codex home that holds `.codex-global-state.json`, an absolute,
  normalized path of at most 1024 characters. It may lie on a Windows mount.
- `hostId` and `sourceId`: the Codex Desktop producer's neutral IDs, each 1 to
  128 letters, digits, underscores, dots or hyphens. Only its sessions get read
  evidence.

The module reads no secret; the runtime's `secrets` member is ignored. No refusal
repeats a value from the section. `convertHubCodexDesktop(hostConfiguration)`
turns the old Hub's `host.json` into this section, or gives undefined when the Hub
has no `codexDesktop`, and checks the result with the module's own `configure`.
The installer ([#935](https://github.com/jimmie-potts/agent-device-hub/issues/935))
runs it. The module's settings (module API 1.2) show `hostId` and `sourceId`,
never the home.

## Read evidence

The module follows the core's sessions through sync, reads the marker every 2 s
and, for each configured top-level Desktop session whose read state the marker
changes, publishes one `org.bunny.lifecycle.observed` occurrence with a
`read-observed` event to the core, from `bunny/modules/codex-desktop`, on
`bunny.event.lifecycle.<session ID>`. The Hub's rules hold:

- Only the configured producer's Codex Desktop sessions count, and never a
  subagent: Desktop lists unopened subagent threads indefinitely.
- A listed session is unread. An unlisted one is read once it was unread, or,
  when its read state is unknown and no turn is known to run, five seconds after
  its last evidence, when Desktop has had time to set the flag.
- An unusable marker, missing, unreadable, oversized, malformed or of another
  format, gives no evidence, and the module logs each change of that once.
- The observation names the session's turn, an unknown parent and unknown
  ordering, as the Hub's did.

Evidence for one revision of a session's record is published once: when the core
does not take it, the module does not send it again until the record changes.
Each observation starts its own trace, which the core's intake record carries.

## Reading the marker (policy A)

The marker's folder is the module's device. Start never waits on it: the first
read comes once start has returned.

The Codex home lies on a Windows mount. A file system call there can stall for as
long as the mount does, and nothing interrupts it. On Node 24, a thread blocked
in such a call keeps a worker's `terminate()` and even `process.exit()` waiting
(measured with a FIFO's `open` on 2026-10-07), and an asynchronous call would
block one of the libuv pool's threads, which the whole process shares. So
`folderReader()` reads in a child process of its own, `src/reader.ts`. The reader
starts on the first read, and again after it ended. It takes no arguments, so no
path shows in the process list: each read names the home over its IPC channel.
It reads synchronously, never keeps the runtime alive, and ends with it.

- Evidence comes only from a read that answered, so a stalled folder yields
  none.
- A read that does not answer within 5 s makes the marker unavailable: one
  `device.unavailable` warning, then a summary at most once a minute. The next
  read waits for the one under way, so a stall holds one reader, never more.
  When the read answers, one `device.available` record follows.
- A reader that fails, as when its process ended, makes the marker unavailable
  too. It is tried again after 4, 8, 16 and 32 s, then every minute, until a
  read succeeds.
- The module's stop never waits on a read. It kills the reader; one stuck in a
  stalled call ends once the call returns. The runtime still stops and exits.
- The module never fails for its folder, and the core and the other modules are
  never affected.

The reader process costs a Node process's memory: 49 MiB resident after 50
reads of a small marker, against 44 MiB for an idle Node process (measured on
the WSL host on 2026-10-07). A read holds a buffer the size of the marker. When
the runtime leaves the PC ([#751](https://github.com/jimmie-potts/agent-device-hub/issues/751)),
Desktop's read state has to reach it from the PC instead
([#567](https://github.com/jimmie-potts/agent-device-hub/issues/567)).

## Diagnostics

Records carry `bunny.module` `codex-desktop`, never the home or the marker:

| Record | Level | When |
| --- | --- | --- |
| `device.unavailable` (`bunny.device.id` `marker`) | WARN, then DEBUG summaries | A read outlasted its deadline or the reader failed. |
| `device.available` | INFO | A read answered after that. |
| `operation.failed` (`bunny.operation` `lifecycle`, `bunny.reason` `invalid-input`) | WARN | The marker became unusable. |
| `operation.completed` (`bunny.operation` `lifecycle`) | INFO | It became usable again. |
| `operation.failed`, `operation.completed` (`bunny.operation` `feed`) | WARN, INFO | The copy of the core's sessions was lost, and synced again. |
| `lifecycle.observed` | DEBUG | One observation published, in its trace. |

## What leaves the module

Only read observations of Codex Desktop sessions reach the bus, and only the
unread thread IDs leave the reader's process. The marker is only read, never
written. No message, record, setting or health entry carries the home or the
marker's content.

## Checks

See [Codex Desktop module checks](../../docs/development.md#codex-desktop-module-checks).
