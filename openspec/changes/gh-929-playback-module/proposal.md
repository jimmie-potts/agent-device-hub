## Why

[Hub #929](https://github.com/jimmie-potts/agent-device-hub/issues/929), the third child of #832 in
[epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827), moves the old Hub's shared playback (#175,
#233) into the new runtime. The Tidbyt now-playing tile (#930) and the Pixoo Now Playing cards (#843) read its record
next. ADR 0012 has every device run as a runtime module that publishes its state as messages and answers commands with
a reply and an outcome, and policy A makes a speaker's errors and timeouts outcomes and `unavailable` state, never a
module failure.

## What Changes

- **The playback module** (`modules/playback`, `@jimmie-potts/playback`), copied from `apps/hub/src/playback.ts`,
  `sony.ts`, `sonos.ts` and part of `common.ts` with provenance notes. One module owns both speakers, because the
  presented-source rule needs both. It polls each speaker every two seconds on the runtime's scheduler, publishes the
  presented source as the core `playback/2.0` record with a new revision when availability or playback changes, serves
  it through sync, and answers `playback-control` (#918) with a reply and an outcome from its outbox.
- **Configuration** through #919's module API 1.1: a section with the record's routing ID and one or two speakers.
  `convertHostPlayback` converts the old Hub's `host.json` block for the installer (#935), keeping both addresses and
  renaming a 1.x ID outside the routing-ID form.
- **Commands** go once to the speaker presented at admission, after the module stores the command's intent, and are
  never redirected or retried. A crash between intent and outcome is reported `uncertain` at the next start.
- **Simulated speakers** that answer both protocols, a module factory in the runtime's shipped list, a
  `speaker-playback` catalog scenario in the in-memory harness and in disposable runs, with the speakers held by the
  run's supervisor.
- **Tests:** the Hub's source, ranking, freshness and configuration tests, translated; the module test kit with policy
  A's offline check; and the module's own command, staleness, offline-at-start and crash tests.
- **Docs:** the module README, the runtime and verification READMEs, docs/development.md, docs/architecture.md and
  MAPPING.md's rename rule.

## Capabilities

### New Capabilities
- `runtime-playback`: the playback module's configuration and conversion, polling and freshness, presented source,
  record, sources, commands, failures and diagnostics, and simulated speakers.

### Modified Capabilities
- `bunny-runtime`: the shipped list now holds the playback module after the core, and the scenario catalog covers it.

## Impact

- **Source:** `modules/playback/*` (new); `apps/runtime/src/modules.ts` (one factory); the scenario catalog, the
  in-memory harness, the run's child, supervisor, protocol, adapter and build check.
- **Manifests:** root `package.json` (the workspace, build, typecheck and `test:playback` scripts),
  `apps/runtime/package.json` (`@jimmie-potts/playback` 0.1.0), `package-lock.json` and the core CI job's
  `test:playback:built`.
- **Tests changed:** the shipped process now shows the playback module `refused` without a configuration file, and the
  configuration test runs the shipped runtime with a playback section and `--simulate`.
- **Behavior:** source-only. The Hub's copy stays and keeps its tests until #839; the live check is #840's.
