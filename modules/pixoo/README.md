# Pixoo module (staging)

This folder holds the Pixoo code that the B.U.N.N.Y. runtime keeps: the device,
library, media, playback and core packages, and the Monitor and Now Playing
presentation. It arrived as a snapshot for
[#25](https://github.com/jimmie-potts/agent-device-hub/issues/25) under epic
[#827](https://github.com/jimmie-potts/agent-device-hub/issues/827).
[#843](https://github.com/jimmie-potts/agent-device-hub/issues/843) wraps it as a
runtime module.

Nothing here runs as a service. The installed Pixoo service keeps running,
unchanged, from divoom-app-upgrade until the cutover
([#840](https://github.com/jimmie-potts/agent-device-hub/issues/840)). After this
import, divoom-app-upgrade takes only bug fixes. Mirror each fix here and name
its source commit in the commit message.

## Commands

Run these from the repository root with Node 24 (see
[Pixoo module checks](../../docs/development.md#pixoo-module-checks)):

```bash
npm run build          # includes tsc -b modules/pixoo/tsconfig.json
npm run typecheck      # includes tsc -p modules/pixoo/tests/tsconfig.json
npm run test:pixoo     # builds, then runs the moved tests with Vitest
```

## Layout

| Path | Contents |
| --- | --- |
| `packages/core` | `@pixoo/core`: shared schemas for requests, catalog pages, health, Monitor configuration and Now Playing |
| `packages/device` | `@pixoo/device`: the fake (simulator) adapter, the HTTP adapter and its transport, hosted GIF files, and the device qualification functions |
| `packages/library` | `@pixoo/library`: SQLite catalog, playlists, checkpoints and media retention |
| `packages/media` | `@pixoo/media`: bounded rendering through sharp, GIF encoding and decoding, the media store and its worker process |
| `packages/playback` | `@pixoo/playback`: the player, traversal and the library-backed store |
| `packages/presentation` | `@pixoo/presentation`: Monitor presentation, the agent dashboard renderer, Now Playing cards and the pixel font |
| `tests/unit`, `tests/integration`, `tests/helpers` | The moved Vitest tests and their helpers |

## Provenance

- Source repository: https://github.com/jimmie-potts/divoom-app-upgrade
- Source commit: `0777479c2fd7fbaca12d93e724ce8a2c15129b92`, "Add revision-bound
  Pixoo runtime upgrades and recovery (#138)", committed 2026-10-04 and still the
  head of main when read on 2026-10-06
- Full history stays in that repository, which is archived at retirement
  ([#839](https://github.com/jimmie-potts/agent-device-hub/issues/839)).

Paths in the edit list are relative to this folder unless they say "the
source's". Paths in the not-moved list are relative to the source repository.
Every copied file not named in the edit list is byte-identical to its source.

### Active work at the move

Read on 2026-10-06 from divoom-app-upgrade:
- **Branches, PRs and worktrees:**
  - main is at the source commit, and no PR is open;
  - every one of the 57 other remote branches belongs to a merged PR;
  - the 11 local worktrees have no uncommitted changes, and each is on a merged PR's branch or at an ancestor of the source commit;
  - one local-only branch, `claude/pr-116-status-307d29`, points at `9467f90`, which is already on main.
- **In-progress label:** #115 (runtime upgrade) still has it, but its branch merged as #138. Its installer is what #840 replaces.
- **Open issues, disposed at retirement ([#839](https://github.com/jimmie-potts/agent-device-hub/issues/839)):**
  - transfer to this repository: #13, #15, #16, #18, #52, #76, #83, #91, #92, #93, #94, #107, #108, #119 and #122;
  - close as superseded: #14 (by Hub #751), #112, #115 and #126;
  - remote access (#11, #17, #43 and #44): close as superseded, or move to the Hub if remote access is still wanted. The owner decides at #839.

### Edits to the snapshot

- The presentation files moved from the source's `apps/server/src/` to
  `packages/presentation/src/`. Imports of `monitor-source.js` and
  `now-playing-source.js` now point to `sources.ts`. That file holds
  verbatim copies of the `MonitorView` and `PlaybackSourceStatus` types.
  Imports of `security.js` point to `errors.ts`, which holds a verbatim copy of
  `ApiError`. The package's `package.json`, `tsconfig.json` and `index.ts` are new.
- `@pixoo/media` and `@pixoo/presentation` use this repository's workspace
  packages: `@jimmie-potts/bunny-observability` 1.4.0 (the source used a vendored
  1.1.0 tarball; 1.2.0, 1.3.0 and 1.4.0 add only profiles 1.2, 1.3 and 1.4 and
  optional Node host options) and `@jimmie-potts/agent-state` 3.6.0 (the server used
  3.3.0).
- Test imports of the presentation files follow the move.
  `tests/unit/monitor-presentation.test.ts` drops its three cases "immediately
  cancels a pending Media selection on stop, pause or clear with monitoring
  enabled". They drive `MonitorPresentation` through `ControlService`, which did
  not move. #843's command handlers replace `ControlService` and need the same
  assertion.
- Test listeners stay off the installed ports
  ([divoom-app-upgrade#125](https://github.com/jimmie-potts/divoom-app-upgrade/issues/125)).
  `tests/helpers/loopback.ts` adapts `listenLoopback` from the source's
  `tests/helpers/verify-run.ts` and the port list from its
  `scripts/verify/installed-ports.ts`. `tests/helpers/http-device-server.ts` and
  the hosted-file helper in `tests/integration/hosted-transfer.test.ts` use it.
  `tests/helpers/launch.ts` adapts that file's launch helper: a launch whose ready
  line names an installed port is stopped and started again.
  `tests/unit/loopback.test.ts` covers both helpers.
- `tests/tsconfig.json` replaces the source's `tsconfig.tests.json`, and
  `tests/vitest.config.ts` replaces its `vitest.config.ts`. `tsconfig.json`
  lists the packages for `tsc -b`. `package.json` makes the folder an ES module
  scope, as the source's root `package.json` did.

### Files not moved

Each line names the runtime part that replaces the files.

- **HTTP server, routes and static serving** (`apps/server/src/`): `api.ts`,
  `app.ts`, `build.ts`, `catalog-routes.ts`, `device-routes.ts`, `events.ts`,
  `main.ts`, `player-routes.ts`, `security.ts` (except `ApiError`), `server.ts`,
  `sse-delivery.ts`, `validation.ts`. Replaced by the runtime edge on the 2.0
  conventions (#835) and the module's page routes in the shell (#843).
- **1.x command surface and request replay** (`apps/server/src/`):
  `command-observations.ts`, `commands.ts`, `control-service.ts`. Replaced by the
  module's request handlers on the SDK (#830, #843) and the core's accepted and
  completed tracking (#831).
- **1.x Hub controller and integration API** (`apps/server/src/`):
  `catalog-integration.ts`, `controller-events.ts`, `controller-state.ts`,
  `controller.ts`. Replaced by 2.0 commands and events (#835, #843).
- **Standalone MCP server** (`apps/server/src/`): `mcp-cli.ts`, `mcp-config.ts`,
  `mcp-tools.ts`, `mcp.ts`. Replaced by the runtime's MCP surface (#835).
- **Embedded-owner mode and session feed** (`apps/server/src/`): `monitor-cli.ts`,
  `monitor-source.ts` (except `MonitorView`), `monitor-storage.ts`, `monitor.ts`,
  `verification-feed-pause.ts`. Replaced by the core's agent state and sync to
  modules (#831, #842).
- **Hub playback snapshot reader** (`apps/server/src/now-playing-source.ts`,
  except `PlaybackSourceStatus`). Replaced by playback events from the core
  (#842) and the Sonos module (#832).
- **Device settings and the per-device writer lock** (`apps/server/src/`):
  `config.ts`, `device-owner.ts`, `device-settings.ts`. Replaced by the module's
  configuration and its own device writer (#843).
- **Diagnostics** (`apps/server/src/diagnostics.ts`). Replaced by runtime
  observability (#830).
- **Install, upgrade, backup and restore** (`apps/server/src/`):
  `operations-cli.ts`, `operations.ts`, `runtime-adapter.ts`, `runtime-bundle.ts`,
  `runtime-cli.ts`, `runtime-command.ts`, `runtime-config.ts`, `runtime-files.ts`,
  `runtime-host.ts`, `runtime-plan.ts`, `runtime-release.ts`, `runtime-source.ts`,
  `runtime-state.ts`, `runtime-status.ts`, `runtime-upgrade.ts`;
  `apps/server/package.json`, `apps/server/tsconfig.json`; `examples/config.sh`,
  `examples/systemd/pixoo-playlist-controller.env`,
  `examples/systemd/pixoo-playlist-controller.service`;
  `scripts/qualify-runtime-upgrade.mjs`. Replaced by the extended installer and
  the store migration at the cutover (#840, #843).
- **Web application** (`apps/web/`): `index.html`, `package.json`,
  `tsconfig.json`, `vite.config.ts`, and `src/` (`api.ts`, `controller.ts`,
  `library.tsx`, `main.tsx`, `monitor-client.ts`, `monitor.tsx`, `player.tsx`,
  `playlists.tsx`, `preview.tsx`, `settings.tsx`, `style.css`, `workspace.tsx`).
  Replaced by the Pixoo pages in the B.U.N.N.Y. shell (#843).
- **Verification adapter** (`scripts/verify.mjs` and `scripts/verify/`):
  `build.ts`, `capture-steps.ts`, `controls.ts`, `installed-ports.ts`,
  `pairing.ts`, `plugin.ts`, `readiness.ts`, `run-environment.ts`,
  `scenarios.ts`, `transport-guard.ts`. Replaced by Pixoo's simulated transport and
  scenarios in the runtime's evaluation runs (#846, #843).
- **Other scripts** (`scripts/`): `browser-server.mjs` and `dashboard-preview.mjs`
  (replaced by #843's browser checks in the shell); `dashboard-qualification.mjs`,
  `device-spike.mjs` and `gif-qualification.mjs` (command-line wrappers for the
  moved qualification functions, replaced by the live device checks at the
  cutover, #840); `measure-monitor.mjs` (replaced by runtime memory budgets,
  #123); `monitor-hook.mjs` (replaced by the core's hook intake, #831);
  `build.mjs`, `check-workflow.cjs` and `openspec.cjs` (replaced by this
  repository's build and workflow tooling).
- **Unit tests of files not moved** (`tests/unit/`): `build-source`,
  `command-capacity`, `command-observations`, `commands`, `config`,
  `control-service`, `mcp-config`, `mcp-status`, `media-control-service`,
  `monitor-client`, `observability`, `runtime-adapter`, `runtime-bundle`,
  `runtime-config`, `runtime-release`, `runtime-source`, `runtime-upgrade`,
  `service-template`, `sse-delivery`, `verify-build`, `verify-environment`,
  `verify-expect-contract`, `verify-failure-cause`, `verify-feature-map` and
  `verify-feed-pause-release` (each `.test.ts`). Each follows the part that
  replaces its subject above.
- **Integration tests of files not moved** (`tests/integration/`): `api-events`,
  `api-security`, `app-verify-package`, `build-identity`, `catalog-extension`,
  `controller-api`, `dashboard-state`, `dashboard-transport`, `device-cli`,
  `device-runtime`, `diagnostics`, `gif-playback-profile`, `health`,
  `hosted-application`, `hub-contract-package`, `hub-controller-compatibility`,
  `hub-controller-events`, `hub-controller`, `install-receipt-package`,
  `lifecycle-contract-package`, `mcp-cli`, `mcp-lifetime`, `mcp-package`,
  `mcp-shutdown`, `mcp`, `monitor-api`, `monitor-controls-cutover`,
  `monitor-controls`, `monitor-events`, `monitor-failures`, `monitor-hook`,
  `monitor-hub-metadata`, `monitor-measurement`, `monitor-package`,
  `monitor-remote`, `monitor-setup`, `monitor-startup`, `monitor-storage`,
  `now-playing-api`, `now-playing-source`, `observability`, `operations-cli`,
  `operations`, `process`, `runtime-preparation`, `runtime-state`,
  `runtime-transition`, `static`, `verify-boundary`, `verify-host-lifecycle`,
  `verify-paired` and `verify-plugin` (each `.test.ts`). Each exercises a part
  listed above, a vendored package or a command-line script, and follows the part
  that replaces it.
- **Test helpers** (`tests/helpers/`): `http-api.ts`, `runtime-fixture.ts`,
  `stand-in-hub.ts`, `verify-run.ts` (its listener and launch helpers are adapted
  in `modules/pixoo/tests/helpers/`). They follow the server, installer and
  verification adapter above.
- **Browser tests** (`tests/browser/`, each `.spec.ts`): `agent-dashboard`,
  `build-identity`, `controller-ui`, `dashboard-preview`, `foundation`,
  `local-operations`, `media-preview`, `monitor-controls`, `monitor-recovery`,
  `now-playing`, `protocol-fixture`, `runtime-restart`, `verify-capture`; and
  `playwright.config.ts`. Replaced by #843's browser checks of the Pixoo pages in
  the shell.
- **Vendored packages** (`vendor/`: 32 files of tarballs, checksums and receipts).
  Replaced by this repository's workspace packages.
- **Repository files**: `package.json`, `package-lock.json`, `eslint.config.mjs`,
  `.nvmrc`, `.editorconfig`, `.gitattributes`, `.gitignore`, `tsconfig.json`,
  `tsconfig.tests.json`, `vitest.config.ts`, `tests/workflow_checks.cjs`,
  `AGENTS.md`, `CLAUDE.md`, `README.md` and `.github/` (issue and PR templates and
  the CI workflow). Replaced by this repository's manifests, lint configuration,
  instructions, GitHub Actions CI and the files under `modules/pixoo/`.
- **Documentation and specifications** (`docs/`, 51 files, and `openspec/`, 242
  files). They stay in the archived repository; the runtime gets fresh
  specifications (#827).
