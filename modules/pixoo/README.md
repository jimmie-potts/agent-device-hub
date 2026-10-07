# Pixoo module

The Pixoo as a B.U.N.N.Y. runtime module, `pixoo`
([#843](https://github.com/jimmie-potts/agent-device-hub/issues/843), epic
[#827](https://github.com/jimmie-potts/agent-device-hub/issues/827)). It hosts
the Pixoo's library, player and presentation from divoom-app-upgrade, which
arrived as a snapshot for
[#25](https://github.com/jimmie-potts/agent-device-hub/issues/25). It follows
[ADR 0012](../../docs/decisions/0012-bunny-event-platform.md) and the
[module API](../../packages/sdk/README.md#modules) 1.1.

The runtime ships it (`pixooFactory` in `apps/runtime/src/modules.ts`), but
nothing installs it yet. The installed Pixoo service keeps running, unchanged,
from divoom-app-upgrade until the cutover
([#840](https://github.com/jimmie-potts/agent-device-hub/issues/840)), which
replaces it with this module. Until then, divoom-app-upgrade takes only bug
fixes. Mirror each fix here and name its source commit in the commit message.
The Pixoo pages are #932 and the library's migration is #931.

## Commands

Run these from the repository root with Node 24 (see
[Pixoo module checks](../../docs/development.md#pixoo-module-checks)):

```bash
npm run build          # includes tsc -p modules/pixoo/tsconfig.json, before the runtime
npm run typecheck      # includes the module, its tests and its fixtures
npm run test:pixoo     # builds, then runs the moved Vitest suite and the module's node:test suites
```

## Layout

| Path | Contents |
| --- | --- |
| `src/module` | The runtime module: `module.ts` (`createPixooModule`, `pixooFactory`), `control.ts` (command handling, `PixooControl`), `configuration.ts` (`configurePixoo`, `convertPixooSettings`), `transport.ts` (the HTTP transport and `SimulatedPixoo`), `schemas.ts` (its 2.0 families), `store.ts` (its own rows) and `render-worker.ts` |
| `src/core` | Shared schemas for requests, presentation settings, Monitor filters and Now Playing |
| `src/device` | The fake (simulator) adapter, the HTTP adapter and its transport, hosted GIF files, and the device qualification functions |
| `src/library` | SQLite catalog, playlists, checkpoints and media retention; `Library.attach` opens it in the module's database |
| `src/media` | Bounded rendering through sharp, GIF encoding and decoding, the media store and its child process |
| `src/playback` | The player, traversal and the library-backed store |
| `src/presentation` | Monitor presentation over `session/2.0`, the agent dashboard renderer, Now Playing cards over `playback/2.0` and the pixel font |
| `tests/unit`, `tests/integration`, `tests/helpers` | The moved Vitest tests, which run from `dist/tests` |
| `tests/module` | The module's node:test suites: the module test kit, its behavior and its configuration |

## The module

### Configuration

The module's section of the runtime's [configuration file](../../apps/runtime/README.md#configuration):

```json
{"pixoo": {
  "device": {"id": "pixoo-local", "label": "Desk Pixoo", "address": "192.168.1.50", "profile": "pixoo64-hosted-2026-10-01"},
  "hostedGif": {"bind": "0.0.0.0", "port": 41240, "origin": "http://192.168.1.10:41240"},
  "presentation": {"version": 1, "mode": "monitor", "filter": {}, "cadenceMs": 1000},
  "nowPlaying": {"version": 1, "media": "popup"},
  "playback": "presented"
}}
```

- `device.id` is the device's routing ID, unique across modules; `address` a
  private IPv4 address; `profile` an observed device profile, or
  `simulator-v1` for a simulated Pixoo only.
- `hostedGif` is the listener the device fetches hosted GIFs from; a real
  device with the hosted profile needs it.
- `presentation` and `nowPlaying` are where the settings begin. Once the module
  saves its own, those win.
- `playback` names the `playback/2.0` record Now Playing follows; without it,
  the playback owner's first record.
- The Pixoo's local API takes no token, so the module reads no secret.

`configurePixoo` refuses anything else with `invalid-request` and fixed text.
`convertPixooSettings({device, hostedGif, presentation, nowPlaying})` turns the
Pixoo service's `device.json`, `hosted-gif.json` and
`agent-monitor/{presentation,now-playing}.json` into this section, keeping the
Hub's device ID `pixoo-local`, for the installer
([#935](https://github.com/jimmie-potts/agent-device-hub/issues/935)).

### State

The module keeps only state it owns, in its SQLite file and its private folder:
- the library's catalog and the player's checkpoint, through `Library.attach`,
  with media under `media/`;
- its `pixoo_state` (revision counter, presentation and Now Playing settings,
  configuration revision, last outcome);
- `pixoo_commands`, the commands it accepted and has not completed;
- `pixoo_handled`, the commands it completed in the last 24 hours;
- the SDK's outbox.

Its copies of the core's `session/2.0` records and of the `playback/2.0` record
come from sync and are never stored. A copy that has not synced is tried again
after a doubling wait from 1 s to 60 s. An owner that has not answered since
the start, such as a playback owner that starts later, logs at DEBUG until that
wait reaches 60 s, then one warning. A copy that loses its owner warns at once,
and a recovery after a warning is one record.

### Families

It serves, through sync and as live states:
- `device/2.0` (#918), kind `pixoo`;
- `pixoo-display/2.0`: Monitor's mode, filter, cadence and sessions, what the
  presentation shows, Now Playing, and the player's state, item and last error;
- `pixoo-rendition/2.0` and `pixoo-playlist/2.0`: one record per catalog entry,
  with a removal when one goes.

A playlist holds at most 1,000 items, so every record fits the 256 KiB cap.
Every record carries the revision of its last change, from one stored counter;
a change that alters nothing publishes nothing. Today the SDK lets one owner
serve a family, so if another module already serves `device`, the Pixoo serves
only its own families, keeps publishing its device record and logs one ERROR
record. Hub #967 makes sync owner-addressed: every device module then serves
`device`, and a reader syncs the Pixoo's by naming `bunny/modules/pixoo` as the
owner.

### Commands

Each command goes to `bunny.cmd.<family>.<device id>`:

| Family | What it does | Its outcome |
| --- | --- | --- |
| `device-mode-set` | Monitor or Media | `observed` |
| `media-start` | Starts a playlist among the device's capabilities | Its first upload's |
| `media-control` | `pause`, `stop`, `clear`; `resume`, `next`, `previous`, `restart-with-changes` | `observed`; its upload's |
| `brightness-set`, `power-set` | Brightness, screen on or off | The device write's |
| `pixoo-media-show` | Shows one rendition, with an optional playback policy | Its upload's |
| `pixoo-monitor-set` | Monitor's filter and cadence | `observed` |
| `pixoo-now-playing-set` | Now Playing in Media: `off`, `popup` or `whole` | `observed` |
| `pixoo-playlist-change` | Creates, renames, sets options, items or order, duplicates or deletes a playlist | `observed` |
| `pixoo-asset-change` | Imports media (inline up to 160 KiB, or a file staged in `incoming/` under its SHA-256), renders an asset again or deletes it | `observed` |
| `pixoo-notice-dismiss` | Dismisses a finished turn on the Pixoo only | `observed` |

Before acting, the module refuses with the shared error body:
- a command that breaks its schema;
- a stale `expectedConfigurationRevision` or `expectedGeneration`
  (`revision-conflict`);
- what the device does not offer (`unsupported-capability`);
- a resume with nothing selected (`invalid-state`);
- an unknown rendition or notice (`not-found`).

Otherwise it stores its record of the work, replies `accepted`, runs the work
and reports the outcome through its outbox. The outcome commits with the
device's new pending count and last outcome. The rules for an outcome:
- **Transmitted.** A device write is `succeeded` with `transmitted` once the
  Pixoo answers: the answer is a transport acknowledgment, never an
  observation. A start, show, resume, next, previous or restart completes with
  its own first upload, found by the async context of the command's action, as
  ControlService tracked it.
- **Uncertain.** A write or upload that may have reached the device is
  `uncertain` with `uncertain-result`.
- **Answered with an error.** A failure the Pixoo answered reached it, so its
  evidence is `transmitted`, never `none`: an error status or code is `failed`
  (`invalid-state` for a refusal), and an answer that cannot be read is
  `uncertain`.
- **Failed.** One that did not reach the device is `failed`: `unavailable` for
  a device that did not answer, `cancelled` for one that a newer command
  superseded.
- **Observed.** A change to state the module owns (pause, stop, clear,
  settings, playlists, media, a dismissal) is `succeeded` with `observed`: its
  committed state, published in the same transaction, is the evidence.
- **Refused after acceptance.** A domain refusal after acceptance is `failed`
  with its registry code; any other failure once the work began is
  `uncertain`.

A repeated `(source, requestId)` is accepted again and changes nothing. A
command accepted before a restart and never completed is reported `uncertain`
at the next start and never runs again.

As ControlService did, a command that starts playback takes the display back
from Monitor, and any other player command interrupts Monitor. A stop, pause or
clear therefore cancels a pending Media selection at once.

`pixoo-notice-dismiss` sends `notice-acknowledge` to the core for the consumer
ID `pixoo`, so the finished turn clears on the Pixoo only.

### The device

Under policy A, the module's start opens only local resources: the database,
the private folder, the device writer, and the hosted-GIF listener for the
hosted profile. It probes the device afterwards, on the runtime's scheduler,
with a 2 s deadline: every 30 s while the device answers, and after a doubling
wait from 1 s, up to 30 s, while it does not. An unanswered probe makes the
device `unavailable`, never a module failure. A device that stays offline logs
one `device.unavailable` warning, and DEBUG summaries at most once a minute.
Its recovery logs one `device.available` record that counts the failed probes.

The device record's `lastTransmission` names the last send that the device
answered, for a command or for one of the module's own paints, never a probe.
Only a probe of the device sets `observed`.

A real device's start restores a saved Monitor selection; a simulated Pixoo's
start stays passive, as the Pixoo service's simulator did.

### Isolation

- **Media.** Decoding and rendering run in a forked child process with a
  256 MiB heap, killed with SIGKILL when the job is aborted. A corrupt,
  oversized or hostile image fails only its own job. An image that declares
  more pixels than the limit fails as `too-large` from its header.
- **Rendering.** Monitor dashboards and Now Playing cards render in worker
  calls. A failed render keeps the last picture, is tried again at the next
  cadence, and logs one warning per run of failures.

### Simulated transport

`SimulatedPixoo` is the in-memory writer from the Pixoo service's simulator,
behind a panel that keeps what it shows, as a real device does. It answers at
once (`online`), refuses to connect (`offline`) or never answers (`silent`).
`state()` reports what it shows: each frame's delay and the first 16 hex digits
of its SHA-256 (`frameDigest`). The runtime builds it under `--simulate`.
`SIMULATED_SECTION`, the factory's `simulatedSection`, configures that build:
device `pixoo-1` at `10.0.0.64`, outside the home network's range, with the
observed GIF profile, and names no secret. Tests and the `shipped` disposable
run use it. The scenario catalog and disposable runs pair the simulated Pixoo
with the playback module (#929) and its simulated speakers.

## Expected webcam results for the cutover

The cutover's physical check ([#840](https://github.com/jimmie-potts/agent-device-hub/issues/840))
watches the real Pixoo through the webcam. Physical accuracy is claimed only from
what the webcam shows, never from CI, simulator frames or a transport
acknowledgment.

| Case | How to produce it | What the webcam should show |
| --- | --- | --- |
| Monitor | `device-mode-set` `monitor`, with one agent session waiting for approval | One session filling the screen: a 20x20 tile at the top left in the activity's color with its icon, the provider mark and the activity word to its right, an amber APPROVAL chip, the session's label in two lines of large letters, and a summary strip at the bottom with the session count, `!1` in amber and the source and collector marks at the bottom right. The tile and chip pulse dimmer every 500 ms. Once approved, the chip goes and the picture holds still. |
| A Media item | Import an image, put it in a playlist and send `media-start` | The image scaled into 64x64, letterboxed in black; a GIF plays at its frame delays within the device profile. It stays for its dwell (30 s for a still, three plays for an animation) before the next item. |
| A Now Playing card | Monitor showing a session, then the playback record starts a track | For ten seconds: a green play marker and PLAYING at the top, a dark divider line, the title in light grey rows below the divider, then the artist in blue, all at full brightness for the whole ten seconds while the song plays on. A paused track shows an amber marker and PAUSED. After ten seconds Monitor's dashboard returns. With Now Playing set to `whole` in Media, the same bright card replaces the playlist for as long as the song plays, past 30 s, and the playlist comes back once the song stops. The card dims, with a `?` marker, only once the playback module marks the speaker stale. |

## Provenance

- Source repository: https://github.com/jimmie-potts/divoom-app-upgrade
- Source commit: `0777479c2fd7fbaca12d93e724ce8a2c15129b92`, "Add revision-bound
  Pixoo runtime upgrades and recovery (#138)", committed 2026-10-04 and still the
  head of main when read on 2026-10-06
- Full history stays in that repository, which is archived at retirement
  ([#839](https://github.com/jimmie-potts/agent-device-hub/issues/839)).

Paths in the edit list are relative to this folder unless they say "the
source's". Paths in the not-moved list are relative to the source repository.
At the move (#25), every copied file not named in the edit list was
byte-identical to its source. The module story (#843) then edited every file;
"Edits for the module" lists what changed.

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

### Edits for the module (#843)

- **One package.** The six `packages/<name>/src` folders became `src/<name>`,
  with relative imports instead of `@pixoo/*`, in one package,
  `@jimmie-potts/pixoo`. The tests compile with it and Vitest runs them from
  `dist/tests` (`vitest.config.mjs`), so files that the code forks or starts by
  path resolve beside it. Imports of `packages/<name>/dist` became `dist/src/<name>`.
- **Strict profile.** The code left staging: its 59 baselined findings and the
  strict rules' findings (non-null assertions, truthiness checks, async
  functions without await) were cleared, keeping behavior. A test's
  `present()` helper (`tests/helpers/present.ts`) replaces its non-null
  assertions. Two safe-error findings changed how an error is recognized, with
  the same result:
  - `library/files.ts` tells a busy owner lock by SQLite's code (`SQLITE_BUSY`
    or `SQLITE_LOCKED`), not by its message;
  - `media/render.ts` tells an image over the pixel limit by the size its header
    declares, read before decoding, not by sharp's message.

  Where only a defect could reach a missing value that the old code passed on,
  the code now fails at once: the player throws `no-context` for a missing
  record or current item, traversal throws `RangeError` out of range, a GIF
  whose decoded pixels are shorter than its frame fails as `invalid-input`, and
  the HTTP adapter refuses a profile name that is not a non-empty string.
- **Module boundary.** The media child process no longer writes its own
  diagnostic record or imports `@jimmie-potts/bunny-observability`; the module
  records each job. The presentation reads `session/2.0` and `playback/2.0`
  records (`presentation/sources.ts`, `agent-dashboard.ts`, `now-playing.ts`)
  instead of agent-state's 1.x snapshot and the Hub's playback snapshot, and
  renders through injectable renderers. The synthetic previews' frames are
  unchanged.
- **Additions.** `Library.attach` opens the catalog in a database the caller
  owns. `Player.probe` takes an optional shorter deadline.
  `MonitorPresentation` takes dashboard and card renderers.
- **Restored tests.** The three cases "immediately cancels a pending Media
  selection on stop, pause or clear with monitoring enabled" are back in
  `tests/unit/monitor-presentation.test.ts`, against `PixooControl`, which
  replaces `ControlService`.

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
