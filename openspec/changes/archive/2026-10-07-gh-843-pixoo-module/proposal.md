## Why

The Pixoo still runs as a separate service from divoom-app-upgrade, with its own HTTP API, 1.x command surface and Hub snapshot readers. [Epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827) moves every device into the B.U.N.N.Y. runtime under [ADR 0012](../../../docs/decisions/0012-bunny-event-platform.md). #25 staged the Pixoo's packages in `modules/pixoo`; [Hub #843](https://github.com/jimmie-potts/agent-device-hub/issues/843) runs them as the runtime module `pixoo`, so the module can replace the separate service at the cutover (#840). Monitor follows the core's synced sessions, and Now Playing follows the playback record. Commands become request messages with tracked outcomes, and the imported code passes the strict profile.

## What Changes

- **One module package.** The six `@pixoo/*` workspace packages become `@jimmie-potts/pixoo` under `modules/pixoo/src`, with relative imports, so the module boundary accepts them. `modules/pixoo` leaves staging: the strict profile, the module boundary and the safe-error rules cover it, its 59 baselined findings are cleared, and the `@pixoo/` scope is gone. The moved Vitest suite runs from the compiled tests; the module's own tests use node:test and the module test kit.
- **The module.** `createPixooModule({transport})` declares module API 1.1. Its `configure` takes the device's routing ID, private address and observed profile, the hosted-GIF listener, the starting presentation and Now Playing settings and the playback record to follow. `convertPixooSettings` turns the Pixoo service's settings files into that section for the installer (#935). The library, the player's checkpoint, the module's settings and its outbox live in its own SQLite file and private folder. It stores no copy of another owner's state.
- **Copies by sync.** Monitor follows the core's `session/2.0` records through sync, and Now Playing follows the `playback/2.0` record. The scenario catalog and disposable runs use the playback module (#929) with its simulated speakers. The presentation reads 2.0 records; the 1.x snapshot sources stay behind.
- **Commands with tracked outcomes.** `PixooControl` replaces divoom-app-upgrade's `ControlService`. The module answers `device-mode-set`, `media-start`, `media-control`, `brightness-set` and `power-set` (#918) and its own `pixoo-media-show`, `pixoo-monitor-set`, `pixoo-now-playing-set`, `pixoo-playlist-change`, `pixoo-asset-change` and `pixoo-notice-dismiss`. It refuses with a typed refusal before acting, or stores its record of the work, replies `accepted` and reports the outcome through its outbox (#882). A command accepted before a restart is reported `uncertain` and never sent again, and a repeated request changes nothing. The three cancellation cases dropped at the move are restored against `PixooControl`.
- **Device state and policy A.** The module publishes `device/2.0` with its availability, desired and observed values, pending commands, last outcome and last transmission. It also serves its display state and catalog (`pixoo-display`, `pixoo-rendition`, `pixoo-playlist`) through sync, and each record fits the 256 KiB cap. Its start opens only local resources. It probes the device later, reports an offline Pixoo `unavailable`, and logs one degradation and one recovery.
- **Isolation.** Media decoding keeps its forked child process, with a 256 MiB heap and SIGKILL on abort, so a corrupt or oversized image fails only its own job. Monitor and Now Playing frames render in worker calls. The child's tracing pipe and the module's imports of the observability package and agent-state go.
- **Consumer-only dismissal.** `pixoo-notice-dismiss` sends `notice-acknowledge` with the consumer ID `pixoo`.
- **Runtime.** The shipped list adds `pixooFactory`, with a `SimulatedPixoo` under `--simulate`. The scenario catalog gains four Pixoo scenarios, played in the in-memory harness and in disposable runs, whose child holds the simulated Pixoo, beside the playback module's simulated speakers in the supervisor.

## Capabilities

### New Capabilities

- `bunny-pixoo-module`: the Pixoo module's configuration, state, copies, commands and outcomes, device state and availability, media and render isolation, catalog, dismissal and settings conversion.

### Modified Capabilities

- `bunny-runtime`: the shipped list now holds a device module, which the runtime refuses without its section; the catalog covers the Pixoo; and disposable runs reach the child's simulated Pixoo.

## Impact

- **Code:** `modules/pixoo` (regrouped package, `src/module/*`, the presentation's 2.0 sources, the media worker, the library's attach mode); `apps/runtime/src/modules.ts`; the scenario catalog, in-memory harness and fixtures; `apps/runtime/verify` (child, supervisor, protocol, adapter, plugin); `eslint.config.mjs`, the lint baseline and `tests/strict_profile.test.mjs`; `tests/workflow_checks.cjs`; root `package.json` and the lockfile (workspace, build order, `test:pixoo:built`); `apps/runtime/package.json`.
- **Tests:** the moved Vitest suite with the three restored cases and a control test; the module's kit, behavior and configuration tests; the runtime's shipped-process, log and catalog tests; the verify build test; the maintenance journal test.
- **Docs:** the module README, with the expected webcam results for #840, and the runtime and verify READMEs, plus `docs/development.md`.
- **Unchanged:** the SDK and its module API (1.1), the event contracts, released 1.x contracts, the installed Pixoo service and its simulator, and CI's job list.
- **Delivery:** source-only, with observable behavior, verified in disposable runs (`verify:runtime`) with a simulated Pixoo, so the change gets an Acceptance review. Installation happens at the cutover (#840); the library's migration is #931 and the Pixoo pages are #932.
