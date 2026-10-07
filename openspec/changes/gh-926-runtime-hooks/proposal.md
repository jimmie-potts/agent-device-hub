## Why

[Hub #926](https://github.com/jimmie-potts/agent-device-hub/issues/926), a child of
[epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827), moves the agent hooks and Codex Desktop's read
evidence onto the B.U.N.N.Y. runtime. Today Claude Code's and Codex's hooks run the old Hub's
`apps/hub/bin/monitor-hook.mjs` through the installed hook link, which posts lifecycle 1.x to
`/api/monitor/v1/events`, and the Hub polls Codex Desktop's read marker every 2 s. Under
[ADR 0012](../../../docs/decisions/0012-bunny-event-platform.md) both publish `org.bunny.lifecycle.observed` to the
core through the SDK edge. The inputs have landed: the agent-session core (#831), and the runtime's gateway with
producer grants, `/api/v2/authority` and the cutover's credential conversion (#835, PR #969, merged as `8590332f`).
Producer grant and revoke operations wait until a new client or machine needs one (owner decision, 2026-10-07).

## What Changes

- **A one-call publish in the SDK.** `prepareMessage` builds a profile 2.0 message, and `publishOnce` sends one
  prepared message to an edge's `publish` call without a stream, bounded as a whole, with a result that says whether it
  was published, rejected (no effect) or uncertain.
- **The 2.0 agent hook.** `apps/runtime/bin/monitor-hook.mjs` reads an unchanged 1.x producer file with the old hook's
  checks, normalizes the hook with agent-state's normalizers, maps the envelope to the 2.0 `lifecycle` observation and
  publishes it as the producer's converted credential, whose source it derives as the Hub's setup named the
  credential. Every path exits 0 within 2.9 s and writes nothing. `scripts/measure-hook.mjs` measures it end to end.
- **A Codex Desktop module.** `modules/codex-desktop` ports the Hub's reader: the same marker parser and read rules,
  published as `read-observed` observations, read in a child process of its own so a stalled Windows mount never holds
  a runtime thread, with a read deadline, the marker's availability logged once per outage, capped backoff and a stop
  that never waits. `convertHubCodexDesktop` turns the Hub's `codexDesktop` setting into its section for the installer.
  The runtime ships it after the Tidbyt module.
- **Both tiers.** The catalog gains `agent-hooks` and `codex-desktop-read`, played in the in-memory harness on both
  transports and in disposable runs; the harness contract gains `hook`, which runs the script, if asked while the
  runtime is stopped. A run's supervisor writes the producer file, holds the simulated marker and can hold the runtime
  stopped for a restart.

## Capabilities

### New Capabilities

- `runtime-agent-hooks`: the 2.0 hook script: the producer file, the normalizers and the 2.0 observation, the
  converted credential and its grant, bounds and fail-open behavior, trace, and the measurement.
- `runtime-codex-desktop`: the Codex Desktop module: configuration and conversion, the read rules, reading the marker
  under policy A, what leaves the module, and the simulated marker.

### Modified Capabilities

- `bunny-sdk`: one prepared message published without a stream.
- `bunny-runtime`: the shipped list holds the Codex Desktop module after the Tidbyt module; the catalog and disposable
  runs cover the agent hooks and the Codex Desktop marker.

## Impact

- **Code:** `packages/sdk/src/remote-publish.ts` (new) and `index.ts`; `apps/runtime/src/hook/` (new),
  `apps/runtime/bin/monitor-hook.mjs` (new), `apps/runtime/scripts/measure-hook.mjs` (new), `apps/runtime/package.json`
  (the `./hook` export and the module dependency), `apps/runtime/src/modules.ts`, the `credentials.ts` comment;
  `modules/codex-desktop` (new); `apps/runtime/tests` (`hook.test.ts`, `codex-desktop.test.ts`, a fixture, the
  process test's expected API versions, `scenarios/catalog.ts`, `catalog.test.ts`, `memory.ts`, `parts.ts`);
  `apps/runtime/verify` (`adapter.ts`, `child.ts`, `plugin.ts`, `protocol.ts`, `seed.ts`, `supervisor.ts`,
  `tests/build.test.ts`).
- **Docs:** the runtime, SDK, module and verify READMEs; `docs/development.md`.
- **Coordinator-owned files:** the root `package.json` (workspace, build, typecheck and `test:codex-desktop` scripts),
  the lockfile (the new workspace link), CI (`test:codex-desktop:built`, with `tests/workflow_checks.cjs`) and
  `docs/development.md`.
- **Unchanged:** `apps/hub/bin/monitor-hook.mjs`, `apps/hub/src/codex-desktop.ts` and everything the installed Hub's
  hook path loads; the core; the gateway; released 1.x contracts; personal hook settings.
- **Delivery:** source-only, verified in disposable runs; the cutover (#840, through #935) installs the script at the
  existing relative path behind the hook link and writes the module's section.
