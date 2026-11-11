# Development setup

Use Node 24 from `.nvmrc` and run `npm ci` at the repository root. Read the
[delivery workflow](sdlc.md) before implementation. For current product work,
start with [runtime development](../apps/runtime/DEVELOPMENT.md); use the owning
module guide for its checks. Retained Hub/dashboard procedures are explicitly
legacy.

Build once, run the affected checks, then follow [app verification](app-verification.md)
for disposable acceptance and proof. Scenario selection and full-suite triggers
are in [runtime verification runs](../apps/runtime/DEVELOPMENT.md#runtime-verification-runs).
The headings below preserve existing links and route component detail to its owner.

## Codex explicit read receipts

Use Node 24, build, and run the focused receipt commands in
[runtime development](../apps/runtime/DEVELOPMENT.md#codex-read-receipt-checks),
then the shared type/lint, contract, SDK and workflow checks. The Runtime unit
tests CI job discovers these runtime tests. Native Desktop and installed acceptance remain
separate from source and disposable protocol checks.

[Documentation checks](documentation-checks.md) report source-pin drift and validate
current commands and paths in CI, including Markdown-only changes.

## Reachy simulator checks

Use Node 24. The runtime and browser harness no longer needs Linux: the runtime
unit suite, the scenario catalog and the runtime dashboard browser journeys run
[natively on macOS](../apps/runtime/DEVELOPMENT.md#native-runs-on-macos). The
Reachy suites have not been measured natively on macOS. Build first, then run `npm run test:reachy:built`,
`npm run test:reachy:browser`, event/SDK/runtime consumers and the shared
build/type/lint/workflow checks. The modules and browser CI jobs run those
checks. Module conformance, transport, storage/restart and policy tests use
synthetic state and isolated simulated targets. The actual pinned vendor
MuJoCo exercise and physical/installed acceptance remain separate evidence.
See [the module guide](../modules/reachy-mini/README.md).

## Art checks

Scheduled art (#684) extends the existing runtime automation owner. After the root
build, run `npm run typecheck`, `npm run lint:js`, `npm run test:events:built`,
`npm run test:art:built`, `npm run test:weather:built`,
`npm run test:tidbyt-module:built`, `npm run test:pixoo:built`,
`npm run test:runtime:built`, `npm run test:runtime-dashboard:built` and
`npm run test:art:browser`. The existing event, module and runtime CI
globs discover the new contract, policy/claim, producer and display cases; the
App verification runtime group runs the schedule journey through the existing Art browser check. Keep the
shared controller contract, Python consumer, package and workflow checks.

The focused contract check is
`node --test packages/event-contracts/tests/art-schedule.test.mjs`. The bounded
clock/store cases are `apps/runtime/tests/art-schedule.test.ts`; the finite
`art-schedule` scenario uses real owners and synthetic providers/transports.
After building, select it with
`node --test --test-name-pattern='art-schedule' apps/runtime/dist/tests/scenarios/catalog.test.js`.
The finite scenario checks one saved-art rain appearance, disabled-source zero
reads, exact submitted frame hashes and independent 10-second Pixoo and
30-second Tidbyt outcomes. Its portable capture is bounded at 240 seconds.
Manual-clock cases in the policy suite, `art-plans.test.ts` and
`modules/art/tests/scheduled.test.ts` separately cover persisted 45-minute
spacing, held preparation, revocation, renewal, restart and lost outcomes.
Those cases are not claims about the portable recording. Browser checks cover
revision conflicts and expiring labels on actually decoded art. Inspect the
recorded native frames separately. These checks use only synthetic providers
and transports, with no installed-runtime contact.

Shared saved-art presentation (#297) uses the existing CI discovery. After
`npm run build`, run `npm run typecheck`, `npm run lint:js`,
`npm run test:events:built`, `npm run test:art:built`,
`npm run test:runtime:built`, `npm run test:runtime-dashboard:built` and
`npm run test:art:browser`. The event suite checks the closed additive
`art-auto/2.1` and `art/2.1` contracts and unchanged 2.0 payloads;
`modules/art/tests/shared-art.test.ts` checks durable preparation, selection,
pruning and restart; `apps/runtime/tests/art-plans.test.ts` checks configured
identities, current capabilities, independent deadlines and tracked results.
The existing Art browser check covers selected off-page content and obsolete
loads. Keep the retained contract, Python, package and workflow checks described
below. Profile 2.1 adds no Python mirror.

The `shared-art` runtime scenario exercises one saved idea through the real
producer, core tracker, browser, Pixoo and Tidbyt against synthetic transports.
After building, focus it with
`node --test --test-name-pattern='shared-art' apps/runtime/dist/tests/scenarios/catalog.test.js`.
The existing runtime scenario and verification CI globs discover this path;
`scenario-shared-art` is the disposable capture. It verifies zero provider calls
during reuse, independent target results and no replay, without a device or
installed-runtime claim.
Its named `presentation-fixture` module calls the real core's internal presentation
control only after a new synthetic request completes. It adds no production
command route. Initial sync after restart seeds its seen IDs without dispatching.
Its tier-1 case allows 60 seconds because it observes the Tidbyt's complete
qualified 30-second hold as well as generation, preparation and restart. Other
catalog cases keep their existing 20-second default.

Showing saved art now (#1581) uses the same discovery. After `npm run build`,
run `npm run typecheck`, `npm run lint:js`, `npm run test:events:built`,
`npm run test:art:built`, `npm run test:runtime:built`,
`npm run test:runtime-dashboard:built`, `npm run test:art:browser` and
`npm run test:mcp`. The event suite checks the closed `art-show/2.0` fixtures;
`apps/runtime/tests/art-show.test.ts` runs the real core with synthetic art,
Pixoo and Tidbyt owners for per-surface operations, refusals, restart and the
owner permit; `art-schedule.test.ts` proves on the manual clock that a show in
quiet hours leaves the schedule's claims, count, spacing and next appearance
unchanged; `gateway.test.ts` and `automation-routes.test.ts` cover
`core_art_show` and the targets read. The Art browser check's Show now journey
uses the simulated Tidbyt and reads Recent attempts. The `art-show` runtime
scenario shows saved art on the simulated Pixoo, Tidbyt and browser; focus it
with `node --test --test-name-pattern='art-show' apps/runtime/dist/tests/scenarios/catalog.test.js`
on Linux, or natively on macOS with
`node scripts/native-test.mjs test:runtime:scenarios:built -- --test-name-pattern=art-show`. None of these checks
contacts a provider, an installed runtime or a physical display.

Art-derived decoration (#683) uses `npm run test:art-theme:browser` after the
root build, in the existing App verification runtime group and full local
dashboard browser suite. Bounded palette and preference cases are discovered
by `npm run test:runtime-dashboard:built`. Keep shared build/type/lint,
contract/package and workflow checks; no new backend contract is introduced.
See the runtime dashboard guide for synthetic theme and zero-effect evidence.

The adaptive widget and Gallery checks for #682 use
`npm run test:art:browser` after the root build. They run in the existing App
verification runtime group and the full local runtime dashboard browser suite.
See [runtime dashboard checks](../apps/runtime/DEVELOPMENT.md#runtime-dashboard-checks)
for viewport, interaction, private-content and synthetic-provider evidence.
Home metadata validation uses `npm run test:events:built`, core persistence uses
`npm run test:runtime:built`, and frontend models use `npm run test:art:built`
and `npm run test:runtime-dashboard:built`; these are already discovered by CI.
Keep shared build/type/lint, contract/package and workflow checks. These checks
never qualify an installed provider or physical display.

Use Node 24. Run `npm run test:art` for the spending ledger, the catalog, local image
work and the provider adapters, or build once and run `npm run test:art:built`. The
modules CI group runs the built suite. Tests use fake providers through the transport
seam and synthetic images, so no key is read and nothing reaches a provider. Run the
shared build/type/lint/workflow checks, `npm run test:events:built` for the `art` state
family, and `npm run test:runtime:built`, whose shipped-module run and upgrade preflight
cover its registration. A contract change to the diagnostic profile also needs
`npm run test:observability`. Real generation and the GIF rejection rate belong to
installed acceptance in #687. See [the module guide](../modules/art/README.md).

The registered `art-theme`, `art-gallery`, `art-catalog` and `art-spending-limit` scenarios run through both
runtime transports in `test:runtime:scenarios:built`. They use synthetic GIF/still
providers with fixed billed usage and the real authenticated commands, catalog,
ledger and private store. They cover favorite/reuse/variation, invalid bytes, lost
responses, restart without replay, recent retention and the monthly ceiling.
After building, focus them with
`node --test --test-name-pattern='art-theme|art-gallery|art-catalog|art-spending-limit' apps/runtime/dist/tests/scenarios/catalog.test.js`.
On a Mac, run it natively ([Native runs on macOS](../apps/runtime/DEVELOPMENT.md#native-runs-on-macos))
or with `npm run test:runtime:container -- --suite scenarios`.

For local theme controls, select `scenario-art-theme`; its labelled capture shows
contrasting saved art, locking the colors, restoring defaults and following again,
with no additional provider call or device command. The simulation's warm/cool
fixtures pass through the real pixel palette processor.
For the actual gallery UI, select `scenario-art-gallery`; its capture uses visible,
labelled controls and leaves decoded synthetic art on screen. For the producer API
exercise on a clean committed candidate, select `scenario-art-catalog` through the [portable route](../apps/runtime/verify/PORTABLE.md).
Its recording opens the saved synthetic rendition through the real authenticated
content route, using a labelled review-only link in the existing shell. It adds no
gallery UI and exercises no real provider or device. The rendition remains visible
in the final screenshot. The separate `scenario-art-spending-limit` capture covers
the ceiling and restart. Existing
`test:runtime:verify:built` discovery runs these captures; on a Mac use
`npm run test:runtime:container -- --suite verify`. Inspect the complete video and
scenario-result attachment before assessing acceptance.

## Wemo checks

Use Node 24. Run `npm run test:wemo` for configured local SOAP transport and module
checks, or build once and run `npm run test:wemo:built`. The modules CI group runs
the built suite. These use loopback HTTP and simulated plugs, never household
addresses. Runtime maximum-on, management and scheduling integration use
`npm run test:runtime:built` and `npm run test:wemo:browser` (desktop/phone layout), plus the dashboard checks under
`apps/runtime/DEVELOPMENT.md`. Build/type/lint, shared contract/workflow checks,
independent review, installed qualification and named physical trials remain separate.

## Volcano checks

Use Node 24. Run `npm run test:volcano`, or build once and run
`npm run test:volcano:built`, for `modules/volcano` (the facts, session derivation,
store, reads and module conformance), the fake-noble adapter in
`apps/volcano-collector` and the collector's fake-transport suite
`apps/runtime/dist/tests/volcano-collector.test.js`. The modules CI group runs the
built suite. `npm run test:volcano:consumer:built` checks the shipped registration,
the read schemas under a strict standalone compiler and that the root lockfile has
no Bluetooth binding; the runtime CI group runs it. The edge admission, gateway
reads, tracked threshold and the absence of usage from core history are `apps/runtime/dist/tests/volcano-gateway.test.js`
and the `volcano-physical-use` catalog scenario, under
`npm run test:runtime:built`, which read an edge configuration file and run on
Linux or natively on macOS. All of these use synthetic values and no radio. They do not qualify the
binding, the macOS launch path, or the owner's firmware; that is #617.

The card (#616) adds `modules/volcano/tests/card.test.ts` to the built suite and
`npm run test:volcano:browser` to App verification. After the root build, the browser
journey drives the real module and store over a synthetic feed: Home and Devices placement,
passive tabs, fixed geometry at each Home size and at light and dark desktop and phone
widths, keyboard access, one tracked threshold save that rewrites no fact, and
unknown rather than off. It then mounts the card over fixed documents for the stale,
unavailable, refused, no-history, partial-session, discontinuity and recovered-gap states. It
runs in Linux. `DASHBOARD_RECEIPTS` names a folder for its screenshots.
`apps/volcano-collector` is not a workspace, so `npm ci` at the root installs no
native dependency and the root build compiles its adapter against its own types of
noble.

## Weather checks

Use Node 24. Run `npm run test:weather` for the National Weather Service client,
the owner and SDK conformance, or build once and run `npm run test:weather:built`.
The modules CI group runs the built suite. Tests use synthetic coordinates and
recorded synthetic responses through a fake transport, so nothing reaches the
service. Run the shared build/type/lint/contracts/workflow checks and
`npm run test:runtime:built`, whose shipped-module run and upgrade preflight cover
its registration. A real-service check belongs to installed acceptance in #687.

## Current architecture diagram

The current runtime view is authored in `docs/runtime-architecture.json` and
rendered to `docs/runtime-architecture.html`, independently of Work Guide.
Read [architecture](architecture.md#current-runtime-and-evidence) for its source
baseline, semantic review triggers and evidence limits. Using the centrally
installed archify skill, run its `validate architecture` and `deliver architecture`
commands with `--quality showcase --json`, then `visual-check` on the exact HTML.
Require nine artifact checks, no errors or warnings, and browser containment.
Inspect both themes visually. Keep screenshots and receipts outside Git.
A passing render does not establish source alignment or installed acceptance.

## System design documents

The HTML under `docs/system-design/` preserves the September 19, 2026 design
snapshot. Its implementation labels and issue states describe that baseline;
GitHub issues and owning application guides supply current status. The current
[SDLC UI policy](sdlc.md#ui-approval-scope) supersedes this snapshot’s obsolete
human UI approval wording. Routine product delivery does not rebaseline it. For an intentional snapshot revision,
edit `source/*.html` and `design.json`, then regenerate the overview, component
pages and complete reading view. `assets/` holds the shared style and browser
behavior. The inventory records the template set and source revision receipts.
The atlas pages take their colors from the token files in
`docs/skins/`; `python3 docs/skins/check_tokens.py`, which `check.py` also runs,
fails on a color literal in their styles. The API and database reference under `reference/` keeps its
own stylesheet and bundled viewers and is outside that check.

```bash
python3 docs/system-design/build.py
python3 docs/system-design/build.py --check
python3 docs/system-design/check.py
node docs/system-design/check.cjs
```

The overview's system map and agent observation walkthrough are not authored
under `source/`. They come from the shared definitions `D2` and `D3` in
`docs/diagrams/architecture_diagrams.py`, their Archify renderings under
`docs/diagrams/legacy/rendered/`, and the atlas-owned link inventory
in `design.json` (`map`). To change either diagram, edit the definition, render
with the installed archify skill (`ARCHIFY_DIR=... python3
docs/diagrams/architecture_diagrams.py`), rebuild the atlas and run the [independent diagram checks](diagrams/README.md). `check.py` fails when a saved specification or rendered
SVG no longer matches its definition or receipt.

The generator and static check use Python's standard library. Browser checks use
installed Playwright/Chromium, with `DOCS_PLAYWRIGHT_MODULE` and
`DOCS_CHROMIUM_PATH` overrides. `BUNNY_DESIGN_RECEIPTS` selects
an external screenshot/PDF/receipt directory; the default is a temporary folder.
The Retained documentation checks job runs these checks in Workflow. See the
[diagram ownership and validation guide](diagrams/README.md).

The API/database reference is linked from the design navigation. Its Scalar
viewers embed three source-pinned OpenAPI documents; SchemaSpy reports cover the
three existing SQLite schemas. Keep `docs/system-design/reference/` together
when copying the HTML. Bundled assets allow offline browsing. Request controls
are disabled here; the owning services retain their origin and credential rules.
The database reports are generated from fresh empty schema fixtures, never live
controller files. This dated reference does not describe the current runtime store; its schema
is owned by the [runtime guide](../apps/runtime/README.md#state).

`check.py` also verifies reference generation, the REST/SSE route inventory,
all 28 table definitions, source pins, local links and bundled asset receipts.
`check.cjs` adds Scalar search/operation checks, all table columns and offline
desktop/mobile browsing. Refresh commands and tool prerequisites are in the
[HTML runbook](system-design/components/OPS-runbook.html#OPS-runbook-6).
Download URLs, versions and checksums are recorded in `reference/tools.json`.
Schema extraction needs the pinned Git objects; normal verification uses the
committed extracts. No remote schema or controller is queried by the checks.

The diagram JSON is rendered by the installed archify skill. Keep its validated
HTML and specification together. Browser screenshots and local delivery receipts
remain outside Git. This documentation workflow starts no application, installs
no hooks and contacts no devices. Product contracts and runtime acceptance remain
with their existing owners. No new OpenSpec capability is introduced by the atlas.

Hub #278 adds the shared Places manifest under `docs/skins/`. Run
`python3 -m unittest docs/skins/test_places.py` for its order, destination and
local/public link contract; `docs/system-design/check.py` includes that test in
the Retained documentation checks job. Run the public exporter into a new disk-backed scratch
directory and inspect `atlas/manifest.json`'s `placesPages`: every exported HTML
page must carry the public Places strip. The dashboard browser suite checks its
sidebar destinations and that rendering them sends no controller request. The
Nanoleaf return link is owned by codex-nanoleaf #189 and has separate source and
UI acceptance. Hub #495 lets a verification preview's Hub replace or omit the
dashboard's Local places through `placeLinks`.
`apps/dashboard/tests/preview-places.mjs`, part of
`npm run test:dashboard:browser`, covers three cases: a paired Wall link, a
Hub-only preview with no Wall link and the unchanged unconfigured Hub.
`apps/hub/tests/dashboard.test.mjs` covers the validation.
Run `node docs/skins/check_places.cjs` after generation for the source-page
inventory, 390 px navigation and screenshots. The Retained documentation checks job runs it with
the pinned Chromium alongside the retained atlas browser checks.

For an authorized public atlas publication, export from the exact validated Hub
revision with `python3 docs/system-design/export_public.py /absolute/new/site-stage`.
The exporter stages nine architecture viewers and the atlas reading pages, bundled reference assets and
downloadable schema/API metadata under `site-stage/atlas/`. It records atlas
hashes in `atlas/manifest.json` and rewrites links for the public layout. It
does not create a root landing page or change the separate deployed site. Run it against a clean
`git archive` as well as the worktree; the archive check catches missing tracked
SchemaSpy assets. The public-repository PR copies the exported bytes verbatim.

## BB-8 retained qualification

[The original qualification](bb8-controller-qualification.md) is retained as
historical evidence. BB-8 is hibernated indefinitely: no feature development,
robot test, helper start or default verification is selected. The active
[hibernation policy](#bb-8-hibernation) supersedes its earlier test-registration
and physical briefs. Resumption requires a new owner decision.

## ONN qualification

The owner retired the ONN device on 2026-11-05. ONN is hibernated indefinitely under [#1464](https://github.com/jimmie-potts/agent-device-hub/issues/1464). Its source, private stores, schemas and compatibility readers are retained. Runtime/frontend registration, controls, observations, history pages and dedicated default checks are inactive. Resumption requires a new owner decision and restored verification. [#1465](https://github.com/jimmie-potts/agent-device-hub/issues/1465) owns installed deactivation; source changes alone do not establish it. Earlier qualification descriptions below are historical.

[ONN controls qualification](onn-controls-qualification.md) records the selected
host ADB route, owner-approved native dependency, physical evidence and minimum
controls contract. The [ONN module](../modules/onn/README.md) implements those
controls through the existing dispatcher, SDK outbox and shared dashboard.
Its [checks](#onn-module-checks) preserve the distinction between source,
simulated, protocol, installed-client and physically observed evidence.

[ONN title-history qualification](onn-history-qualification.md) records the
approved fixed read-only metadata reader, selected-title semantics and minimum
retention/query contract. It does not claim production or installed history.

[ONN dashboard display qualification](onn-dashboard-qualification.md) records
how the shared dashboard reaches the TV's browser through the Mac private
route, the read/control permission decision, the owner's device setup and the
checks to record on the actual ONN. Its source evidence is the television
keyboard journey under
[runtime dashboard checks](../apps/runtime/DEVELOPMENT.md#runtime-dashboard-checks);
it qualifies no TV browser or device.

### ONN focused-text admission checks

The dedicated ONN admission suite is dormant. Keep core historical omitted-text identities and private digest behavior covered by the active `apps/runtime/tests/art-handoff.test.ts` regression. Run it after build using the owning runtime test environment.

## Roborock transport checks

`modules/roborock/transport` owns the read-only V1 transport from Hub #1070. The root module has separate observation, consumer and browser checks described below.
Its [guide](../modules/roborock/README.md) records the protocol provenance,
private setup boundary and synthetic verification. The source transport has no
runtime registration, collector or served page; #376 owns those consumers.

Use Node 24 from the assigned worktree root. Register these checks before
transport implementation, then build once and run:

```bash
npm ci
npm run build
npm run typecheck
npm run lint:js
npm run test:roborock-transport:built
npm run test:roborock-transport:consumer:built
npm run test:sdk:built
npm run test:events:built
npm run test:contracts:built
npm run test:runtime:built
npm run check:workflow
npm run test:workflow
```

`test:roborock-transport` builds first for a standalone run. The core CI job
runs both `:built` commands after its fresh root build. Tests use synthetic
credentials, TCP/MQTT/account peers and independently authored byte vectors.
They cover the six final-sender RPCs and prohibited calls, framing/correlation,
private files, bounded map inflation, deadlines, disconnect, cancellation and
stop. The consumer check exercises the exported transport entry, registry
errors and generated runtime module registry. The nested source package is not
a direct module manifest; #376 adds the complete runtime registration. No test uses an owner session, vendor endpoint or physical robot.
Record the allowlist/decompression negative control with the candidate's local
checks; source success does not establish account, installed or firmware
compatibility. Runtime/page/MCP and live-run acceptance stay with #376.

## Release qualification

The manual [release qualification workflow](../.github/workflows/release-qualification.yml)
runs the existing full Checks and Workflow coverage for one integrated revision.
Select a branch or tag currently at the full immutable candidate SHA:

```bash
gh workflow run release-qualification.yml --repo jimmie-potts/agent-device-hub --ref <branch-or-tag-at-candidate> -f candidate=<full-SHA>
```

The candidate must already be reachable from main. The run refuses if the selected
ref moved away from the requested SHA before dispatch. Each accepted run inherits
that fixed event revision for all checkouts. The active candidate stays fixed;
GitHub concurrency retains only the newest pending run and never cancels active
qualification for a newer arrival. Omitted revisions have no qualification result.
The manual path leaves current PR/main gates in force until their separate activation.

Qualification builds a native Linux ARM64 production image from the closed committed
source exporter, then runs every scenario and every packaged verification test file except the
exact checkout-only `build.test.js`. The in-image launcher prints its complete
inventory and exclusion. The full source verification job still runs that file;
its Git inventory assertion needs the checkout metadata the sealed image excludes.

The `Packaged ARM64 build` job builds and saves the image and uploads its archive.
Three `Packaged ARM64 verification` jobs then test that archive in parallel
([#1512](https://github.com/jimmie-potts/agent-device-hub/issues/1512)). Each one
downloads only its own attempt's archive. It refuses the archive before loading
it unless its SHA-256 matches what the build reported. After loading, it refuses
the image unless it matches the archive's manifest and the reported identity.
Only then does it build the test derivative on the image. The lanes split the
inventory between them:

- `scenarios`: the scenario catalog files and the backup helper suite.
- `captures`: the odd-numbered capture cases of `steps.test.js`, and its other tests.
- `verification`: every other packaged verification file, then, in a separate
  process, the even-numbered capture cases.

`BUNNY_CAPTURE_SHARD=<index>/<count>` selects a share of the capture cases, so
the two shards run each case once. The launcher sets it only for the capture
file's own process and drops an inherited value, so the variable can never
shrink another run. Unset, as in source CI, `steps.test.js` runs every case. The
verification files stay serial within their lane.
`Packaged ARM64 image` runs only after the build and all three lanes pass, and it
passes the image identity to the receipt, so the receipt's job names are unchanged. A rerun
of failed jobs cannot reuse an earlier attempt's archive: after a lane fails,
rerun all jobs.

Each lane's packaged suites have a 45-minute process deadline and a 30-second
kill grace. Each lane job has a 60-minute limit for download, load, the
derivative build and its tests, and the build job has 20 minutes. A timeout
fails qualification. It never admits a partially tested image.
All packaged browser, negative-control, adapter, boundary, drain,
follow, guard, health, HOME, journal, migration, run and supervisor tests remain.
Docker's init reaps orphaned test processes. Containers have synthetic state and
no host mounts, ports, network or devices. This qualifies source and packaged bytes, not an installed client.

Each run attempt retains two 14-day Actions artifacts.
`release-image-<SHA>-<run-ID>-<attempt>` holds `production-image.tar.gz`.
`release-evidence-<SHA>-<run-ID>-<attempt>` holds `qualification.json`.
New receipts for the selected Mac/containerd lane record the saved single OCI
manifest's digest as the immutable image ID. The producer verifies the raw
manifest/configuration hashes and sizes, tested production config, ordered
DiffIDs, source, Linux ARM64 platform and user `1000:1000` before emitting metadata.
It keeps its local Docker ID only for building, testing and saving. Gzip layer
content digests and uncompressed DiffIDs are checked separately. The release
archive reader streams USTAR entries without extraction, with a 120-second limit,
8 GiB limits for compressed, decoded and expanded bytes, at most 512 entries,
1 MiB per retained JSON candidate and 8 MiB total retained metadata. Unsupported,
ambiguous, corrupt or mismatched archives refuse. Existing receipts are never
rewritten, and strict consumer/helper/container ID comparisons remain unchanged.
This qualifies the selected Mac lane, not identical Docker IDs across all stores.
The receipt also records the archive's SHA-256, architecture, source/evaluation
revision, evaluation input hashes and actual required job results. It distinguishes
qualified, failed and incomplete work.
Unavailable/cancelled work or an expired artifact cannot qualify a newer revision.
Retries explicitly select the same candidate and keep their own attempt identity.
The producer checks the actual unique unexpired image artifact before reporting
qualified. Copied successful jobs without that current-attempt artifact remain
incomplete; a result-only retry cannot invent its image artifact.

Consumers must verify the authentic repository, workflow, run, attempt, source,
completed job results and unique unexpired artifacts through GitHub, then verify
the downloaded archive hash and loaded image identity. A copied JSON file alone
is insufficient. `scripts/release/qualification.mjs` supplies the closed validator
and expected job names. No qualification command contacts the installed runtime.
The expected names are exact, so a receipt from a revision with another job set,
such as one qualified before the runtime test jobs were added (#1506), validates
only with the operator scripts of its own qualified revision, as the
[deployment route](bunny-container.md#deploy-a-qualified-batch) already requires.

Use Node 24 and `npm ci`, then `npm run build`, `npm run lint:js`,
`node --test scripts/release/tests/*.test.mjs`, `npm run check:workflow` and
`npm run test:workflow`. CI's core job includes the focused evidence tests.
Record hosted elapsed time and summed job-minutes with setup, retries and any
temporary duplicate broad runs. Identify the comparison revision and runner
differences; job-minutes do not establish invoice savings.

## Workflow commands

Use Node 24 and npm from the assigned worktree root. If `node --version` does
not report v24, prefix each command with `fnm exec --using=.nvmrc --`, for
example `fnm exec --using=.nvmrc -- npm ci`. fnm reads `.nvmrc` from the current
directory and needs no shell setup, so the prefix also works in noninteractive
agent shells. The prefix applies to every Node 24 command in this document.
Reuse one shared Node 24 installation instead of installing Node for each task;
if fnm or its Node 24 is missing, report the missing prerequisite.

```bash
npm ci
npm run check:workflow
npm run test:workflow
```

Both checks must exit zero. The specification inventory is the folder list
under `openspec/specs/`, and `check:workflow` validates every spec in it; report
that list, not a copy kept here.

OpenSpec 1.12.0 is pinned locally. Use npm run openspec -- <arguments>. Its wrapper
isolates configuration and suppresses telemetry/completion migration. Initialize
using init --tools none --profile core --no-animation. Do not generate local
skill integrations or run a global OpenSpec installation. OpenSpec 1.12 rejects
a MODIFIED requirement delta that drops or renames one of its scenarios; use a
REMOVED delta for the old requirement plus an ADDED delta for the new one.

Use npm's default cache and Playwright's default browser cache (on Linux and
WSL, `~/.npm` and `~/.cache/ms-playwright`), not directories under `/tmp`, which
can be a small RAM-backed filesystem shared by every session. If a sandbox makes
either cache read-only, report that instead of redirecting it. Keep dependency
caches, browser binaries and all runtime state outside source.

GitHub Actions runs the active workflows under `.github/workflows/` on
GitHub-hosted Ubuntu runners. Depot CI ran them under `.depot/workflows/` until
[#870](https://github.com/jimmie-potts/agent-device-hub/issues/870). They run on
ready pull requests and report each job as a named GitHub check. Main runs
cheap integration checks and queues pinned release qualification. Superseded PR
revisions are cancelled per workflow and PR; an active qualification finishes
while new arrivals replace the pending candidate. Each job has a ten-minute timeout, except the
select and gate jobs' five, the Workflow job's fifteen, the retained documentation
job's twenty-five, Runtime verification's forty-five, and forty for Core, the two
runtime test jobs and App verification. Branch pushes do not duplicate PR checks.
Core's finite 40-minute aggregate limit leaves headroom after full selections
exhausted the previous 30-minute cap ([#1388](https://github.com/jimmie-potts/agent-device-hub/issues/1388)).
The runtime's unit and scenario suites left Core for the Runtime unit tests and
Runtime scenario tests jobs, each under the same 40 minutes, when Core's slowest
passes came within a minute of its limit ([#1506](https://github.com/jimmie-potts/agent-device-hub/issues/1506);
measurements under [CI cost and suite timings](#ci-cost-and-suite-timings)).
Packaged ARM64 qualification runs in three parallel lanes under the unchanged
45-minute process deadline ([#1512](https://github.com/jimmie-potts/agent-device-hub/issues/1512)).
In one serial job, its packaged suites grew from 1,914 s on main `50acae82` to 2,582 s
on `0098927f`, then passed the 2,700 s deadline on `4c42b933`. In that run the
scenario catalog took 841 s and `steps.test.js` 1,686 s before the interruption;
`scenario-art-schedule` alone took 165 s. From that run's case times, the lanes
take about 844 s (`scenarios`), 862 s (`captures`) and 1,241 s (`verification`),
so the longest lane leaves about 24 minutes of headroom. Each extra lane adds its
own runner setup, archive download and derivative build, about three minutes.
Runtime verification has a separate 45-minute job limit alongside the existing
per-test deadlines. Two full catalog attempts
reached the previous 35-minute limit before all cases reported their results
([#1497](https://github.com/jimmie-potts/agent-device-hub/issues/1497)).
The previous increase to 35 minutes followed a passing verification step in a
qualification job that exhausted its 30-minute aggregate limit
([#1391](https://github.com/jimmie-potts/agent-device-hub/issues/1391)).
Hosted runners sometimes stall in apt, in `apt-get update` or in a browser
install's `--with-deps` downloads, until the job's limit. So every apt command in
CI runs through `scripts/apt-retry.sh` (#862): the browser installs in App
verification, Runtime verification and retained documentation, with 300 s per attempt, and the hook-qualification
step's `apt-get update` and `apt-get install`, together, with 180 s per attempt.
The runner image already makes apt drop a connection that receives nothing for
15 s and fall back to the next mirror in `/etc/apt/apt-mirrors.txt`, but a
download that still trickles never times out. After a failed attempt, the script
stops the apt-get the attempt left running, waits up to 60 s for apt and dpkg to
exit and runs `dpkg --configure -a`. It then moves the mirror apt tried first to
the end of that list, so the retry starts on another mirror; it makes three
attempts in all. The step limits (20 minutes for the browser installs, 14 for the
hook step) and the job limits leave room for two stalled attempts. Because it
changes apt's configuration and stops every `apt-get`, the script refuses to run
unless `GITHUB_ACTIONS` is `true`.
Active workflow files are `checks.yml`, `workflow.yml`, `integration.yml`,
`release-qualification.yml` and `codeql.yml`. The Work Guide
workflow and its path exceptions are removed. The existing Workflow workflow
owns both Workflow checks and Retained documentation checks.

Checks admits ready pull requests. Ordinary Markdown selects no product suite;
delivery/validation policy retains the full gate. Draft updates skip expensive
admission jobs. Keep checkpoint work in draft, then mark a stable candidate ready
for review. Branch backup pushes without a ready PR do not start release
qualification. Ready/fix rounds run the [affected gate](#affected-pr-checks).
Main has no redundant direct broad Checks/Workflow run. Its integration result
and separate release qualification retain their own exact-revision evidence.
Inspect complete changed paths and hosted event/check records; missing results
alone never establish filtering. Tag pushes trigger no main integration.
Static tests check configuration; hosted readback verifies actual scheduling.

Product CI jobs run `npm run build` once, then use the `:built` variants of the
TypeScript and package test commands. These variants require output freshly
built in that same job. The existing standalone commands still build first and
stop if compilation fails. Python setup caches pip downloads by runtime,
platform and `requirements-contracts.txt`; dependency installation still runs.
No installed dependencies or compiled output are shared between jobs.

Locally, `tsc` never removes output whose source was deleted, renamed or exists
only on another branch. The suites that run compiled tests
(`test:sdk:built`, `test:runtime:built`, `test:nanoleaf:built` and
`test:playback:built`) run every
file under their `dist/tests/`, and the package scripts copy their package's
whole `dist/`. After switching branches or rebasing, delete the affected `dist/`
before building; a stale Nanoleaf test file once failed a local run.

Admission has ten GitHub-hosted Linux jobs with selected steps/jobs skipped.
Full release source coverage reuses those same jobs, then adds its pinned ARM64
artifact checks. Its evidence remains separate from the cheap Integration job:

| Check | Runtime and coverage |
| --- | --- |
| Select affected checks | Node 24 with only `scripts/ci-selection` checked out: maps the PR's changed paths to check groups |
| Workflow checks (Workflow workflow) | Node 24 workflow validation, the affected-check selection fixtures, delivery preflight fixtures and isolated Linux hook qualification. It also runs for Markdown-only changes. |
| Build, lint and core tests | Node 24, and Python 3.14 when the shared group is selected, in one job: one build, then typecheck, [static analysis](#static-analysis), every kept Node `:built` suite and package consumer (SDK, events, lifecycle, agent state, the Pixoo module with Vitest and node:test, the Nanoleaf port, the playback, LIFX and Tidbyt modules, MCP, Wispr, observability and CHOMPI bridge), the 1.x controller contracts' Node tests, the unit tests of the old dashboard and the runtime's dashboard, and the Python observability, event, lifecycle and agent-state consumers |
| Runtime unit tests | Node 24 build, then `npm run test:runtime:built`, when the runtime group is selected |
| Runtime scenario tests | Node 24 build, then `npm run test:runtime:scenarios:built`, the scenario catalog over both transports, when the runtime group is selected |
| Firmware | Host-compiled CHOMPI controller tests with sanitizers, then the ARM build with the pinned toolchain and the artifact check |
| Retained documentation checks (Workflow workflow) | Python 3.12 diagram/atlas/navigation and maintenance-parser checks, plus Node 24 browser checks with review artifacts |
| App verification | Node 24 build, Chromium, the app-verify core's receipt and unsupervised capture tests and its isolated archive consumer, the CHOMPI bridge adapter's steps, the bridge control page's browser check, the smoke checks of the old dashboard and the runtime's dashboard, and the observability contract's browser check; lifecycle tests skip with a printed reason when the runner has no systemd user manager |
| Runtime verification | Node 24 build and Chromium, then the unchanged full serial runtime adapter/catalog suite, including its browser journeys; the same user-manager isolation applies |
| Selected checks gate | Node 24 with only `scripts/ci-selection` checked out: fails unless every selected Checks job succeeded |

A full Checks run performs five full builds across its jobs. The Python
suites run on Python 3.14 only, the version of the installed Nanoleaf runtime.
Jobs that name `ubuntu-latest` run on whichever image GitHub maps it to. GitHub
moves that label from Ubuntu 24.04 to Ubuntu 26.04 between 2026-10-19 and
2026-11-19 ([actions/runner-images#14748](https://github.com/actions/runner-images/issues/14748)),
so until then a job may get either image and every job must pass on both. Checks
that call the runner's system `/usr/bin/python3`, such as the Linux performance
qualification, use that image's Python:
3.12.3 on Ubuntu 24.04 (image 20261101.360) and 3.14.4 on Ubuntu 26.04 (image
20261101.186), as the images' software lists state. Every Checks and Workflow job
ran on `ubuntu-26.04` in dispatched runs on 2026-11-06
([#871](https://github.com/jimmie-potts/agent-device-hub/issues/871)). The one
image difference they found was the hook qualification's AppArmor profile path,
described under [Linux hook performance qualification](#linux-hook-performance-qualification).
CodeQL pins `ubuntu-24.04`, and release qualification's packaged build and
verification lanes pin `ubuntu-24.04-arm`.
Local validation runs the same commands. Later runtime and browser
changes must add their own issue-appropriate checks.

### Affected PR checks

Ready pull requests run deterministic admission checks. Draft checkpoints skip
expensive jobs. Main pushes run the cheap Integration workflow and independently
enqueue full pinned release qualification. Manual Checks dispatch still runs
every check. The `Select affected checks` job reads the PR's exact
comparison (`compare/<base>...<head>` from the event, with both paths of a
rename) and maps it to check groups with the small explicit table in
`scripts/ci-selection/selection.mjs`:

| Group | Changed paths that select it | What it runs |
| --- | --- | --- |
| runtime | `apps/runtime/**`, active modules and the two Roborock consumer tests | The runtime's unit, scenario, dashboard and verification suites, its dashboard's browser checks and the Roborock consumer tests |
| modules | active `modules/**` | Active modules' suites |
| chompi | The CHOMPI bridge, `packages/chompi-protocol/**` and `firmware/**` | The bridge's suites, verification steps and browser check, and the Firmware job |
| shared | Only full coverage | The shared packages' and contracts' suites, the Python consumers, the old dashboard's tests, the app-verify core and the observability browser check |

Build, typecheck, lint and the workspace-audit and tracker-audit tests always
run for ready candidates. Ordinary Markdown, `openspec/**` and documentation
tooling select no product group. Delivery and validation policy paths, `AGENTS.md`,
`docs/sdlc.md`, `docs/development.md` and the admission capability spec, retain
full coverage. Every other path selects
full coverage: shared packages and contracts, root manifests, the lockfile and
toolchain files, `.github/**`, `scripts/**` (including the selector and the
delivery preflight), other root `tests/**`, the old system, `docs/skins/**` and
any path the table does not name. An incomplete or unreadable comparison (an
API error, a missing revision or GitHub's 300-file limit) also runs everything.
The mapping accepts extra work to stay simple; it is not a dependency graph.

The selector explicitly lists existing dashboard and module frontend CSS assets.
Only comparisons confined to those style paths and documentation use focused mode. They retain the affected
core suites, including the two runtime test jobs, while omitting broad App verification and Runtime verification.
All executable frontend code, including sign-in, connections, durable attempt
fences and device controls, retains conservative coverage. New or renamed style
paths also retain that coverage until their ownership is reviewed in the table. Backend, shared and unknown work cannot opt into
focused mode. The selector's explicit table is authoritative; author labels
have no effect. Affected independent disposable browser/acceptance checks remain
required for observable changes. Full release qualification runs the omitted
coverage on the actual integrated image.

### Standalone test admission

Only modifications to `modules/wemo/tests/module.test.ts` and
`apps/runtime/dashboard/tests/microduck.browser.ts` can select standalone owners.
Ordinary Markdown may accompany them; policy, contracts and shared support cannot.
Both existing and candidate files must be regular Git blobs with mode `100644`.
The selector reads complete file statuses and exact comparison-tree metadata;
missing metadata preserves conservative selection. The local selector narrows
only a clean committed comparison. Additions, removals, renames, helpers,
fixtures, product code and mixed unknown changes retain their existing checks.

Core still runs Node 24 setup, `npm ci`, build, typecheck and lint. Its standalone
checkout is the exact PR head. Wemo runs the entire `npm run test:wemo:built`
script, with parallel standard and count-only Node reporters. Completion requires
a nonempty successful full suite and `modules/wemo/dist/tests/module.test.js`,
with no failed, cancelled, skipped or todo tests. MicroDuck installs Chromium
with the existing bounded apt retry, then runs the complete
`npm run test:runtime-dashboard:smoke` and `npm run test:microduck:browser`.
Its completion marker occurs after all existing browser
assertions. No file, test-name or journey filtering is applied.

The `Standalone command` native notice records only closed completion metadata:
fixed owner/command digest, candidate head, run/attempt and count or full-journey
completion. The final gate requires all selected owners. Delivery preflight
binds notices to the successful native Actions Core job and its complete-command
step; missing, malformed, empty, skipped, failed or wrong-revision evidence
remains unresolved. Workflow and docs checks, review and disposable acceptance
remain required. Full manual Checks and release qualification retain every group.

For the next eligible candidate, first retain the ready-PR standalone run,
review, admission and actual merge timestamps. After it merges, keep its branch
pinned to the reviewed head and dispatch the existing Checks workflow once on
that **same fixed head** as a conservative control. Waiting until after merge
avoids same-head check-name collisions delaying PR admission. Verify reviewed-head
and actual squash-merge tree equality without claiming their SHAs are identical;
main qualification keeps its own source and run identity. Do not add a trigger or retry a failed run for this comparison. Verify
actual checkout/head, workflow blobs, commands, run/attempt, event and complete
native job inventory for both; compare observed elapsed time and all executed
job minutes, including setup/post steps, failures, retries and overlap. Record
Workflow/docs once as shared work. Report queue time separately when native
transitions establish it; unknown waits stay unknown. PR and manual events and
checkout/workload differences limit the comparison. Replayed selection or a
missing full control is not measured elapsed time; runner minutes are not an
invoice or model-cost estimate. Record projected benefits as projections until
both actual executions exist. This observation does not waive either gate.

A group's unselected steps show as skipped in the job log. The two runtime test
jobs, Firmware, App verification and Runtime verification report `skipped` when
their groups are unselected. Those five jobs name their runner (`on ubuntu-latest`) instead of using a matrix,
because GitHub reports a job skipped before its matrix expands under the
unexpanded name. The `Selected checks gate` job runs last, even after a
failure, and fails unless the selection succeeded, every selected job
succeeded, and only unselected jobs were skipped. The select and gate jobs'
summaries list the selected and omitted groups and the paths that chose them.
The select job also publishes its selection in an `Affected checks` notice
annotation. The [delivery preflight](#delivery-preflight) recomputes the same
selection and requires that published one to cover it.

To run every check on a PR head, start the Checks workflow manually on its
branch: `gh workflow run Checks --ref <branch>`. Its results report on the same
head, and the preflight reads the latest attempt of each check. To see what a
local change selects, and the commands CI would run for it, use
`npm run ci:select -- --base origin/main`; it compares `<base>...HEAD` plus
uncommitted and untracked files and runs nothing. When adding a suite, give its
step the group whose paths can break it, or no condition for setup that every
selected group needs, and add it to the pinned step groups in
`tests/ci_selection.test.mjs`. That test pins every conditional step's group,
checks that representative narrow changes run their suites, and checks that
selector, workflow and preflight paths select full coverage. The select job runs
the candidate's own selector, so that test, which the Workflow job runs for
ready candidate and in the Integration workflow, guards edits to the selector.
Admission-policy changes retain full coverage before their new rules activate.

### Disposable task environments

Use one worktree per task. Own its build outputs, container identity, writable
state, ports, synthetic credentials, browser context and client configuration.
Research may read shared source and caches. Runtime/test/browser runs must use
their own mutable resources. Independent work needs no installation handoff; on
the Mac its test jobs share the slots in [Test work on the Mac](#test-work-on-the-mac).
Stop only exact owned runs. Managed verification
retains its two-hour lease; finite container checks retain their declared deadline
and interruption/cleanup limits. See [runtime verification](#runtime-verification-runs)
and [portable acceptance](../apps/runtime/verify/PORTABLE.md).

On a Mac, run the scenario and browser suites natively
([Native runs on macOS](../apps/runtime/DEVELOPMENT.md#native-runs-on-macos)) or
with `npm run test:runtime:container -- --suite scenarios` and
`-- --suite browser` from each task worktree, under
[Test work on the Mac](#test-work-on-the-mac). The container runner copies source and uses
its own synthetic state with no installed volumes, mounts or ports. For a
reviewable runtime capture, use the exact committed candidate and the existing
portable acceptance route. Keep synthetic credentials scoped to that runtime's
declared feed identities. Never substitute an installed endpoint or personal
profile when a disposable setup fails.

Real clients keep their existing permissions. Check the installed client's help
before an experiment, record its version and use synthetic input. Codex CLI
supports a separate state/config root and `--no-daemon`; a profile alone still
layers on the base configuration and does not isolate the shared daemon. Use a
task-owned client root in an isolated environment, file-based authentication only
if separately authorized, and an explicit disposable runtime endpoint/feed.
These controls follow the official [environment reference](https://learn.chatgpt.com/docs/config-file/environment-variables)
and [CLI reference](https://learn.chatgpt.com/docs/cli/reference). Do not copy a
personal authentication store or change its configuration.

For Claude Code, `--setting-sources` selects configuration sources and
`--settings` supplies the task-owned settings file. Combine an explicitly empty
source list with a synthetic settings file, `--strict-mcp-config` and an explicit
empty MCP config before enabling only the disposable feed. `--no-session-persistence`
with print mode avoids persisted experiment sessions. The existing
[coding worker](coding-worker.md) uses the narrower project-settings route for
its established purpose; that is not blanket personal-profile isolation.
Help/readback confirms available controls, not live provider qualification.
No Desktop profile-isolation route is qualified here. An unsupported client
experiment remains unqualified and grants no personal settings/session access.

Feature tasks report integrated source and link the chosen deployment batch for
remaining installed/client acceptance. Only the designated deployment task owns
the selected live operation. Its verified private record supplies completion and
writer release; feature tasks reuse the public sanitized result without asking
for another acknowledgment. Device permission and each issue's own acceptance
remain separate.

### Test work on the Mac

The Mac's Docker Desktop VM also runs the installed core, the diagnostics stack
and the Tronbyt server, and host load limits the test work beside them. Each
session applies this rule itself; no coordinator grant is needed. The test
commands apply it as the Mac profile, which every host gets unless
[Test work on the PC](#test-work-on-the-pc) selects that host's own. Each
command's first own line, on stderr after npm's banner, is
`test-container: profile mac: …` or `runtime-container: profile mac: …`.

1. **Slots.** At most 5 test jobs at once, across all sessions. A job is one
   container (any except the core, the diagnostics containers, the Tronbyt
   server and those in item 2) or one native test suite. A container named
   `…-wide` counts as two. One native sharded catalog run
   (`npm run test:runtime:scenarios:shards`) also counts as two, at any shard
   count up to the default four; a run of more than four shards is not for the
   Mac. Inside a test container only the container's size counts.
2. **Operator and qualification containers.** The archive-volume helper in
   [Back up a stopped instance](bunny-container.md#back-up-a-stopped-instance)
   and the release image's exercise container in
   [Source validation](bunny-container.md#source-validation) (each a
   `docker run --rm … --memory 4g`) are not test jobs. They always run exactly
   as their procedure says and never wait for, shrink to fit or give way to this
   rule. While one runs it counts as three slots, so at most two slots remain
   for test jobs.
3. **Start check.** Start only when the 1-minute load is under 8, the
   installed core is `healthy` and enough slots are free
   ([Counting test jobs](#counting-test-jobs)). Otherwise wait a minute.
4. **Containers.** Run each test job in its own container with
   `npm run test:container -- --issue <n> --job <name> [--size wide] -- <package script>`
   ([One test job in a container](#one-test-job-in-a-container)), which
   applies the name, `--rm` and the limits without swap. A container started
   by hand matches it, runs one job and exits, never as a `sleep infinity`
   holder: `docker run --rm --name bunny-gh<n>-<name> --cpus 2 --memory 1250m --memory-swap 1250m`,
   or wide `docker run --rm --name bunny-gh<n>-<name>-wide --cpus 4 --memory 2g --memory-swap 2g`.
   The SDK suite runs wide. The runtime verification suite runs wide or through
   `npm run test:runtime:container -- --suite verify`, one slot with its own
   limits ([Runtime verification runs](#runtime-verification-runs)).
5. **Lint** (`npm run lint:js`) runs natively only, one at a time across all
   sessions; [Counting test jobs](#counting-test-jobs) has the check and
   [Heap budget](static-analysis.md#heap-budget) the reason.
6. **Native work.** Build, typecheck, lint and `npm ci` take no slot. A native
   suite takes one. Run a package script that is one bare `node --test` command
   as `node scripts/native-test.mjs <script>` (2 workers); that satisfies a
   check list naming the npm script. Run other scripts, such as the browser
   journeys and the `test:*:package:built` scripts, as their check lists name
   them
   ([Native runs on macOS](../apps/runtime/DEVELOPMENT.md#native-runs-on-macos)).
7. **Evidence.** A native macOS run of build, typecheck, lint, the Node suites,
   the scenario catalog and the browser journeys is accepted local validation
   before a push; hosted Linux CI is the gate. A Linux container is needed only
   for a test that still needs Linux (listed in Native runs on macOS, or so
   marked in its own guide) or to reproduce a hosted failure; it stays allowed
   otherwise.
8. **Stop.** If the 1-minute load passes 12 or the core is not `healthy`, the
   owner of the newest job stops it.

Test work never stops, restarts or reconfigures the installed core, the
diagnostics containers or the Tronbyt server. Stop and remove only your own
jobs; never touch another session's containers.

#### Counting test jobs

- Load: `uptime`. Core:
  `docker inspect -f '{{.State.Health.Status}}' bunny-mac-personal-core-1`
  prints `healthy`.
- Containers: `docker ps --format '{{.Names}} {{.Image}}'`. Test containers
  usually start with `bunny-gh` or `bunny-runtime-check-`; count a `…-wide` name
  twice. An operator or qualification container has a name Docker chose, without
  the `bunny-` prefix, and the core image (`bunny-core:…` or an image ID); count
  it three times only when
  `docker inspect -f '{{.HostConfig.Memory}}' <name>` prints `4294967296` (the
  `--memory 4g` of the two commands named in item 2), and other such containers
  once. Admission in `npm run test:container`
  counts it once, so check for one yourself.
- Native suites:
  `ps -axo command= | grep -E '^([^ ]*/)?(node|[Pp]ython[0-9.]*)( |$)' | grep -E -- '--test|/tests/|unittest|vitest|scripts/check-' | grep -v -- '--test-isolation=process'`.
  The listing is an aid. It hides test workers, and most suites show one line,
  the one naming the test files or the browser entry script; a
  `scripts/package-*.mjs --test` suite shows two lines. A native sharded catalog
  run shows up to five
  `node --test --test-concurrency=1 apps/runtime/dist/tests/scenarios/…` lines,
  and its `node scripts/scenario-shards.mjs` parent does not match; count those
  lines as two slots for each run that
  `ps -axo command= | grep -E '^([^ ]*/)?node scripts/scenario-shards\.mjs'`
  lists. Also count every native suite you started yourself.
- Lint: start it only when
  `ps -axo command= | grep -E '^([^ ]*/)?node .*(eslint/bin/eslint\.js|lint-shards\.mjs)'`
  prints nothing. An editor's ESLint language server does not match.

### Test work on the PC

The owner's PC runs test jobs in its WSL checkout, with Docker in WSL and about
19.5 GiB for the Docker VM. It has no installed core, diagnostics stack or
Tronbyt server, so it has no shared test pool and no core check. Each session
applies this rule itself; no coordinator grant is needed. Its numbers are a
first profile (owner decisions of 2026-11-11 on Hub #1681), to be tuned after a
week of use.

1. **Profile.** Set `export BUNNY_TEST_HOST=pc` in the WSL shell before
   `npm run test:container` or `npm run test:runtime:container`. Each command's
   first own line, on stderr after npm's banner, must be
   `test-container: profile pc: …` or `runtime-container: profile pc: …`; a
   refused setting prints its refusal there instead. Under this profile the
   commands print the home directory as `~` and an absolute
   `$XDG_CACHE_HOME` by that name; Docker's and the job's own output passes
   through unchanged, so check it before pasting. Without the
   setting every host, the PC included, gets the Mac profile. The PC profile is
   refused outside a WSL kernel, and any value other than `mac` or `pc` is
   refused, so the Mac never runs with the PC's numbers.
2. **Slots.** At most 8 test jobs at once, across all sessions. A job is one
   container or one native test suite; a `…-wide` container and one native
   sharded catalog run (up to the default four shards) each count as two. A run
   of more than four shards is unmeasured here. The operator and qualification
   containers of [Test work on the Mac](#test-work-on-the-mac) item 2 are
   Mac-only.
3. **Start check.** Start only when the 1-minute load is under 24 and enough
   slots are free. Otherwise wait a minute.
4. **Containers.** Run each test job with
   `npm run test:container -- --issue <n> --job <name> [--size wide] -- <package script>`.
   A standard job has 4 CPUs and 2048 MiB, a wide one 8 CPUs and 3584 MiB, both
   without swap. The SDK suite fits a standard job here. The runtime
   verification suite runs wide or through
   `npm run test:runtime:container -- --suite verify`, which keeps its 2 CPUs
   and 1536 MiB. A container started by hand matches the command:
   `docker run --rm --name bunny-gh<n>-<name> --cpus 4 --memory 2048m --memory-swap 2048m`,
   or wide `--cpus 8 --memory 3584m --memory-swap 3584m` with a `-wide` name.
   The job's private source snapshot goes under `$XDG_CACHE_HOME`, or
   `~/.cache`, in `bunny-test-container/`, not in the memory-backed WSL `/tmp`.
5. **Lint and native work.** Items 5 and 6 of
   [Test work on the Mac](#test-work-on-the-mac) apply unchanged:
   `npm run lint:js` natively, one at a time, and
   `node scripts/native-test.mjs <script>` with its default of 2 workers.
6. **Stop.** If the 1-minute load passes 32, the owner of the newest job stops
   it. The command checks only the start; sessions apply this stop.

To count, use [Counting test jobs](#counting-test-jobs) without the core check,
with `ps -eo args=` in place of `ps -axo command=`. Stop and remove only your own
jobs.

Why these numbers: one `test:runtime:built` job took 276 s and about 1.2 GiB at
4 CPUs, and 194 s and about 2.2 GiB at 8 CPUs (`node --test` starts a worker per
CPU of the quota less one, so memory grows with CPUs). Eight standard ceilings,
or four wide ones, make 16 GiB, which leaves about 3.5 GiB of the Docker VM for
the engine, image builds and the WSL distribution. The Mac's 8 and 12 are 0.67
and 1.0 times its 12 cores. Eight 2-CPU jobs at once reached a load of about 10.
With no core to protect, the PC starts under 0.75 times its 32 threads, so the
eighth 4-CPU job can still start, and stops above 1.0 times them. In the first
PC runs (Hub #1681), eight standard jobs of the runtime unit suite ran at once
for about two minutes and all ran to the end, with no job stopped and none
killed for memory. The 1-minute load peaked at about 24.6 after the last start,
over the start threshold and under the stop threshold, and available memory
never fell below 11,169 MiB. One of the eight jobs failed one timing-sensitive
test (#1695). Such a single failure at full occupancy may come from the load,
so rerun it before treating it as a regression. The wide size has not been
measured for the verification suite here: the first wide verification job is
that measurement, `npm run test:runtime:container -- --suite verify` (1536 MiB)
is the measured route until then, and #1696 tracks it.

### Old system checks

The old system is the old Hub (`apps/hub`), its dashboard (`apps/dashboard`),
the old controllers and services, and the 1.x controller contracts. It keeps
retained for manual return after the accepted cutover (#840), receives no further
changes, and #839 deletes it. Since #827, CI no longer runs the checks below,
and the owner accepts that the old system may break in source. Their npm scripts
stay until #839, so run them locally when a change touches that code:

- `npm run test:hub` and `npm run test:hub:package`, which include the setup,
  Hub MCP, automation, Wispr producer and compatibility-process tests, and
  `npm run test:hub:verify`;
- `npm run test:agent-status`, `npm run test:lifx`, `npm run test:tidbyt`,
  `npm run test:tidbyt:python` and `npm run test:local-controllers`;
- `npm run test:contracts:python` and `npm run test:package`, the 1.x
  contracts' Python consumer and archive check;
- `npm run test:performance`, the early hook measurement tooling;
- `npm run test:dashboard:browser`, the old dashboard's full browser suite
  (see [Dashboard checks](#dashboard-checks)).

CI still covers the old code that kept checks rely on. `npm run build` and
`npm run typecheck` compile it, because kept suites import it.
`test:contracts:built` runs because MCP, the event mapping tests and the
observability pilot import `@jimmie-potts/device-contracts` from source.
`test:dashboard` and `test:dashboard:smoke` run because #922 copies the
dashboard into the runtime; the copy has its own
[checks](#runtime-dashboard-checks). The Python setup still installs
`requirements-contracts.txt`, whose Pillow pin only the local Tidbyt check uses.

Native Windows is outside the supported CI matrix. Windows development uses
Linux Node/Python runtimes inside WSL. Ubuntu CI does not establish installed
WSL/client or device compatibility. Keep that acceptance evidence separate.
Existing provider qualification records and device ownership are unchanged.

### CI cost and suite timings

Runtime catalog verification runs serially in its own required 45-minute job.
Two #1183 App attempts exhausted their combined job limit after the full
serial runtime suite passed in 16m03s and 17m36s; Chromium setup took over five
minutes. The App job retains every other check, and the selected-check gate
requires both jobs. Selection, test concurrency, isolation and failure behavior
are unchanged. The older timings below are historical measurements.

The runtime's unit and scenario suites run in two jobs of their own
([#1506](https://github.com/jimmie-potts/agent-device-hub/issues/1506)). Before
that, Actions step records of 39 successful full-coverage core jobs (32 PR Checks,
7 Release qualification, 2026-11-05 04:08 to 11-06 22:27 UTC) gave, in minutes:

| Core job or step | Median | 90th percentile | Slowest |
| --- | ---: | ---: | ---: |
| Whole core job, limit 40 | 29.2 | 36.4 | 39.4 |
| `test:runtime:built` | 8.4 | 10.9 | 12.0 |
| `test:runtime:scenarios:built` | 7.9 | 9.8 | 10.6 |
| Core without those two steps | 11.8 | 15.8 | 16.9 |
| Job setup, `npm ci` and build | 1.6 | 1.9 | 2.3 |

Passing runs understate the tail. Eight core jobs on 2026-11-06 were cancelled
at the 40-minute limit with no failed assertion. In them
`test:runtime:built` took 12.2 to 15.8 minutes and the scenario suite 10.6 to 14.8;
on PR #1517 `test:runtime:built` alone took 17.1. Together the two suites reached
30.5 minutes, which one shared job plus setup could not hold with ten minutes to
spare, so each has its own runner. Each job adds about two minutes of setup and
build, so the slowest observed suite (17.1 minutes) uses about 19.5 of its job's
40. The split costs about 3.2 extra runner-minutes per full Checks run. The
repeated work inside these suites belongs to
[#1521](https://github.com/jimmie-potts/agent-device-hub/issues/1521) and
[#1523](https://github.com/jimmie-potts/agent-device-hub/issues/1523).

Each job takes runner time, so a duplicate suite or an extra full run costs as
much as a new one. These step times come from main's
[run 37669983471](https://github.com/jimmie-potts/agent-device-hub/actions/runs/37669983471)
on GitHub-hosted runners on 2026-10-07, before #827 left the old system's
checks to local runs.

| Job and step | Seconds |
| --- | ---: |
| Core: build, typecheck and lint | 134 |
| Core: `test:runtime:built` | 61 |
| Core: `test:runtime:scenarios:built` | 33 |
| Core: `test:observability:pilot` | 28 |
| App verification: `test:chompi-bridge:verify:built` | 207 |
| App verification: `test:runtime:verify:built` | 199 |
| App verification: Playwright install with system dependencies | 25 (22 to 227 across runs) |
| Left CI in #827: the Dashboard job, with `test:dashboard:browser` at 500 | 591 |
| Left CI in #827: core `test:hub:package:built` and `test:hub:built` | 216 |
| Left CI in #827: core's eight other old-system steps | 41 |
| Left CI in #827: App verification `test:hub:verify:built` | 158 |

Measured locally on 2026-10-07, the full dashboard browser suite takes about
485 s: `matrix.mjs` 268, `art.mjs` 72, `moments.mjs` 51, `browser.mjs` 33,
`trusted.mjs` 18, `local-controllers.mjs` and `pixoo-refresh.mjs` 11 each,
`pixoo-media.mjs` 10 and each other script under 6. The smoke check that
replaces it in CI takes about 2 s locally.
[#862](https://github.com/jimmie-potts/agent-device-hub/issues/862) owns speedups. Measure before changing a wait,
and keep the waits that test safety behavior.

## Static analysis

See [Static analysis](static-analysis.md#static-analysis) for the authoritative procedure.
The separate [CodeQL procedure](static-analysis.md#codeql-security-analysis) covers
source-security results, permissions and the weekly scan. Its two analysis jobs
run on ready PRs and main independently of the ten existing admission jobs.
The native findings result is a separate merge check; scanner success alone does
not establish that findings passed.

For Python development tooling, install the separate pinned requirements and run
`npm run lint:python` and `npm run test:lint:python` as described in
[Python tooling](static-analysis.md#python-tooling). The existing Retained
documentation checks job runs both commands once on ready PRs and full release
qualification. Main Integration does not run them. Changes to the tool pin,
configuration or workflow retain conservative admission.

For the selected surviving Python tooling, run `npm run typecheck:python` and
`npm run test:python-types` after `npm ci`. The [staged typing procedure](static-analysis.md#staged-python-type-checking)
owns coverage, Python targets and direct consumer checks. The Workflow checks job
runs both commands on ready PRs and full release qualification; ordinary main
Integration is separate.

### Heap budget

`npm run lint:js` runs ESLint in path shards, each in its own process under a
2,048 MB heap, and fails when a shard outgrows it. The largest shard needed
842 MB after a full collection on 2026-11-10; one `eslint .` process needed
about 4.3 GB. See [Heap budget](static-analysis.md#heap-budget) for the cause,
the shard list and how to re-measure.

### Adoption baseline

See [Adoption baseline](static-analysis.md#adoption-baseline) for the authoritative procedure.

### Strict profile for new code

See [Strict profile for new code](static-analysis.md#strict-profile-for-new-code) for the authoritative procedure.

### Safe-error rules

See [Safe-error rules](static-analysis.md#safe-error-rules) for the authoritative procedure.

### ADR 0012 rules and their checks

See [ADR 0012 rules and their checks](static-analysis.md#adr-0012-rules-and-their-checks) for the authoritative procedure.

#### Lint misses and their reasons

See [Lint misses and their reasons](static-analysis.md#lint-misses-and-their-reasons) for the authoritative procedure.

## CI diagnostic access

Routine merge and main-CI evidence uses the GitHub check records described in
[the SDLC](sdlc.md#ci-evidence). Query the exact SHA with pagination:

```bash
gh api --paginate 'repos/jimmie-potts/agent-device-hub/commits/<sha>/check-runs?per_page=100&filter=latest'
gh api --paginate 'repos/jimmie-potts/agent-device-hub/check-runs/<check-id>/annotations?per_page=100'
```

For reruns or contradictory results, repeat the check-run query with
`filter=all`. Compare the complete expected job set, provider, revision and event
association; the commands alone do not establish eligibility.

When deeper evidence is required, read the workflow run with the GitHub CLI's
existing login. Find the runs for the SHA, list a run's jobs, then read the
failed steps' log:

```bash
gh run list --repo jimmie-potts/agent-device-hub --commit <full-sha> --json databaseId,workflowName,event,status,conclusion
gh run view <run-id> --repo jimmie-potts/agent-device-hub --json jobs
gh run view <run-id> --repo jimmie-potts/agent-device-hub --log-failed
```

`--commit` needs the full 40-character SHA; an abbreviated one silently lists
nothing. Retired workflow entries may still appear disabled, so select active workflows by
file name. These are read operations; access does not itself authorize
dispatch, rerun, cancellation or secret changes. A delivery authorized to rerun
one failed job on the reviewed head runs `gh run rerun --job <job-id>`, with the
job's `databaseId` from `gh run view <run-id> --json jobs`; `gh` refuses a run
ID given together with `--job`. Downloaded artifacts and raw logs stay outside
Git; summarize only the evidence needed for the task. See
the [SDLC](sdlc.md#ci-evidence) for the evidence to record.

Runs before #870 were on Depot. Their GitHub check records stay readable as
above, and their logs through the Depot CLI or dashboard while that account
lasts.

## Delivery preflight

`npm run preflight -- --pr <number>` checks one Hub PR against the
[review and merge gates](sdlc.md#review-and-merge) and reports missing or stale
evidence before a merge or issue closure. It is an aid, not a gate or an
authorization. Every run re-reads GitHub, and a report is current only for the
head and read time it prints; a saved green report never covers a later head.
The default `source` finish line is a pre-merge/source-stage check, not a claim
that installation or overall delivery is complete. `--ui` and `--ui-approval`
are deprecated compatibility inputs: accepted and ignored, with no approval
record fetched. The legacy `ui-approval` report entry remains not applicable.
All UI follows [UI verification](sdlc.md#ui-approval-scope).
For an open PR, the comparison uses the current target branch tip. After a
squash merge, it uses the verified merge commit's sole parent, not the REST
PR's potentially stale base or a later main tip. The merge-base is computed
between that parent and the reviewed head. Missing, malformed or conflicting
merge evidence cannot qualify the delivered comparison.
`npm run preflight -- --help` lists the options. The script compiles
`packages/app-verify` first, because proof receipts are checked with its
`validateReceipt` rather than a second reader.

The preflight parser still expects the older separate-axis report format. Until
it supports the lightweight review policy, a missing legacy report is advisory;
verify the actual independent review directly in the PR. This exception does not
waive CI, lint, safety findings, source identity or live-acceptance requirements.
Do not fabricate extra reviews merely to satisfy this optional parser.

The preflight enumerates both CodeQL analysis jobs from their workflow. It does
not interpret native Code scanning results from another GitHub app. Before merge,
verify that result separately for the actual PR analysis, including both languages
and every new `error`, `high` or `critical` finding, as described in
[CodeQL security analysis](static-analysis.md#codeql-security-analysis). Missing,
failed or inaccessible findings evidence remains unresolved even when the analysis
jobs and this optional preflight succeed.

The tool only reads. Before any network use, its GitHub client refuses every
request except `GET` and the tool's own two GraphQL query documents, matched by
exact text, so it cannot merge, comment, label, approve, dispatch or change
issue state. It writes no file. Besides the changed-file lint below, the only
process it starts is `gh auth token`, and only when neither `GH_TOKEN` nor
`GITHUB_TOKEN` is set.

Policy freshness first checks that the recorded policy revision is an ancestor
of the candidate's base. It then reads `AGENTS.md`, `CLAUDE.md` and `docs/sdlc.md`
through GitHub's contents API at those exact commit SHAs and compares each
file's blob SHA. Unrelated changes do not affect this check, including
comparisons at or beyond GitHub's 300-file response limit. A changed policy
file leaves review unresolved. A missing or inaccessible file, or a response
without the expected file type, path and valid blob SHA, is a read failure.
Neither outcome can satisfy review. Comparison-limit protections for source
identity, diff reassessment and CI selection still apply.

GitHub Actions can retain a successful selector in a later workflow attempt
without copying its annotations. For an annotation-free retained selector, the
preflight reads all job attempts and can recover an earlier selection notice.
The run must match the repository, revision, event, branch, workflow and check
suite. Check/job links, earlier attempt numbers, execution timestamps and
recorded steps must identify the same execution. Every matching notice must
agree and cover the groups this change selects. A fresh execution, malformed
or conflicting evidence stays unresolved; inaccessible evidence is a read
failure. The report retains the current check ID and records the original
selection's check ID, workflow run and attempt. Other job-result checks and the
read-only client remain unchanged.

When using this optional tool, run it from a checkout of the PR head: the changed-file
lint gate runs `eslint --max-warnings=0` on the PR's changed JavaScript and
TypeScript files there (#1139). A checkout at another revision, or with local
edits to those files, leaves the gate unresolved rather than linting the wrong
content. Run `npm ci && npm run build` in that checkout first. Type-aware rules
resolve workspace packages through their built output, so an unbuilt checkout
reports unrelated `no-unsafe-*` errors that can push the real finding past the
first 20 listed. Lint findings are listed as `path:line rule`. The output names
revisions, check IDs, comment URLs, digests and run IDs, plus short structured
fields from the evidence it reads, such as receipt capture reasons. It never
prints tokens, local paths or reviewer return text.

| Gate | What it reads | Rule |
| --- | --- | --- |
| Changed-file lint | The PR's added, modified and renamed `.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts`, `.jsx` and `.tsx` files, linted in the local checkout at the live head | Any ESLint error or warning, a checkout not at the head, or local edits to those files is unresolved; not applicable after merge |
| Source identity | PR state, live head against `--head`, base branch tip against `--base`, merge-base, draft, conflicts, fork head, non-main base and closing keywords. The work issue is `--issue` or the single `Refs #<n>` in the PR body; a missing or ambiguous one is unresolved | [Review and merge](sdlc.md#review-and-merge) |
| CI | Expected jobs from the revision's workflow directory at the PR head and, once merged, at the main merge commit: `.depot/workflows/` with Depot's `<workflow> / <job>` check names when it exists, otherwise `.github/workflows/` with GitHub Actions' job names. It applies matrix expansion, GitHub path-filter semantics (`*` and `**`; a filter with negation, `?`, `+` or `[]` keeps every job expected), the [affected-check selection](#affected-pr-checks) recomputed from the PR's changed files (a job it deliberately leaves out must report `skipped`, or `success`, and is reported as not run; any other result, a skip of a selected job, or a select job whose `Affected checks` notice remains missing after verified retained-execution lookup, is malformed or omits a required group, is unresolved) and branch-rule checks; every page of `filter=all` check runs. A workflow edit, including a move between providers, cannot drop a job expected at the merge-base without an unresolved entry; jobs compare by `<workflow> / <job>` | [CI evidence](sdlc.md#ci-evidence) |
| Independent review | The latest `report final <n>` comment from the delivery account in the [agent-skills#54](https://github.com/jimmie-potts/agent-skills/issues/54) format at `3c418136f641caed4f785b0552fab05ae29b37de`. Each axis needs a complete retained return whose digest and provenance match the current comparison and whose own text states a satisfied verdict (see below). An axis carried over under docs/sdlc.md step 3 still reads as unresolved here; the PR body records the carry-over. The requirements issue and `AGENTS.md`, `CLAUDE.md` and `docs/sdlc.md` must be unchanged since the review | [Review and merge](sdlc.md#review-and-merge) |
| Published feedback | Outstanding change requests and unresolved review threads; the Codex security summary and other accounts' comments are listed, not gated | [Review and merge](sdlc.md#review-and-merge) |
| Proof artifacts | Each `--receipt` [app verification](app-verification.md) proof directory: a receipt, and its verified copy, that the app-verify core's `validateReceipt` accepts, a clean build of the head, a frozen verified set matching `SHA256SUMS`, and passed verified captures | [Frozen proof](app-verification.md#frozen-proof) |
| Counterparts | The work issue's native blocked-by links and each `--counterpart` in an owned repository, which must be merged or closed as completed | [Authority and preparation](sdlc.md#authority-and-preparation) |
| Live acceptance | `--finish-line installed`, `real-client` or `physical` stays unresolved; the owner records that evidence under its issue | [Installation and evidence](sdlc.md#installation-and-evidence) |

Each retained return must carry its own verdict line. Only the reviewer's own
lines count: not fenced code, blockquotes (`>`), lines indented four spaces or
a verdict written in inline code, which is an example.
A verdict line is `Verdict:` (or `Verdict -`, or an en or em dash) in any
heading, list or bold markup, or a bare `Verdict` heading with the phrase on
the next line, optionally prefixed by `Final`, `Overall`, `My` or the
return's own axis (`Specification verdict:`). Other prefixes, such as
another axis or `Coordinator`, are ignored. The phrase up to the first `.`,
`,`, `;`, `:`, `(` or dash must be `satisfied`, `approve` or `approved`, on
every own verdict line. A return without one states no verdict, and its axis
stays unresolved; status statements never grant satisfaction.

Statements can only veto. "<axis> axis is <status>" with `action-required`,
`incomplete` or `not satisfied`, for the return's own axis or no named axis,
makes the return not satisfied, even when only the status is wrapped in
markup or quotes. It is ignored only when "axis is" lies inside fenced code, a
blockquote, an inline code span (a run of backticks closed by a run of the
same length) or a balanced double-quoted span outside code; a line with an
unclosed backtick run or unbalanced quotes is read whole. The summary row
never approves an axis on its own.

Exit status is 0 when every applicable gate is satisfied, 1 when any is
unresolved, 2 when a read failed, and 3 for a usage or internal error. `--json`
prints the machine-readable report.

```bash
npm run test:preflight
```

The test suite covers a clean candidate and negative controls built from
deterministic GitHub and receipt fixtures: a missing or unsuccessful job,
changed head or base, stale, partial or self-contradicting review, multi-axis,
aliased and malformed finding lines, unavailable API and paginated reads,
UI changes without approval (including ignored legacy inputs), unchanged review/CI/proof
failures on UI changes, open counterpart,
missing work issue, both finish-line kinds, removed-flag refusals, filtered paths,
the affected-check selection (deliberately skipped jobs, a skipped selected job,
failed, cancelled, pending or missing unselected jobs, a skip recorded for
another revision, a failed selection or gate, and a missing, malformed or
narrower published selection) and dirty or failed-capture receipts. It also
covers the read-only guard and a run under Node's permission model, which
denies file writes and child processes. CI runs it in the Workflow checks job.
Fixtures do not qualify live GitHub state or installed clients.

## Execution recommendation generator

When changing `apps/maintenance/recommendations/recommendations.py`, run the focused prompt
and parser regression suite from the assigned worktree root:

```bash
python3 apps/maintenance/tests/test_recommendations.py
```

Retain a failing-before/passing-after result for changed prompt behavior. Check
recommended and cheaper starts for Claude Code and Codex across all four session
types, including render/read round trips and unchanged-upsert behavior.
Investigate-first prompts must remain read-only. Model and level declarations
cover only settings named for each role; current runtime observations remain
separate, and missing observations must not become a mismatch. Observed required
mismatches and unmet explicit verified-identity requirements still stop work.

Also run the Node 24 workflow setup and checks above and report the actual
OpenSpec inventory. Parser-only source maintenance does not rewrite issue bodies.
The [maintenance parser guide](../apps/maintenance/recommendations/README.md)
owns fingerprint compatibility and safe upsert mechanics.

## Shared tooling provenance

The bootstrap wrapper, validator and fixtures adapt the existing Pixoo tooling
at revision 4fd259b08ff22dcf73938162f7dff67b71d23ed9. They preserve its CLI and
configuration-isolation behavior. This temporary bootstrap copy is recorded;
[agent-device-hub#10](https://github.com/jimmie-potts/agent-device-hub/issues/10) owns publishing the common package, and [divoom-app-upgrade#38](https://github.com/jimmie-potts/divoom-app-upgrade/issues/38) and
[codex-nanoleaf#31](https://github.com/jimmie-potts/codex-nanoleaf/issues/31) own replacing the device copies. No shared skill is vendored.

## Agent setup

Use the reviewed [agent-skills catalog](https://github.com/jimmie-potts/agent-skills)
outside this checkout. Available workflow aids include code-review,
grill-with-docs, grilling, domain-modeling, writing-for-agents and the
OpenSpec propose/explore/apply/update/sync/archive skills. The tdd and unslop
skills come from the installed [pstack plugin](https://github.com/cursor/plugins/tree/main/pstack),
which the catalog composes but no longer vendors.

Missing workflow aids do not block delivery; follow the direct review, design,
regression-test and editorial checks in [docs/sdlc.md](sdlc.md). Missing runtime
tools or unavailable required evidence still block the operation needing them.
Use the shared deliver-work skill only
when the user explicitly invokes it, while retaining repository gates.

Inspect installed paths first. Provision only missing skills through the catalog
manager when the user authorizes personal setup; preserve conflicts and the source
checkout supporting installed links. Do not copy methods or external symlinks here.

Codex reads root AGENTS.md; Claude reads CLAUDE.md, which imports @AGENTS.md.
[Codex discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
and [Claude imports](https://code.claude.com/docs/en/memory#agentsmd) define those
mechanisms. Links to docs are conditional read instructions, not automatic imports.

Verify actual discovery in a fresh authorized host session before claiming
host compatibility. A filesystem link, static instruction exercise or CI pass
alone does not establish live Codex/Claude loading or lifecycle events. Check
root and each nested controller launch directory independently. For controller
work launched at the root, AGENTS.md explicitly requires reading the scoped
README.md and AGENTS.md. Each controller CLAUDE.md imports its local AGENTS.md;
the scoped instructions require the root rules too.

Keep personal Claude/Codex settings, authentication, trust, hook files and runtime
data outside the repository. One branch/worktree and coordinating writer owns each
active deliverable; shared Git operations and installations still need ownership.

## Package and controller validation

The development direction is Node 24, TypeScript and npm workspaces for shared
packages, applications and new Tidbyt/LIFX controllers. Existing packages and
applications have executable commands documented below. Each new controller
implementation must add its build, type, test and consumer checks here and in
CI. The retained old Nanoleaf worker is Python; the current runtime's domain logic is
ported to TypeScript in `modules/nanoleaf` (see [Nanoleaf port](#nanoleaf-port)).

Prepare changes to shared contracts, root package/lockfile and CI in separate
worktrees under [Parallel delivery](sdlc.md#parallel-delivery). Coordinate interface
decisions and integration order, rather than reserving every copy of a shared
file. Reconcile the latest shared changes before final consumer validation.
Run changed-package build/type/tests and every affected contract consumer, plus
the repository workflow checks. A green unrelated package does not validate a
controller. Use fake transports and temporary runtime data for source checks;
ordinary setup must never discover or contact physical devices.

[agent-device-hub#2](https://github.com/jimmie-potts/agent-device-hub/issues/2) owns provider qualification; [agent-device-hub#4](https://github.com/jimmie-potts/agent-device-hub/issues/4) owns the device
contract and cross-language fixtures. [agent-device-hub#3](https://github.com/jimmie-potts/agent-device-hub/issues/3) owns reusable core/package
tests. Consumer changes must run those fixtures against supported contract
versions without private metadata or a physical device.

Define versioned artifacts and a compatibility matrix before a second repository
depends on an exported package. Never import a package from another developer's
checkout path. Changes to shared contracts must validate every affected consumer.

Installation and physical testing follow docs/sdlc.md and the owning device guide.
No bootstrap command installs the app, changes hooks, reads live device credentials
or sends device requests.

## Instruction validation

For instruction-only changes, check these branches statically and report the
files that resolve each rule. Live host discovery requires a separately
authorized session and must be reported separately.

| Task | Expected instruction path and boundary |
| --- | --- |
| Root-launched Tidbyt edit | Root AGENTS.md directs the reader to controllers/tidbyt/README.md and AGENTS.md; cloud source work uses fakes. |
| Nested LIFX launch | Ancestor/root instructions plus controllers/lifx/AGENTS.md; do not infer the exact model or scan the LAN. |
| Claude controller work | Root CLAUDE.md imports root AGENTS.md; controller CLAUDE.md imports scoped AGENTS.md. Scoped rules require the root rules. |
| Shared contract or lockfile edit | Read architecture, linked contracts and this guide; coordinate ownership and test every affected consumer. |
| Request to implement a future controller | Read its exact issue and readiness decisions; bootstrap completion alone grants no implementation or installation authority. |
| Source-only Tronbyt change | Qualify connection behavior with fakes; firmware, server installation and physical transition require separate explicit authorization. |

## Controller contract checks

Use Node 24 and Python 3.14 from the worktree root. After npm ci, install
Python dependencies in an isolated environment with
`python3 -m pip install -r requirements-contracts.txt`.

Run `npm run build`, `npm run typecheck`, `npm run test:contracts`,
`npm run test:contracts:python` and `npm run test:package`. Every command must
exit zero. Both languages execute the same 190 schema and 137 semantic cases,
including the API 1.1 moment cases from Hub #292. Contracts 1.2.0 additionally
runs the shared install receipt corpus through both validators, including
identity equality and timestamp consistency; the existing test globs include
it. CI runs the TypeScript side (`test:contracts:built`); since #827 the Python
side and `test:package` run locally. See [the install contract](install-contract.md).
Hub packaging pins the published controller contracts 1.2.0 archive and its
manifest hashes, including the install-receipt validator. Its manifest also
records every bundled dependency file shipped by npm; package checks verify that
complete inventory after offline extraction. The MCP archive retains its own
published dependency closure.
This contract delivery does not publish or adopt a new Hub archive.
The package check installs a newly built archive into a temporary consumer,
checks every manifest hash, imports the named package, and runs both full corpora.
It requires npm dependency access and creates no device or controller service.

`npm run package:contracts` writes the versioned archive and SHA-256 sidecar under
ignored artifacts/. Record the source commit and checksum outside that commit
when publishing an immutable private release asset for downstream adoption.
Python loads the module with the extracted package's python/ directory on
PYTHONPATH; it requires the bundled relative schemas/ directory. Keep the package
layout intact. No sibling-checkout import is supported.

## Reusable MCP checks

Run `npm run test:mcp`, `npm run test:mcp:protocol` and
`npm run test:mcp:package`, in addition to the existing build/type, both-language
contracts and workflow checks. Tests start ephemeral loopback servers and use
synthetic authentication and fake owning services. No test discovers or contacts
a device or launches an installed agent client.

`npm run package:mcp` creates `@jimmie-potts/device-mcp` 1.0.1 under artifacts/. Version 1.0.1 (Hub #357) publishes smaller tool schemas; the released 1.0.0 archive stays as its consumers pinned it.
The private controller-contract 1.0.0 archive is pinned under vendor/ with its
original release receipt. Packaging verifies its SHA-256 before bundling it and
pins the packed dependency to that bundled version, while the workspace builds
against the 1.2.0 contract source. The MCP package
test installs outside the checkout, verifies both manifests, runs the tool/protocol
suite and typechecks consumer examples without private-registry credentials.

Pin the resulting immutable private MCP release archive and receipt in each
consumer's vendor directory before adoption. Consumer CI then needs no new
cross-repository secret. Keep actual MCP release source/hash receipts outside the
reviewed commit. Read [the module guide](../packages/mcp/README.md) for the API,
protocol matrix, SDK license and remaining installed-client/physical acceptance.

## Shared event contract checks

Use Node 24 and Python 3.14 with `requirements-contracts.txt`.
`npm run build` and `npm run typecheck` include `packages/event-contracts`.
`npm run test:events` builds and runs the TypeScript shared profile/reference
corpus; `npm run test:events:python` runs the identical cases in Python.
CI runs `test:events:built` after the shared build and the Python check in both
supported Python matrix entries. Each runner must reject an empty or duplicate
case inventory and assert exact expected results.

The corpus covers qualified identity/time/order, safe-integer revisions, closed
payloads/privacy, finite limits, retry identity, snapshot recovery, confirmed
notification acceptance, expiry/handling and live-only effects. These are pure
source-contract/reference checks. They do not qualify a production transport,
store, producer, installed client or device. Existing lifecycle/controller
TypeScript/Python/package and affected consumer checks remain required for
compatibility. See [the event profile](event-contract.md).

Profile 2.0 lives in the same package under `schemas/v2/`, `src/v2/` and
`fixtures/v2/`. `test:events:built` also runs `packages/event-contracts/tests/v2.test.mjs`, which
covers every message kind and building block, the size cap, expiry, retry
identity, module schema registration and the error code registry. Profile 2.0
has no Python mirror; `test:events:python` checks profile 1.0 only. Its
sources follow the [strict profile](#strict-profile-for-new-code).

The same command discovers `read-receipts.test.mjs` for opt-in lifecycle/2.1.
It checks Codex and Claude identity preservation, closed receipt metadata,
source qualification, generation/turn/notice binding, immutable decisions and
unchanged default registration. Run `npm run test:sdk:built` after the shared
build for default-consumer compatibility. The retained lifecycle/controller
TypeScript, Python and package checks above still apply. No Python 2.1 mirror is
introduced. The runtime adoption in #1354 adds session/2.1 provenance cases to
this same event suite and `read-receipts.test.ts`, `read-helper.test.ts` and
`claude-read-plugin.test.ts` to existing runtime CI discovery. After the root
build, run these focused files, `test:runtime:built`,
`test:sdk:built`, `test:runtime-dashboard:built` and the affected disposable core
scenario. The tests cover authenticated source binding, exact owner revision,
replay, later turns, restart and failed commit. Helper tests run its executable
against the authenticated gateway. They run on Linux, where CI runs them, and
natively on macOS (see
[Native runs on macOS](../apps/runtime/DEVELOPMENT.md#native-runs-on-macos)).
`node apps/runtime/dashboard/tests/read-receipts.browser.ts` verifies that the
real helper's session/2.1 output clears the dashboard's unread row, survives a
page reload and returns to unread on a new turn without a page command. The
existing hosted dashboard smoke entry includes this journey. Native
plugin validation, native offline rendering tests and the real Claude terminal
exercise remain separate from synthetic runtime acceptance. The
[operator guide](../apps/runtime/READ-RECEIPTS.md) describes the selected version
and the installed gate. No actual provider binary or personal profile is used
by ordinary CI.

The same event test command discovers `speech.test.mjs`. It checks explicit
endpoint availability, live-card expiry, scenario and history refusal, closed
playback receipts, candidate references and endpoint-loss identity. The core
fixture inventory includes all seven speech families. These checks use synthetic
messages and produce no audio.

`test:events:built` also runs the core and device payload family tests (Hub #842,
#918):
- `packages/event-contracts/tests/families.test.mjs` runs `fixtures/v2/families.json`: a valid message
  for every core family, each invalid case with its expected detail, and removal,
  expiry and sync scenarios through the reference consumer in
  `packages/event-contracts/tests/consumer.mjs`.
- `packages/event-contracts/tests/devices.test.mjs` runs `fixtures/v2/devices.json`: a valid message for
  every device family, a reply and an outcome for each command family, each
  invalid case with its registry code and detail, the capability rule, the
  routing-key subject of every command family, and the Hub-mode table for each
  participating device kind, which must equal the package README's.
- `packages/event-contracts/tests/status.test.mjs` runs the 2.0 status helper's copied cases against
  valid `session/2.0` records, and checks its ranking and colors against the 1.x
  `@jimmie-potts/agent-status`.
- `packages/event-contracts/tests/mapping.test.mjs` checks that
  [MAPPING.md](../packages/event-contracts/MAPPING.md) names every 1.x field,
  including every field of the controller snapshot, its capabilities and each
  kind of the general command union. It converts the 1.x lifecycle, snapshot,
  controller receipt, controller snapshot and command corpora, compares the 2.0
  capability rule with 1.x admission, and drives a real agent-state owner
  through expiry and retirement.

The mapping and status tests import the built `@jimmie-potts/agent-state`,
`@jimmie-potts/agent-status` and `@jimmie-potts/device-contracts`, the package's
devDependencies, so run the full `npm run build` first, as CI does.

## SDK checks

`packages/sdk` holds the SDK from [ADR 0012](decisions/0012-bunny-event-platform.md):
publish, subscribe, request, respond and sync, on the in-process bus and over
the SSE/HTTP remote transport, plus the per-module outbox and the module test
kit (`@jimmie-potts/sdk/testing`). Its
[README](../packages/sdk/README.md) documents the API. The package follows the
[strict profile](#strict-profile-for-new-code), tests included.

The internal cutover preparation model has a pure focused check after the root
build: `node --test apps/runtime/dist/tests/cutover-plan.test.js`. It checks
declared inventory coverage, migration ordering, per-volume capacity and digest
binding with synthetic facts; it starts no runtime or service. The Runtime unit
tests CI job's `test:runtime:built` discovery includes this file. The focused check does not
qualify installed discovery, backup execution, receipts or the cutover.

Use Node 24 and run `npm run build`, `npm run typecheck`, `npm run lint:js` and
`npm run test:sdk` from the worktree root. `test:sdk` builds, then runs
`test:sdk:built`: the compiled tests in `packages/sdk/dist/tests/`. The core CI
job runs `npm run test:sdk:built` after its fresh build. The tests check every
message they see against profile 2.0 with the event contracts' validator, and a
test fails if one is invalid; the bus itself does not validate. One conformance
suite runs against both transports. The remote tests start an edge on
127.0.0.1 at a free port with run-generated tokens, and the outbox and kit tests
keep SQLite files under the system temporary directory. The one-call publish
helper's tests (Hub #926) also use loopback listeners that refuse the
connection, never answer or answer with something other than an edge's answer.
They need no runtime, device or other network. `browser.test.ts` bundles the remote
client's entry, `@jimmie-potts/sdk/remote`, for a browser with esbuild, so a Node
built-in or a file read in its module graph fails the suite (Hub #922).

## Runtime checks

For the manual container profile, build first and run
`node --test scripts/tests/bunny.test.mjs scripts/tests/bunny-backup.test.mjs deploy/container/tests/context.test.mjs deploy/container/tests/entrypoint.test.mjs deploy/container/tests/runtime.test.mjs deploy/container/tests/provision-local.test.mjs deploy/container/tests/production-acceptance.test.mjs`
with Node 24 on Linux. These cover the real owner lease, unsafe state and pending
restore refusal, archive integrity, WAL/assets/key pairing and separate empty
restore. Run root build/type/lint and the runtime ownership tests as well.
Use only disposable synthetic volumes for actual image/operator acceptance;
see [the operator guide](bunny-container.md). Its explicit production exercise
requires `BUNNY_CONTAINER_ACCEPTANCE=1` inside a network-disabled disposable
Linux container with synthetic private secrets; ordinary source runs skip it.
It covers configured household modules, preserved non-device modules and honest
missing-dependency refusals through the production selector and simulated transports.
Its second exercise prints the per-module qualification record described in
[the operator guide's source validation](bunny-container.md#source-validation):
platform and compiled dependencies, private stores, exclusive startup,
port-conflict refusal, clean stop and reopen.
Source tests, each architecture's
container rehearsal, cross-architecture archive transfer and live installation
are separate evidence.

See [Runtime checks](../apps/runtime/DEVELOPMENT.md#runtime-checks) for the authoritative procedure.

For the Collector export and the Mac-local diagnostics stack (Hub #813), build
first and run `node --test apps/runtime/dist/tests/export.test.js` with Node 24:
it drives a loopback fake Collector through accepting, refusing, stalling and
absent cases and checks the configuration's owned-origin refusals, so it needs
no Docker. The stack's own files are checked only by a disposable boot on
alternate ports, as [the operator guide](bunny-container.md#diagnostics-stack)
describes: `docker compose -p <disposable name> -f deploy/diagnostics/compose.yaml -f <ports override> up -d`,
post one profile 1.8 record and one span to the Collector, read them back
through Grafana's Loki and Tempo proxies, then `down -v`. Hosted CI runs the
export test with the runtime suites; it does not boot the stack.

### Runtime test layers

See [Runtime test layers](../apps/runtime/DEVELOPMENT.md#runtime-test-layers) for the authoritative procedure.

### Runtime verification runs

On macOS with Docker Desktop, the Linux route is `npm run test:runtime:container`;
the native route follows below. It snapshots
current tracked and nonignored new source, prepares a reusable image using the
pinned Node 24 base and lockfile-selected Chromium, then runs `npm ci --include=dev`,
`npm run build`, `npm run test:runtime:scenarios:built` and
`npm run test:runtime:verify:built` inside disposable Linux. A build or suite
failure exits nonzero. The container has its own copied source, dependencies and
synthetic state, `TMPDIR=/tmp`, no networking during checks, no host mounts and
no published ports. Docker's init process reaps exited descendants. It never attaches to the installed runtime or its volumes.
The check container is limited to 2 CPUs and 1536 MiB (1.5 GiB) of memory, with
swap equal to memory so it cannot swap; Node inside then reports 2 CPUs, so
`node --test` starts fewer workers. On macOS the verification suite's processes
used at least 1.2 GB (the largest sample, a lower bound), and at a 1250 MiB
limit the run was killed for memory. The image build is a separate step without
these limits. The container also runs under the shared test pool and waits for
admission, as described in [Shared test pool](#shared-test-pool). An image
build, which is needed only when its tag is missing, waits for the same admission
and runs its RUN steps in the pool.
The temporary Git commit identifies a working-tree snapshot, not a reviewed
release or independent Acceptance result. Dependency preparation needs network
access; the checks install from the image's offline npm cache.

Use `-- --suite scenarios` or `-- --suite verify` for a focused suite, and
`-- --suite browser` for the runtime dashboard browser smoke check. Separate
invocations may run concurrently, including from independent worktrees, within
the slots of [Test work on the Mac](#test-work-on-the-mac). Each
owns a unique container; cleanup removes only that container. The source copy
excludes ignored files, private paths and build output and refuses symlinks.
Keep private work outside tracked/nonignored source. The in-container two-hour
deadline bounds the checks independently of the host caller. Host interruption
may leave that invocation's container until its deadline;
inspect and remove only its `bunny-runtime-check-` identity. This finite test
container is separate from a managed preview lease. No broad prune or installed-service action is needed.
The prepared `bunny-runtime-check-tools:<hash>` images are caches keyed by the
manifests and recipe, shared by every run of the same lockfile across tasks and
sessions; [Cleanup after delivery](sdlc.md#cleanup-after-delivery) keeps them,
and only the owner removes a cache no live lockfile produces.

The wrapper's fixed-suite, source-isolation, resource-limit and failure-propagation checks are
`node --test scripts/tests/runtime-container.test.mjs`, included in core CI.
Hosted runtime suites remain unchanged.

The runtime unit suite, the scenario catalog and the runtime dashboard browser
journeys also run natively on macOS, without Linux or a container, from the
session's own worktree and build. `node scripts/native-test.mjs <script>` runs a
`node --test` package script with a bounded number of test workers, 2 by default.
[Native runs on macOS](../apps/runtime/DEVELOPMENT.md#native-runs-on-macos)
gives the commands and lists the tests that still need Linux.

See [Runtime verification runs](../apps/runtime/DEVELOPMENT.md#runtime-verification-runs) for the authoritative procedure.

### One test job in a container

On macOS with Docker Desktop, or in the PC's WSL with Docker, run one package
script in a disposable Linux container that starts from installed dependencies:

```bash
npm run test:container -- --issue <n> --job <name> [--size standard|wide] [--no-build] [--network] [--wait-minutes <n>] -- <package script> [arguments...]
```

The container is `bunny-gh<n>-<name>`, or `bunny-gh<n>-<name>-wide` at the wide
size. The job name is free text: lowercase letters, digits and inner hyphens.
Its first own line, `test-container: profile <name>: …` on stderr, names the
host's profile and its limits
(`scripts/test-container/profile.mjs`; the Mac profile unless
[Test work on the PC](#test-work-on-the-pc) selects the PC's). Before the job
starts, the command prints the container name, its size and the slots it takes.

| Size | Mac limits | PC limits | Slots |
| --- | --- | --- | --- |
| `standard` (default) | 2 CPUs, 1250 MiB, swap equal to memory | 4 CPUs, 2048 MiB, swap equal to memory | 1 |
| `wide` | 4 CPUs, 2048 MiB, swap equal to memory | 8 CPUs, 3584 MiB, swap equal to memory | 2 |

Swap equal to memory means the container cannot swap. A small table in
`scripts/test-container.mjs` refuses known scripts that do not fit a size and
names their routes:

- `test:runtime:verify:built` needs `--size wide`, or
  `npm run test:runtime:container -- --suite verify`, which has its own
  1536 MiB limit.
- `test:sdk:built` needs `--size wide` on the Mac. A PC standard job has the
  4 CPUs it needs.

The command refuses a raw command or an unknown script name, `test:container`
and `test:runtime:container`. It also refuses `lint:js`, which runs natively,
one at a time (see [Heap budget](static-analysis.md#heap-budget)).
Python-dependent suites are not supported: the image has no Python packages.

How a run works:

1. The command copies the current tracked and nonignored source into a private
   scratch directory (mode 0700) under the snapshot rules of
   [Runtime verification runs](#runtime-verification-runs): no ignored files,
   private paths, build output or symlinks.
2. It mounts that snapshot read-only at `/snapshot`. Unlike
   `npm run test:runtime:container`, this command mounts a host path, but only
   this private read-only snapshot, never the worktree.
3. In the container, the snapshot is copied over the image's `node_modules` and
   recorded in a temporary Git commit. `npm run build` runs unless `--no-build`
   is given, then `npm run <package script> [-- arguments]` runs.

The container runs with `--rm`, `--init`, `--network none` (`--network` uses
Docker's default bridge and prints that it did), all capabilities dropped except
`CHOWN`, `no-new-privileges` and no published ports. A two-hour deadline in the
container bounds a job whose host caller has gone. The command returns the
job's exit status: 2 for its own refusals, and 128 plus the signal number for a
job ended by a signal. On an interrupt it kills its own container by the ID
Docker wrote to its cidfile. It never stops or removes a container it did not
start. A name already in use is refused and left alone.

The dependency image is `bunny-test-deps:<key>`. The key is a hash of
`package-lock.json` and `scripts/test-container/Dockerfile`, and the image carries
it as the `org.bunny.test-deps.key` label. The command builds the image only when
that tag is missing. The build has network and uses CPU and memory outside the
job's limits, and the command prints that it is building. With the shared test
pool, the build's RUN steps run in the pool (`--cgroup-parent`), and BuildKit
leaves an empty `buildkit` child cgroup there. Exporting the image stays with the
Docker engine, outside the pool.
Every run recomputes the key from its snapshot, runs by image ID, and refuses an
image whose label does not match, so an image built for another lockfile is
never used. Each image is about 3.5 GB, and a new one appears for each lockfile
or recipe change. A build takes the start lock described below, and a run that
waited rechecks the tag, so two first runs normally build once. A build that
bypasses the lock, such as one interrupted and rerun, can leave an untagged
image. The images are caches shared by every run of the same lockfile;
[Cleanup after delivery](sdlc.md#cleanup-after-delivery) keeps them, and the
owner removes old `bunny-test-deps` images, including untagged builds.

Inside a 2-CPU container `node --test` already starts one worker, so the command
runs package scripts directly, not through `scripts/native-test.mjs`. The
command's argument, key, refusal, cleanup and exit-status checks are in
`scripts/tests/test-container.test.mjs`, and the pool's in
`scripts/tests/test-container-pool.test.mjs`. `npm run test:workspace-audit`
runs both in core CI.

#### Shared test pool

On the Mac, both `npm run test:container` and `npm run test:runtime:container`
start their containers under one cgroup in the Docker VM, `/sys/fs/cgroup/bunny-tests`
(`--cgroup-parent /bunny-tests`). The pool's limits apply to all those
containers together:

| Limit | Value |
| --- | --- |
| `memory.max` | 5 GiB |
| `memory.swap.max` | 0, so no swap |
| `cpu.max` | 6 CPUs |
| `cpu.weight` | 25, against the default 100 the installed core keeps |

Each container keeps its own size limits inside the pool. The code is
`scripts/test-container/pool.mjs`.

The cgroup lives in the VM's memory, so a Docker VM restart removes it. Before
each start the command reads it, recreates it when it is missing and sets its
limits when they differ. It then prints the limits it read back and which helper
set them. Every helper is named `bunny-tests-pool-<uuid>`, runs the pinned alpine
image with `--network none`, and is removed when it exits:

- A read-only reader mounts `/sys/fs/cgroup` read-only.
- The pool directory is created by a container started with
  `--cgroup-parent /bunny-tests`.
- The limits are written first by an unprivileged helper with all capabilities
  dropped, which mounts only the pool's own directory.
- Only if that helper cannot write them does the owner-approved privileged helper
  (`--privileged --cgroupns=host`) write them, and only inside that directory.
  The command first prints why the unprivileged helper did not: its exit status,
  or the limits it read back. Within one command run the privileged helper is
  attempted at most once, whatever happens afterwards. Each helper run times out
  after 60 seconds, and a helper that times out has failed.

Nothing in this change writes `cgroup.subtree_control` or anything under
`docker/`. The container runtime enables the pool's memory and CPU controllers
when it creates a container there, as it already does under `docker/`. If the
root cgroup does not give its children those controllers, or neither helper can
set the limits, the command prints why at start-up and falls back to
per-container limits. `BUNNY_TEST_POOL_SCRATCH_NAME` names another pool for
scratch exercises only. It must be one path segment that starts with `bunny-`.

The PC profile has no pool: no helper runs, no cgroup is read or created, and
jobs keep only their own size limits. Admission there checks the load (under
24), `docker ps` and the slot count (8), not the core or pool memory.

Admission runs without a daemon. Before an image build and before each job, the
command waits until all of these hold on the Mac:

- the host's 1-minute load (`os.loadavg()`) is under 8;
- `docker ps` can be read;
- the installed core is listed as `running`, is `healthy`, and its last health
  check took under 500 ms. The core is skipped only when `docker ps -a` lists no
  container named `bunny-mac-personal-core-1`. Any failure to read its health,
  or a health with no readable check time, is a wait;
- the rule's five slots have room for the job, with or without the pool. The
  count is every running or paused container except the installed core, the diagnostics
  containers, the Tronbyt server and the pool helpers, with a `-wide` name as
  two. It covers containers only and counts an operator or qualification
  container once, so a session still counts its native suites and that
  container's other two slots itself under the rule's start check in
  [Test work on the Mac](#test-work-on-the-mac);
- with the pool, the pool reads back with exactly its limits and with whole
  numbers for its `anon` and `shmem` memory, and its `memory.max` minus those is
  at least the job's memory size (2 GiB for an image build). A pool that is
  missing, unreadable or without its limits, as after a VM restart, is a wait.
  The command sets it up again at most once for each distinct reading of it in a
  run, never on a timer, and prints each of those lines only when it differs
  from the last.

It rechecks every 30 seconds, or every 3 seconds when the only reason is another
start holding the lock, and prints a line only when the reason changes. Every
Docker read times out after 60 seconds. After `--wait-minutes` (default 30) it
stops with exit status 75 and the last reason. A start also takes one lock that
every session on this machine shares, `/private/tmp/bunny-test-start/lock`
(`/tmp/bunny-test-start/lock` on Linux, owner-only), with a random token in its owner file. It holds the lock from its
admission check until its container has run for 30 seconds, and through an
image build. Releasing removes the lock only while the token is still its own.
A lock is taken over, with a printed line, only when its owner's process is
gone, when it has had no owner file for 10 seconds, or when it is older than
6 hours. Six hours is far longer than the longest legitimate hold, which is a
cold image build (a wait does not hold the lock), so a reused process number
cannot keep a dead holder's lock forever. One taker at a time removes a stale lock and re-tests it first. The
waiting line names the lock and its owner's process number. To clear a stuck
lock by hand, check that no test command with that process number is running
(`ps -p <number>`), then remove it with
`rm -r /private/tmp/bunny-test-start/lock`. Both runners recheck the image tag
after waiting to build. If `docker create` gives the runtime check runner no
container ID, it shows the engine's error, removes a container left under its
own generated name if one exists, and fails.

When the pool kills a process for memory while a job runs, the command says so
in one line. That is a failed run to retry, not a reason to raise the ceiling.
A real Docker VM restart restarts the installed core, so recreation after one is
observed only when the owner restarts the VM for other reasons. The pool's
5 GiB ceiling and the core's own 4 GB limit together exceed the VM's memory. A
nearly full pool beside a busy core was not exercised; the six-job run below
reached 2.75 GiB.

In one 25-minute run on 2026-11-11, with six commands kept running or waiting,
admission let six jobs run at once for 140 seconds in total, at most 90 seconds
in a row. That run predates the slot count in pool mode. It held starts back for
290 seconds because the load was at or above 8, and for 580 seconds because the
start lock was held. The core stayed healthy, with health checks of at most
122 ms. The pool peaked at 2.75 GiB of `anon` and `shmem` with no memory kill.
Hub #1641 records the details.

### Workspace audit

`npm run audit:workspace` prints the read-only report that
[Workspace audit](sdlc.md#workspace-audit) acts on: a verdict per registered
worktree from `git worktree list`, `git status` without optional locks and `gh pr list`,
stopped task containers and unreferenced task images older than the window,
container-less task-named volumes, and the shared launcher caches and untagged
images listed for the owner. Images named by the private batch records under
`~/.local/state/bunny-operations/` (the current and previous installed image,
the latter kept for return) or by a `compose*` file at the root of a release
directory under `~/.local/share/bunny/releases/` are never reported as stale;
release inputs below that root, such as `private-inputs/`, are not read, so an
older release's own image can still be listed. The audit reads only image IDs
from those files and prints nothing else from them. Pass `-- --hours <n>` to
change the 48-hour window and `-- --json` for the raw report. It needs `gh` for
PR states and Docker Desktop for the Docker sections; a missing tool, a PR older
than the newest 300, or no record naming an image is reported as a note, not a
failure. Its classification and collection tests are
`npm run test:workspace-audit`, run in core CI.

### Tracker audit

`npm run audit:tracker` prints the read-only report that
[Tracker audit](sdlc.md#tracker-audit) acts on, and exits 0 when clean, 1 with
findings, 2 when a read failed or an item could not be checked, and 3 on a
usage error or an internal error, such as malformed GitHub data. Every GitHub request goes through the delivery preflight's
read-only client (`scripts/delivery-preflight/github.mjs`), which refuses any
request other than a GET to the GitHub API or one of the preflight's own
GraphQL queries, so the audit cannot write. It needs a token from `GH_TOKEN`,
`GITHUB_TOKEN` or `gh auth token`. Pass `-- --hours <n>` for the 72-hour
window, `-- --stale-review-days <n>` for the five-day review threshold and
`-- --json` for the raw report. The status check accepts only the four values
[the label rule](sdlc.md#authority-and-preparation) names, so any other
`status:*` label is a finding. The five-day review threshold is the audit's
default, proposed in #1508; no document sets a time limit on `status:review`.
Two parts of it are heuristics:

- A PR references an issue when its body names it in a `Refs` or closing
  clause, such as `Refs #12, #13` or `Closes #14`; a bare mention or
  `Part of #N` does not count. A merged PR that refs an epic or other parent
  therefore reports that parent when nobody has commented since, even where
  [Tracker reconciliation](sdlc.md#tracker-reconciliation) needed no update.
- A cleanup outcome is recorded when a comment on the PR, or on an issue its
  body references, was updated at or after the merge, names cleanup or a
  worktree, and uses one of step 8's outcome words: removed, retained or not
  applicable. It does not check that each resource has an outcome or that a
  removal cites its readback, and a comment that only quotes the rule passes.
  One such comment on a shared referenced issue, such as an epic, clears every
  PR merged before it that refs that issue.

Its fixture tests, `npm run test:tracker-audit`, run in core CI without
network access.

## Runtime dashboard checks

The disposable browser world selects an ephemeral loopback port. If the port is
in its installed-service denylist, the harness stops that candidate before
trying another, for at most ten allocations. Exhaustion removes the private
world directory and fails explicitly. Startup or stop errors propagate without
retrying. The final port refusal, restart port and browser assertions remain.
After the build, run `node --test apps/runtime/dashboard/tests/world-runtime.test.ts`
for deterministic disallowed-port, cleanup, exhaustion and error cases. Existing
dashboard test discovery includes these checks. Run
`npm run test:runtime-dashboard:smoke` for the affected browser consumers.

Individual Hub-mode overrides (#695) extend the existing event-contract, runtime
and dashboard suites. After the root build, run
`node --test apps/runtime/dist/tests/mode*.test.js`,
`npm run test:events:built`, `npm run test:runtime-dashboard:built` and
`node apps/runtime/dashboard/tests/hub-mode.browser.ts`. The mode browser journey
already runs in the hosted smoke entry; these unit files already join CI
discovery, the runtime files in the Runtime unit tests job and the dashboard files
in core. Verify saved exceptions on the existing device cards, compact Hub
inspection, HTTP/MCP admission, shared ordering and restart without effects.
Run affected Pixoo/SDK consumers, runtime scenarios and the full dashboard
browser suite for the shared presentation change. Evidence is synthetic/source
only; it does not establish installed or physical results.

For the reusable Timeline card (#1194), after the root build run
`node --test apps/runtime/dashboard/tests/timeline.test.ts apps/runtime/dashboard/tests/home-catalog.test.ts`
and `node apps/runtime/dashboard/tests/timeline-card.browser.ts`. The browser
journey uses synthetic history and the existing Home layout owner; it checks
passive browsing, filters/evidence, failures, keyboard focus and phone/desktop
layout. The existing core CI job discovers the unit tests and the App
verification job runs the focused browser journey. Run the full dashboard
browser suite and `inbox-history.browser.ts` for this shared presentation change.
The browser journey asserts limit=200 on entry, date/exact, refresh and Home reads,
truthful result-window labels and local category/Show more behavior. After the
build, run `node --test apps/runtime/dist/tests/history-window.test.js apps/runtime/dist/tests/inbox-gateway.test.js`
for HTTP/MCP limit validation, read permissions, filtering before the limit,
compatibility without a limit and a 2,400-row synthetic archive with 16 KiB records.
An unselected malformed record verifies that bounded reads decode only their
window. Existing runtime test discovery includes these checks. Installed Recent
acceptance uses bounded reads and private process/health evidence; never use an
unlimited live read as a negative control.

Customizable Home (#366) adds core metadata/restart and gateway admission tests in
`apps/runtime/tests/home-layout.test.ts`, pure catalog/layout checks in dashboard
unit discovery, and an editor journey in the existing dashboard browser entry.
After the root build, run `node --test apps/runtime/dist/tests/home-layout.test.js`,
the owning runtime/dashboard unit, browser and scenario checks, shared type,
contract, workflow and JavaScript lint checks. Existing runtime and dashboard CI
discovery selects these paths; layout tests assert that editing sends no device commands.

The Wemo card (#1175) adds observed-state/guard projection checks to existing
dashboard unit discovery and extends the existing `test:wemo:browser` journey
for stable tabs, retained drafts and the approved concise presentation. Both
already run in the selected dashboard/App verification checks. After the root
build, run `node --test apps/runtime/dashboard/tests/wemo-card.test.ts` and
`npm run test:wemo:browser`; keep the owning shared and full browser checks below.

The current shell's route, directory and browser checks, including #1173's
five-destination navigation journey, follow the owning
[runtime dashboard checks](../apps/runtime/DEVELOPMENT.md#runtime-dashboard-checks).

See [Runtime dashboard checks](../apps/runtime/DEVELOPMENT.md#runtime-dashboard-checks) for the authoritative procedure.

Playback artwork (#1069) adds passive owner/gateway checks to the existing
`npm run test:playback:built` and `npm run test:runtime:built` discovery. After
the root build, run `node apps/runtime/dashboard/tests/playback-artwork.browser.ts`
for the focused Home/Music image, association and text/control
journey; App verification runs that same entry. It uses the real playback
owner and decoder with synthetic acquisition on the disposable browser harness.
Keep the full dashboard browser suite required by the owning procedure. These
checks establish source behavior; installed browser identity and physical
display acceptance remain separate.

## Agent lifecycle contract checks

Hub #2 adds `packages/lifecycle-contracts`, a private versioned lifecycle schema
and TypeScript/Python consumers. Use Node 24 and Python 3.14, run `npm ci`
and install `requirements-contracts.txt` in an isolated Python environment.
Run `npm run build`, `npm run typecheck`, `npm run test:lifecycle`,
`npm run test:lifecycle:python` and `npm run test:lifecycle:package`, in addition
to all existing workflow, controller-contract and MCP checks. The core CI
job runs the lifecycle checks on Ubuntu with Python 3.14.
Tests use synthetic metadata only.
`npm run package:lifecycle` builds the private archive with a file-hash manifest;
record its source revision and archive hash externally after reviewed delivery.
No command installs hooks, launches a client or contacts a device.

## Early performance measurement tooling

`npm run test:performance` uses Python 3.12 or 3.14 to check measurement
statistics, pinned source verification, isolated legacy admission and bounded
worker failure handling. It is an [old system check](#old-system-checks) that
runs locally, not in CI. The tests use synthetic state and do not
establish installed-client, full hook,
helper-route or physical performance. See [the early measurement procedure](performance-baseline.md)
for actual profile commands and pending budget gates.

## Linux hook performance qualification

Run `npm run test:performance:linux` on Linux with system Python 3.12 or 3.14
under `/usr` and the packaged `bwrap` executable available. These thirteen focused
checks execute the pinned real hook in disposable PID/network/mount namespaces,
verify provenance and failure retention, and test detached-child cleanup. They
perform no timing benchmark or device operations. CI runs them once in the
Ubuntu workflow job; the other Ubuntu jobs remain required.
Hosted setup refreshes the package index before installing Ubuntu's `bubblewrap`
and `apparmor-profiles` packages,
then loads the `bwrap-userns-restrict` AppArmor profile and checks namespace
startup before running the tests. Ubuntu 24.04 ships that profile as
`/usr/share/apparmor/extra-profiles/bwrap-userns-restrict` in `apparmor-profiles`;
Ubuntu 26.04 ships it as `/etc/apparmor.d/bwrap-userns-restrict` in `apparmor`
([#871](https://github.com/jimmie-potts/agent-device-hub/issues/871)). The step
loads whichever exists and fails when neither does. It does not disable
AppArmor or change a global namespace restriction. A host that cannot create the
required namespaces fails this check rather than running the hook unconfined.

The separate measurement command is `python3 -B scripts/performance/linux_hook.py --output <new-directory>`. Its default runs three repeats of 1,000 samples for
each of the 1/10/50-session Linux profiles. Use it only for authorized measurement
work. It retains failed repetitions and rejects existing output directories.
The namespace mounts only read-only system runtimes and pinned source, new
Linux state and temporary files. Parent timeout kills the namespace and the
host terminates and verifies its own namespace init through a Linux PID handle;
Linux then terminates every namespace member. No personal
configuration, Windows metadata, client sessions or physical endpoints are used.

## Status stream checks

`npm run test:agent-status` covers incremental SSE parsing, authenticated owner
checks, reconnect/idle deadlines, bounded notices, stop and the fixed recovery
poll under storms. `npm run test:lifx` and `npm run test:tidbyt` cover notice-driven
reevaluation, stop during reads, retained write outcomes and the existing device
policies. `npm run test:local-controllers` verifies their owning host consumers.
These are [old system checks](#old-system-checks) that run locally; source fakes establish
notice-to-evaluation timing, not installed or physical latency.

## Tidbyt controller checks

The runner tests in the same `test:tidbyt` suite cover authenticated loopback
feed reads, wrong-owner and malformed responses, body/time bounds, private
configuration, local process exclusion, crash release and shutdown. They use
a real in-memory shared owner with fake cloud transport and run locally with the
rest of `test:tidbyt`. No installed service or physical device participates.

Hub #16 adds the `controllers/tidbyt` workspace package, an in-process Tidbyt cloud
controller. Use Node 24 and Python 3.14. Run `npm run build`,
`npm run typecheck` and `npm run test:tidbyt`. After installing
`requirements-contracts.txt`, which pins Pillow, run `npm run test:tidbyt:python`.
If the system Python lacks Pillow, create a virtual environment, install
`requirements-contracts.txt` into it and run the command with that environment
active (the #222 and #241 closeouts both hit this).
Keep running the shared controller-contract and workflow checks alongside them.
Both are [old system checks](#old-system-checks) that run locally, not in CI.

The TypeScript suite covers the renderer, including golden WebP bytes, invalid
frames and its import boundary. It also covers the cloud connection against a
fake `fetch`, with authentication, 429, timeout, transport and redaction cases,
and the private credential file. For the controller queue it covers target
validation, bounded admission, duplicate/conflict/join handling, FIFO overlap,
cancellation, uncertain results with no replay, unsupported v1 commands,
authentication and rate-limit holds, close, read-only refresh and stale evidence,
and queued installation removal. Hub #19 adds status tests: the view and frame
drawer over multiple, child, idle, overflow, acknowledged, read, unlabelled and
stale sessions, and the publisher against a real in-memory agent-state owner with
fake timers and a fake connection. The publisher cases cover coalescing, the
15-second minimum, the 10-minute refresh, idle removal, an unavailable or slow
feed, a hung feed read, failed and uncertain writes, the installation listing
check before removal and backoff after repeated failures. Hub #38 adds
now-playing tests in the same suite: the playback view, card layout and
envelope validation; the publisher's 5-second read, 15-second gate, 10-minute
refresh, stale and failed-read cards, removal when nothing plays, backoff, a
hung read and coexistence with the status publisher on one controller; the
controller's additional installations with shared holds and per-installation
evidence; and the runner's playback feed and optional `nowPlaying`
configuration. A golden now-playing card is among the Pillow-decoded images. Every receipt and snapshot is checked with the controller v1 `validate()`. The
Python check decodes the committed golden images with Pillow, independently of
the encoder. No check reads credentials or contacts the Tidbyt cloud or a
device. Visible results need the separately authorized installation in #21.

Hub #426 extends these same suites with label/title/project/neutral precedence,
a title-bearing golden frame, a snapshot 1.2 runner request and the exact frame
sent through its queue. Run `npm run test:agent-status`, `npm run test:lifx` and
`npm run test:local-controllers` as shared-feed consumer checks too. The feed's
version selection is optional, and LIFX retains its default request. The title golden is independently decoded
by `test:tidbyt:python`; it is a synthetic preview, not visible-device evidence.

Hub #20 moves the per-session ranking (`sessionState`/`RANK`), the whole-owner
reduction, `HubStatusFeed` and its bounded hub GET helpers, and the generic
feed-cadence machinery (`EvaluationLoop`, `BoundedReader`) into the new
`packages/agent-status` workspace package, so the LIFX status publisher reads
the same hub feed through the same classes. `controllers/tidbyt/src/runner.ts`
re-exports `HubStatusFeed` unchanged for existing consumers, and
`controllers/tidbyt/src/status.ts` builds its ASK/RUN/DONE display vocabulary
on the shared `AgentState` values. Every existing Tidbyt test keeps passing
unmodified; see "Agent status package checks" below for the moved code's own
tests.

## Agent status package checks

Hub #20 adds `packages/agent-status`, a private workspace package with no
device-specific display vocabulary: `sessionState`/`highestStatus` (the shared
per-session ranking and whole-owner status reduction every automatic-status
device consumes), `HubStatusFeed` and its bounded hub GET helpers
(`hubOrigin`, `hubToken`, `hubJson`, `HUB_ID`), and the generic feed-cadence
machinery (`EvaluationLoop`, `BoundedReader`, `systemTimers`). Use Node 24 and
run `npm run build`, `npm run typecheck` and `npm run test:agent-status` from
the worktree root. It is an [old system check](#old-system-checks) that runs
locally, not in CI.

Tests cover the ranking (attention over working over done, an active child
making its root working, read evidence never retiring done), `highestStatus`
(idle only when the feed is healthy and nothing is outstanding, `unknown` only
for an unavailable feed or a non-running collector, and uncertain freshness
never hiding a session's reported state, #439), the hub
feed against a real in-memory agent-state owner and a fake `fetch` (redirect,
oversized, malformed, wrong-owner and slow responses), and the evaluation
loop/bounded reader (coalescing, stop, a hung read blocking further reads
until it settles). No check contacts the Tidbyt cloud, a LIFX bulb or a
device.

## Agent state core checks

Hub #3 adds the embeddable `packages/agent-state` owner and source provider emitters.
Use Node 24 and Python 3.14. Run `npm run build`, `npm run typecheck`,
`npm run test:agent-state`, `npm run test:agent-state:python` and
`npm run test:agent-state:package`, alongside all existing shared checks.
CI runs the core, Python fixtures and external package consumers in the core
job with Python 3.14. Tests use fake providers,
exclusive test stores, disposable state and loopback transports. They do not
install hooks, launch clients or operate devices. `:built` commands require a
fresh build in the same job. Host storage conformance, installed qualification
and integrated performance remain separately evidenced downstream gates.

## Standalone hub checks

See [Standalone hub checks](../apps/hub/DEVELOPMENT.md#standalone-hub-checks) for the authoritative procedure.

## CHOMPI controller checks

See [CHOMPI controller checks](../apps/chompi-bridge/DEVELOPMENT.md#chompi-controller-checks) for the authoritative procedure.

### CHOMPI task routing checks

See [CHOMPI task routing checks](../apps/chompi-bridge/DEVELOPMENT.md#chompi-task-routing-checks) for the authoritative procedure.

### CHOMPI bridge verification runs

See [CHOMPI bridge verification runs](../apps/chompi-bridge/DEVELOPMENT.md#chompi-bridge-verification-runs) for the authoritative procedure.

## Wispr runtime module checks

The reusable Quiet line Home card (#1200) stays in the module's browser entry.
After the root build, run `npm run test:wispr-module:built`,
`npm run test:runtime-dashboard:built` and
`node apps/runtime/dashboard/tests/wispr.browser.ts`. Core CI runs the module
tests; the hosted runtime smoke entry also runs this focused browser journey. The projection tests distinguish observed zero,
missing speech, absent dates and expired producer windows; the browser journey
checks selectable gaps, refresh/refusal retirement, keyboard and responsive
light/dark layout. These use synthetic published files only and do not
activate collection or establish installed analytics availability.


The selected-file scenario fixture is wired explicitly into the memory and disposable harnesses. `check-module-names.cjs` permits only `wispr` in the four named fixture/seed files; it continues to reject other module names there and all module references in production discovery. The verification plugin separately lists the exact `wispr-contracts` package paths in its source, output and artifact identity; those literals are exempt, while module references on the same line and other paths remain checked. This is the bounded #927 integration permitted while generic fixture discovery in #999 is deferred, not a new loader or service.


The root build and typecheck include `modules/wispr`. Run
`npm run test:wispr-module:built` after the build; the core CI job runs the same
suite. It exercises the unchanged collector file contract through fresh private
synthetic aggregate/diagnostic files and the module's worker. It covers numeric
queries, text opt-in, missing/stale/cleared files, bounded reads, cancellation and
privacy/lifecycle delivery fences. It reads no installed collector files or
database. Gateway, React and disposable runtime checks qualify integration
separately; package tests alone do not establish those paths or installation.

The runtime dashboard browser command includes `wispr.browser.ts` for the module
port. It uses the actual reader on private synthetic collector files: numeric
widget and page, retained filters, numeric downloads, explicit browser exposure
and text-sharing opt-out, and keyboard use. Inspection sends no
commands. The two read-scoped caller cases and missing/stale inputs also run in
the module's shared catalog scenarios; no installed collector or service is used.

## Wispr Hub checks

`apps/hub/tests/wispr.test.mjs` exercises #470 through the real HTTP server with
synthetic aggregate/status files: source grants, browser exposure, late revocation,
filter math, freshness, generation fencing, text opt-out, bounded file failures
and CSV/JSON exports. A disposable stalled worker verifies the 2.5-second
deadline and worker retirement; its factory seam is unavailable to installed
configuration. `tests/wispr_hub_producer.test.mjs` verifies that the bundled
consumer fixture exactly matches current collector output. The existing `test:hub:built` glob and offline Hub package
suite include it. They run locally, not in CI, so run `npm run test:hub` after a
change to the collector's aggregate output.
Use the private cache TMPDIR described above. Run build/typecheck, Hub/package,
Hub MCP, setup and the shared controller/lifecycle/state/MCP/workflow suites.
Fixtures never open Wispr or collector databases or enable installed collection.

## Wispr collector checks

Use Node 24 from the assigned worktree root. Run `npm ci`, `npm run build`,
`npm run typecheck`, `npm run test:wispr`, `npm run test:wispr:package`,
`npm run test:contracts`, `npm run test:contracts:python`, `npm run test:package`,
`npm run check:workflow` and `npm run test:workflow`.
The core CI job runs the Wispr `:built` suites after the shared build.
`npm run build:wispr` builds just the two Wispr workspaces for focused development;
it does not replace the shared acceptance checks.

The source suite covers strict aggregate validation, hand-calculated metrics,
timezones, retention, late changes, clear/restore fencing, source/privacy checks,
atomic publication and bounded failures. The package suite extracts the offline
collector and exercises a synthetic collect/status/export flow and an isolated
contract consumer. No check reads personal Wispr data.

The language extension adds opted-in synthetic stage, tokenizer, alignment,
exact-preset, sensitivity and private-recovery cases to the same collector test
glob and extracted package. Native qualification must cover the extended reader
and opt-out before pending publication. Cross-consumer fixtures must validate
real collector tables through the shared contract and the Hub language routes;
unknown source language, edit finality and counter windows remain explicit.

Ranking regressions cover diverse retained text across overlapping presets,
repeatable batch reads, stable table order and exact support/top-100/omitted
values. A batch that exceeds one working map must merge exact partitioned results;
an adversarial partition that still exceeds its bound must reject and preserve
the committed store. The native capacity script also qualifies synthetic diverse-language
import, repeat, restart and zone rebuild, reporting elapsed time and peak RSS,
plus the full production CLI on oversized synthetic ranking batches.
These measurements qualify the synthetic retained-store path, not performance
on the owner's installed history or the entire supervised command.

Run `npm run test:wispr:native:built` separately under native Windows Node 24,
with its synthetic database/output directory on a local Windows drive. The
native check rejects other platforms and verifies the fixed native History identifier/app mapping and DATETIME declaration, numeric/language repeat counts, source byte/ACL preservation, unknown edit-end coverage and text opt-out. It also verifies concurrent WAL writes,
source preservation, reader-lock release, busy/deadline bounds, accepted extra
readers on selected source/sidecars, unchanged source bytes/ACLs, private
config/state/backup/export ACL rejection, unsafe-path rejection and
locked-destination recovery. Keep the native receipt tied to the final
candidate/package digest; Linux CI is not a substitute. An isolated test runtime
does not change the global Windows Node installation. Installation, scheduled
collection and personal-data validation require their own authorization.

## Dashboard checks

See [Dashboard checks](../apps/dashboard/DEVELOPMENT.md#dashboard-checks) for the authoritative procedure.

## Shared monitoring setup checks

See [Shared monitoring setup checks](../apps/hub/DEVELOPMENT.md#shared-monitoring-setup-checks) for the authoritative procedure.

## Standalone hub MCP checks

See [Standalone hub MCP checks](../apps/hub/DEVELOPMENT.md#standalone-hub-mcp-checks) for the authoritative procedure.

## Hub automation checks

See [Hub automation checks](../apps/hub/DEVELOPMENT.md#hub-automation-checks) for the authoritative procedure.

## Bounded cross-device compatibility

See [Bounded cross-device compatibility](../apps/hub/DEVELOPMENT.md#bounded-cross-device-compatibility) for the authoritative procedure.

## Everyday standalone qualification

See [Everyday standalone qualification](../apps/hub/DEVELOPMENT.md#everyday-standalone-qualification) for the authoritative procedure.

## LIFX controller checks

Use Node 24 and run `npm ci`, `npm run build`, `npm run typecheck` and
`npm run test:lifx` from the worktree root. Run shared controller-contract
TypeScript/Python and package checks plus `check:workflow` and `test:workflow`.
It is an [old system check](#old-system-checks) that runs locally, not in CI. Fake transports and fake sockets cover packet encoding,
reply correlation, deadlines, bounded retry, replay, cancellation, overlapping
commands, unsupported capabilities and partial multi-bulb results. Tests validate
common receipts/snapshots against controller v1 and never open a native socket.
Installation and physical acceptance remain separate from these source checks.

Hub #20 adds automatic agent status for qualified bulbs: a `modes` capability
and `mode.set` (Work/Quiet/Free) the controller persists atomically, an
internal `paintStatus`/`onModeChange` pair used only by the new
`LifxStatusPublisher`, and that publisher itself
(`controllers/lifx/src/status-publisher.ts`), which reads the shared
`@jimmie-potts/agent-status` feed on the Tidbyt-style 30-second/3-second
cadence and paints one absolute `LightSetColor` per shown-state transition
through the bulb's existing queue. The package has no default mode-state
directory: `modeStateRoot` must be supplied (the owning host derives one from
its own lease root) or a qualified bulb advertises `modes: {supported: false}`
and `mode.set` is `unsupported-capability`. Reading and writing that
directory and its per-bulb files follow the same fail-closed rules as the
existing private-file/lease checks elsewhere in this codebase: the directory
must be a real, owner-only directory (created at 0700 if missing, otherwise
required to already be one); the mode file is opened `O_NOFOLLOW` and must be
a small, owner-only regular file to be trusted (anything else, including a
symlink or a missing file, reads as Free); a write uses an exclusive,
non-following 0600 temporary file and an atomic rename, and fails closed
(receipt `failed`/`transport-failure`) rather than falling back to an unsafe
location. `paintStatus` also rejects an unqualified bulb outright
(`unsupported-capability`, no traffic, no pending entry) as defense in depth.
`closeGracefully()` gives the controller (and each bulb) an orderly shutdown:
it retires every queued job without aborting one already in flight, which
settles on its own bound (`timeoutMs * (retries + 1)`) before the transport
closes; the host uses it, after stopping the status publisher, in place of
the abrupt `close()`.

Tests cover: the internal paint command kind rejected by `parsed()`/`submit()`
and the public lighting schema; a bulb with no configured mode-state root
advertising no modes; a persisted mode surviving a reconstructed controller; a
symlinked mode file and a group-readable mode directory both failing closed; a
persistence failure reported as `transport-failure` without changing the mode
or bulb health; an unqualified bulb rejecting `paintStatus`; `onModeChange`
notifying only a successful `mode.set`; `closeGracefully` letting an in-flight
paint finish (`sent`) while every queued one cancels with no further traffic;
and the publisher's mapping, transitions-only (including new evidence for an
unchanged state, and a manual app change surviving reads until the next real
transition), stale-input, offline-bulb, mode and stop cases against a real
in-memory agent-state owner with fake timers. `mode.set`'s receipt uses
`outcome: "sent"` with `priorEffects: "confirmed-transmission"` because the
contract's receipt schema ties those two together with no valid combination
for "succeeded with certainty, nothing was transmitted"; a persisted mode
change is its own point of effect, with no possibility of a lost transmission,
so it reports the same pairing any completed write does. Painting never
changes power. No test contacts a bulb, and every test that constructs a
controller, publisher or host passes its own temporary mode/lease directory,
never the real default under a developer's home.

## LIFX module checks

Hub #928 copies the LIFX controller into the runtime module `modules/lifx`, under
the [strict profile](#strict-profile-for-new-code) and the module boundary. Its
[README](../modules/lifx/README.md) records the provenance and maps each copied
test. The runtime ships it after the core. `controllers/lifx` stays unchanged for
the installed service until #839, and keeps its own
[checks](#lifx-controller-checks).

Use Node 24 and run `npm run build`, `npm run typecheck`, `npm run lint:js` and
`npm run test:lifx-module` from the worktree root. `test:lifx-module` builds, then
runs `test:lifx-module:built`: the compiled tests in `modules/lifx/dist/tests/`.
The core CI job runs `npm run test:lifx-module:built` after its fresh build. The
suite covers the copied protocol, queue and status cases, the module's commands,
outcomes, refusals and restarts, a full store, an unreachable bulb, the writer
lease, the on-demand read, the cutover's conversion, and the
[module test kit](../packages/sdk/README.md#module-test-kit) with policy A's
check. It uses `SimulatedLifx`, fake sockets, a manual clock and SQLite files
under the system temporary directory, and opens no socket. One test starts a Node
child process that holds a bulb's lease. The runtime's catalog
scenario `lifx-bulbs` runs the module in `test:runtime:scenarios:built` and in
[disposable runs](#runtime-verification-runs). Installation and the physical check
belong to the cutover (#840).

## Tidbyt module checks

The reusable card's copy lifetime and evidence-label cases are discovered by
`test:tidbyt-module:built`. After the root build, run
`node apps/runtime/dashboard/tests/tidbyt-card.browser.ts` for its actual
read-only Home/device/module-page journey; existing hosted runtime dashboard
smoke and the full browser suite include it. See the owning
[module guide](../modules/tidbyt/README.md#reusable-dashboard-card).

Hub #930 copies the Tidbyt controller's renderer, cloud connection, queue and
publishers into the runtime module `modules/tidbyt`, under the
[strict profile](#strict-profile-for-new-code) and the module boundary. Its
[README](../modules/tidbyt/README.md) records the provenance and maps each
copied test. The runtime ships it after the playback module, whose record its
now-playing tile follows. `controllers/tidbyt` stays unchanged for the installed
local controller host until #839, and keeps its own
[checks](#tidbyt-controller-checks), its Pillow check included.

Use Node 24 and run `npm run build`, `npm run typecheck`, `npm run lint:js` and
`npm run test:tidbyt-module` from the worktree root. `test:tidbyt-module`
builds, then runs `test:tidbyt-module:built`: the compiled tests in
`modules/tidbyt/dist/tests/`. The core CI job runs
`npm run test:tidbyt-module:built` after its fresh build.

Exact staged art (#681) adds `art-render.test.ts` and `art.test.ts` to that
existing module suite. After the root build, run
`node --test modules/tidbyt/dist/tests/art-render.test.js modules/tidbyt/dist/tests/art.test.js`
for independent animated-WebP decoding, media bounds, private staging/reopen,
exact moments, and ambient queue/attention/pin interleavings. The runtime
scenario catalog exercises the same module through the registered synthetic
Tronbyt transport; `test:runtime:scenarios:built` and disposable scenario runs
cover that gateway path. Core CI's module suite discovers these files, and the
Runtime scenario tests CI job runs the scenarios. The playback thumbnail limit and its current
tests remain separate from the art profile.
The `scenario-tidbyt-art` capture follows a labelled synthetic link to the
authenticated exact preview and retains that animation in the recording. After
the build, run `node --test --test-name-pattern='^scenario-tidbyt-art passes in a fresh run$' apps/runtime/dist/verify/tests/steps.test.js`
for its image-load and final-page checks in the existing verification suite.

The suite also covers the
copied renderer, status, now-playing, cloud and cadence cases; the golden frames
decoded by an independent libwebp build through `sharp`, pixel by pixel, with a
corrupted golden as its negative control, in place of the controller's Pillow
check; both tiles from synced records, the write gate under bursts, the refresh,
removal and the listing check, a lost copy, failed, uncertain and held writes, a
cloud that does not answer at start, rendering in a worker thread and its end at
stop, a restart, the writer lease, a database that refuses commits, the
cutover's conversion, and the
[module test kit](../packages/sdk/README.md#module-test-kit) with policy A's
check. It uses the module's `SimulatedCloud`, a fake `fetch`, a manual clock,
real worker threads and SQLite files under the system temporary directory, and
reaches no cloud. The runtime's catalog scenario `tidbyt-tiles` runs the module
in `test:runtime:scenarios:built` and in
[disposable runs](#runtime-verification-runs). Installation and the physical
check belong to the cutover (#840).

Hub #23 adds the Tronbyt backend beside the cloud, covered by
`modules/tidbyt/tests/tronbyt.test.ts` on `SimulatedTronbyt` in the same suite. The optional
`tronbyt-server.test.ts` runs the same calls against a real, disposable server when its
[environment variables](../modules/tidbyt/README.md#compatibility-record) name one, and skips
otherwise, so hosted CI reaches no server. Recheck it when the pinned server moves.

For artwork, after the root build, focus the real-worker and diagnostic checks
with `node --test modules/tidbyt/dist/tests/artwork-render.test.js` and
`node --test --test-name-pattern='artwork|playback/2.1' modules/tidbyt/dist/tests/module.test.js`.
The full writer suite includes superseded queued push/remove and rate-hold
cases. The integrated `speaker-artwork` scenario runs both display modules and
their real workers over in-process and remote transports:
`node --test --test-name-pattern=speaker-artwork apps/runtime/dist/tests/scenarios/catalog.test.js`.
It counts producer fixture acquisitions and compares current display frames
with independent fixture expectations. Existing CI discovery runs these tests:
the module suites in core and the scenario in the Runtime scenario tests job. Physical artwork acceptance remains under #1054's separate trial.

## Codex Desktop module checks

Hub #926 ports the old Hub's Codex Desktop reader (`apps/hub/src/codex-desktop.ts`)
into the runtime module `modules/codex-desktop`, under the
[strict profile](#strict-profile-for-new-code) and the module boundary. Its
[README](../modules/codex-desktop/README.md) records the provenance, the read
rules and why the reader runs in a process of its own. The runtime ships it
last, after the Nanoleaf module. The installed Hub keeps its own reader until #839.

Use Node 24 and run `npm run build`, `npm run typecheck`, `npm run lint:js` and
`npm run test:codex-desktop` from the worktree root. `test:codex-desktop`
builds, then runs `test:codex-desktop:built`: the compiled tests in
`modules/codex-desktop/dist/tests/`. The core CI job runs
`npm run test:codex-desktop:built` after its fresh build. The suite covers the
Hub's marker parser and read rules as published observations: top-level
sessions of the configured producer only, the settle rule, an unusable marker,
evidence sent again with a doubling wait while the core leaves its record
unchanged, as after a refusal; a folder that stalls, before and after the
first read; a reader that fails and its backoff; a stop that never waits on a
read; that nothing carries the Codex home; the configured section; the real
reader process on a synthetic marker in a temporary Codex home, and a reader stuck in a FIFO's open that closing the transport ends; and
the [module test kit](../packages/sdk/README.md#module-test-kit). The runtime's
tests run it with the real core (`apps/runtime/tests/codex-desktop.test.ts`), and
its catalog scenario `codex-desktop-read` runs it with a simulated marker in
`test:runtime:scenarios:built` and in
[disposable runs](#runtime-verification-runs). No test reads a real Codex file.
Installation belongs to the cutover (#840).

Hub #990 also covers archive filenames and independent `session_index.jsonl`
titles through that reader loop, with synthetic homes only. Tests prove scoped
root/ancestor admission, explicit unarchive, expiry and fail-open unavailable
scans, and title updates independent of marker usability. Owner and real
CoreStore checks retain explicit labels, host session IDs, lifecycle facts and
restart uncertainty. Required contract and agent-state package checks cover the
additive `metadata-observed` input. Its runtime consumers are the complete
`core-store.test.ts`, `core.test.ts`, `codex-desktop.test.ts`,
`operation-records.test.ts`, `gateway.test.ts` and `credentials.test.ts` files;
the catalog scenario covers archive admission and independent titles alongside
read evidence. These behaviors need no data conversion or migration.

Hub #567 adds the host-local Codex Desktop collector
(`apps/runtime/src/collector/`, `apps/runtime/bin/codex-desktop-collector.mjs`;
see [its README section](../apps/runtime/README.md#codex-desktop-collector)).
Use Node 24 and run `npm run build`, `npm run typecheck`, `npm run lint:js` and
`node --test apps/runtime/dist/tests/codex-desktop-collector.test.js` from the
worktree root. The suite covers snapshot bounds, the byte budget and the stamp,
the collector and producer file refusals (including `intervalMs` 5000 accepted
and 5001 refused), and record transitions, with every
record checked by the diagnostic contract's `parseRecord` and for private values.
It also runs the real entry point against a real runtime's edge with a synthetic
Codex home: the edge admits the family, then the first snapshot, a heartbeat, a
changed marker, contract-only stderr and SIGTERM. That
integration test is kept to Linux, where CI runs it with procfs; it skips
elsewhere, though the private-file reader works off Linux too (Hub #1355). No test reads a real
Codex home.

Hub #567 adds remote sources: the `sources` section, the `RemoteFeed` transport
fed by `desktop-metadata` snapshots and one run per source. After the root
build, `npm run test:codex-desktop:built` also runs `remote.test.js` (snapshots as
reads, a feed that stops and recovers, refused snapshots, a local and a remote
source side by side) and the extended `configuration.test.js`. The real core's
remote path, through the edge with the collector's own credential, a hook's
credential and another feed, is the last case of
`apps/runtime/dist/tests/codex-desktop.test.js`; the edge binding itself is in
`remote-hooks.test.js`. The container profile's admission of a remote-only section
is in `deploy/container/tests/entrypoint.test.mjs`. Runtime tests that read an
edge configuration file run in the Runtime unit tests CI job, a disposable Linux
container or [natively on macOS](../apps/runtime/DEVELOPMENT.md#native-runs-on-macos),
except the collector's entry-point test above. The disposable run `codex-desktop-remote`
([runtime verification runs](#runtime-verification-runs)) hosts the real collector
for the acceptance exercise.

## Nanoleaf port

Reactive presets (#722) use the existing Nanoleaf built-test discovery. After
`npm run build`, run
`node --test modules/nanoleaf/dist/tests/music-presets.test.js modules/nanoleaf/dist/tests/module-presets.test.js modules/nanoleaf/dist/tests/reactive-preset-model.test.js`,
then `npm run test:nanoleaf:built`. Tests cover prior-schema initialization,
frozen recipes, catalog CAS, capacity and SQLite failures, outbox atomicity,
restart and mixed-family sync without device changes. Run the owning runtime
Nanoleaf scenario, dashboard unit checks, SDK/events, shared type/lint,
controller-contract and workflow checks. The existing
`node apps/runtime/dashboard/tests/nanoleaf-pages.browser.ts` entry will include
save/reload, read-only/Origin refusals, stale/uncertain saves, passive reconnect,
full-recipe preview and light/dark phone/desktop layout. It remains
required alongside smoke and full dashboard browser checks. Existing modules,
runtime and App verification CI select these paths; no new job or root script
is required. All fixtures are synthetic, with no capture, installation or
physical evidence.

Synthetic Music-effect preview (#722) uses the existing Nanoleaf built-test
discovery. After the root build, run
`node --test modules/nanoleaf/dist/tests/music-preview.test.js modules/nanoleaf/dist/tests/music-preview-model.test.js`,
then `npm run test:nanoleaf:built`. The existing Wall browser journey at
`node apps/runtime/dashboard/tests/nanoleaf-pages.browser.ts` covers explicit
preview reads, local drafts and scrubbing, result fencing, read-only access and
phone/keyboard behavior. CI runs that journey in App verification
for the runtime group and discovers the focused tests through the core
Nanoleaf suite. Keep build/type/lint, runtime/dashboard, shared contract and
workflow checks. Generated input and example geometry establish no live capture,
device output, configured-layout fidelity or physical timing.

Offline decorative show authoring (#723) uses the existing Nanoleaf built-test
discovery for immutable versions, metadata-only commands, content reads and
restart/rollback checks. After the root build, run
`node --test modules/nanoleaf/dist/tests/music-shows.test.js modules/nanoleaf/dist/tests/module-shows.test.js`,
then `npm run test:nanoleaf:built`. The existing
`node apps/runtime/dashboard/tests/nanoleaf-pages.browser.ts` journey covers the
editor through the authenticated disposable runtime and remains in the full
local runtime dashboard browser check. Run the existing smoke check as well.
Keep shared build, typecheck, lint,
contract and workflow checks. These checks use synthetic plans and establish
no installation, playback, physical timing or light output.

The internal prepared-music timeline helper (#1273) is covered by
`modules/nanoleaf/tests/music-timeline.test.ts`, discovered by the existing
`test:nanoleaf:built` CI suite. After the root build, its focused check is
`node --test modules/nanoleaf/dist/tests/music-timeline.test.js`; run the full
Nanoleaf, typecheck, lint and workflow checks before delivery. Its explicit-clock
and synthetic Lines/NL22 results establish no worker admission or physical timing.
Internal cue phase preparation and location use that same timeline suite. Run
`node --test modules/nanoleaf/dist/tests/music-timeline.test.js modules/nanoleaf/dist/tests/effects.test.js`
after the root build for exact transition boundaries, unequal durations,
initial-origin uncertainty, one-shot/loop behavior and unchanged animation bytes.
The existing Core modules CI discovery includes both files. Keep the full
Nanoleaf, typecheck, lint, contract and workflow checks. Phase descriptors are
canonical endpoints and timing, not interpolated colors or physical seek proof.

Hub #26 ports the Nanoleaf domain logic to TypeScript in `modules/nanoleaf`, under
the strict profile, and Hub #844 runs it as the runtime's shipped module
`nanoleaf` ([README](../modules/nanoleaf/README.md)).
[`modules/nanoleaf/PORTING.md`](../modules/nanoleaf/PORTING.md) records the
provenance, maps every Python module and test file to a slice, and lists the known
differences, the module's included. The package builds and typechecks before the
runtime, which imports its factory.

Use Node 24 and run `npm run build`, `npm run typecheck`, `npm run lint:js` and
`npm run test:nanoleaf` from the worktree root. The core CI job runs
`npm run test:nanoleaf:built` after its fresh build. The suite needs no device,
Hub or Python; the HTTP client's tests use stub servers on the loopback
interface. It includes the module's own tests on a manual clock against
simulated controllers (`module.test.ts`, and `module-faults.test.ts` for its faults
and recoveries) and its module test kit run in real time (`module-kit.test.ts`). `migration.test.ts` covers the migration of the
bridge's state (#933) on the `linux-state-v4` fixture and on a synthetic state of the installed shape, which it writes
with the module's own code: what it carries and leaves in the backup, the configuration conversion, its refusals, the
verifier's count of each planted corruption, the module's start on the migrated store and an address change, and a
source left unchanged. Under the runtime, `test:runtime:built` runs
`nanoleaf.test.ts` with the lag check on, and the catalog's `nanoleaf-wall`
scenario runs in `test:runtime:scenarios:built` and in a disposable run
(`npm run -s verify:runtime -- start --scenario nanoleaf-wall`).

The port is split into slices by area:

- **Slice 1:** session-to-Line projection, shared input selection,
  Codex metadata, Line placement, NL22 enrollment, and the device registry,
  layout and database migration they need.
- **Slice 2a:** device configuration loading, Line pairing, map geometry and
  the renderer, with the display encoder it shares with effects.
- **Slice 2b:** effects, saved animation favorites and the Nanoleaf HTTP
  client, including device pairing (`pair`).
- **Slice 3a:** removing the legacy input slice 1 ported; the port keeps shared
  input only (owner decision 2026-10-06).
- **Slice 3b:** map edits, the pending wall edit, Locate, mode commands,
  starting and pruning comets, and the rendering receipt.
- **Slice 3c:** the display worker with scene restore.
- **Slice 3d:** controls, a minimal journal for holds and uncertain attempts,
  and animation play.
- **Slice 3e:** the remaining multi-device worker cases of
  `test_device_worker.py` and the Panels worker ownership cases, and the
  `worker` command's retry loop (`superviseWorker`).

The translated Python tests keep their class and method names. A replay of
recorded Python sequences compares, after every step, the results and the rows of
`sessions`, `activity`, `task_info`, `slots`, `comets`, `waits`, `receipts`,
`shared_stale`, `shared_suppressed_waves`, `shared_evictions`, `projects`,
`line_prefs`, `map_settings`, `meta` and `display_v3`, plus the `shared_input`
row's `source`, `generation`, `received`, `connection` and `error`, and, by
hash, the envelope Python saved there, which the port keeps in memory. `palette`, `map_pending`, `locate`, `shared_ack` and the
`shared_input` row's `config` and `backup` are not compared.

Recorded Python outputs also check Line pairing, map geometry, configuration
discovery and malformed Lines replies, color parsing, every effect pattern's
payload, zone colors and effect payloads on random renderer states, map
edits, mode commands, Locate, comets and rendering receipts with the rows they
leave, and scripted runs of the display worker with scene restore, native
controls, holds and requested animations on a fake device, and on the Lines and
NL22 Panels as two devices with the worker command's retry loop. The colors, payloads,
effects, pairing, edits and worker runs match exactly; the worker runs on a
manual millisecond clock, as the runtime's is, so its instants match Python's.
The five recorded cases that showed Python's hold after an unsent command's
expiry run as steps instead, because the port holds only after a write that may
have reached the device (PORTING.md, "The runtime module").
Each command's Python receipt is compared, through the controller receipt rule in
`packages/event-contracts/MAPPING.md`, with the outcome the port reported. A map geometry number may
differ by 1e-12 times its magnitude, or by 1e-12 below magnitude 1, because
`Math.sin`, `Math.cos` and `Math.atan2` can differ from the C library's in the
last bit.
`modules/nanoleaf/tests/fixtures/record.py` re-records them from a codex-nanoleaf
checkout, as PORTING.md describes; CI does not run it.

Sonos artwork (#1162) uses the existing playback, runtime and scenario test discovery in CI. After the root build, run `npm run test:playback:built`, `npm run test:tidbyt-module:built`, `npm run test:pixoo:built`, `npm run test:runtime:built`, `npm run test:runtime:scenarios:built` and `node apps/runtime/dashboard/tests/playback-artwork.browser.ts`. The `speaker-artwork` disposable scenario covers both source acquisitions, the no-art handoff and both real display renderers. Unit tests cover Sonos XML extraction, source-specific URL admission, late results and passive content; synthetic evidence does not establish installed or physical acceptance. No workflow change is needed: all of these existing suites are already selected for playback/runtime changes.

## Music producer checks

Use Node 24 and `npm ci`. Run `npm run build`, `npm run typecheck`,
`npm run lint:js` and `npm run test:music-producer:built`, plus event, SDK,
runtime and workflow checks for the authenticated capture integration.
`npm run test:music-producer:native` compiles and runs portable synthetic signal
checks on Linux or macOS. The shared Checks job runs both producer suites.

On macOS, also run `npm run build:music-producer:native` to compile the Core Audio
capture adapter and the separate read-only Music state/position helper. The Music native source workflow runs portable tests and compilation on
macOS 15 with explicitly selected Xcode 26.3 from the
[hosted runner image](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md), including `npm run test:music-producer:adapter` with substituted Core Audio,
AVFoundation authorization and AppleEvent access. Capture cases cover Music and
selected-microphone lifecycle, exact UID selection, input-only IOProc usage and
separate setup operations. Position cases cover pinned process identity, partial
results, descriptor validation and bounded read cancellation. These commands
never start real capture, send application AppleEvents or change permissions.
The owning [producer guide](../apps/music-producer/README.md) records packaging,
permissions and supported input limits. A successful compile is not evidence of
permission behavior, protected-content access, speaker routing or physical sync.

Tests use synthetic PCM, fake sources/clocks and disposable loopback SDK peers.
For microphone contract or selection changes, also run the existing event, SDK,
runtime/core, dashboard unit and full dashboard browser checks. The Music capture
journey covers explicit alias selection, refusal/retry, both contract versions
and reload without replay. Existing shared, core, App verification
and Music native source CI discovery runs these checks; no real microphone API
is invoked by the adapter tests.
Keep real audio-derived observations and camera recordings private. Installed
capture, microphone and light trials belong to the selected music pilot.


Calibration and response tuning (#721) use the existing event, runtime, Nanoleaf
and dashboard CI discovery. After `npm run build`, run `npm run typecheck`,
`npm run lint:js`, `npm run test:events:built`, `npm run test:sdk:built`,
`npm run test:music-producer:built`, `npm run test:nanoleaf:built`,
`npm run test:runtime-dashboard:built`, the focused
`node --test apps/runtime/dist/tests/music-capture*.test.js` suites and
`node apps/runtime/dashboard/tests/music-capture.browser.ts`.
Core persistence and command-path changes also require the full runtime/scenario
checks described above. Complete `npm run check:workflow` and
`npm run test:workflow` for planning/specification changes. Fake clocks and
synthetic derived windows establish calibration bounds and response parity.
Clock checks cover first-window-relative elapsed time, exact uncertainty bounds,
repeated timestamps, compressed bursts, backwards receipts and delayed delivery;
these checks never access a microphone or qualify physical acoustics.

The Audio Music lighting controls (#722 over #1272) use the existing dashboard
unit discovery and the hosted smoke entry. After `npm run build`, run
`npm run typecheck`, `npm run lint:js`, `npm run test:runtime-dashboard:built`
and `node apps/runtime/dashboard/tests/music-lighting.browser.ts`. The journey
uses the real disposable core and Nanoleaf module on simulated Lines and NL22
Light Panels controllers with the numeric producer fixture. It sends no physical
device command and qualifies no installed or physical behavior.

The Music playback adapter (#571) uses those same producer/native commands and
the existing event, SDK, runtime and playback test discovery. Native playback
tests substitute process discovery, permission and every AppleEvent call; the
portable operation tests run in `test:music-producer:native`, and the macOS
descriptor cases run in `test:music-producer:adapter`. The native build also
compiles the separate playback helper without invoking its observation/control
modes. The existing Music native workflow runs all three commands.
After build, run `npm run test:events:built`, `npm run test:music-producer:built`,
`npm run test:playback:built`, `npm run test:sdk:built`,
`npm run test:runtime:built` and `npm run test:runtime:scenarios:built`.
The connected fixture uses the actual gateway/core/playback owner and a native
substitute, with authenticated actions, separate producer grants, synthetic
metadata and zero real playback calls. Receiver scenarios must retain both
in-process and remote coverage. These checks do not qualify app permissions,
selected speaker routing, physical controls or timed-show synchronization.

## Playback module checks

Hub #929 moves the old Hub's shared playback, with its Sony HT-A9 and Sonos Move
sources and their tests, into the runtime as `modules/playback`, under the
[strict profile](#strict-profile-for-new-code). The runtime ships it; its
[README](../modules/playback/README.md) covers the record, the commands, the
configuration and its conversion, and the provenance.

Use Node 24 and run `npm run build`, `npm run typecheck`, `npm run lint:js` and
`npm run test:playback` from the worktree root. `test:playback` builds, then runs
`test:playback:built`: the compiled tests in `modules/playback/dist/tests/`. The
core CI job runs `npm run test:playback:built` after its fresh build. The suite
needs no speaker: the HTTP tests use fake speakers on the loopback interface,
and the module tests use the simulated speakers on a manual clock and run the
module test kit. `artwork-fetch.test.ts` also verifies the qualified same-receiver
port 58080 acquisition and zero fetches for refused hosts/ports, credentials and
fragments, while retaining redirect refusal on both admitted origins.
The runtime's `speaker-playback` catalog scenario runs the
module in `test:runtime:scenarios:built` and in disposable runs. The old Hub's
`apps/hub/tests/playback.test.mjs` keeps testing the Hub's own copy, which stays
until #839.

## Local controller host checks

Hub #289 adds `apps/local-controllers`, the loopback host that serves controller
v1 and the LIFX `lifx-light` profile for the in-process Tidbyt and LIFX
controllers. Use Node 24 and run `npm run build`, `npm run typecheck` and
`npm run test:local-controllers` from the worktree root, plus the controller
contract, Tidbyt, LIFX, hub, MCP, dashboard and workflow checks. It is an
[old system check](#old-system-checks) that runs locally, not in CI.

The suite starts the real host with a fake Tidbyt connection, fake LIFX
transports and a loopback feed from a real in-memory shared owner. It covers
private configuration, authentication, scope and device grants, browser and
Host checks, body, depth and in-flight bounds, Tidbyt `unsupported-capability`
receipts and refused frames, LIFX tickets, guards, replay and conflicts, the
202 `queued` answer, the lighting profile route, writer leases against a second
host or runner, CLI start and stop, and restart without replay. It also runs the
real hub against the real host over HTTP and MCP, and checks the hub's lighting
validator against the LIFX profile schema. `npm run test:dashboard:browser`
adds `apps/dashboard/tests/local-controllers.mjs`, which drives the Tidbyt and
LIFX views through the same host. Hub #330 adds on-demand read cases: one
LightGet for a missing or 30-second-old observation, none inside 30 s or for an
unqualified bulb, and a failed read keeping its observation. The browser
scenario adds the Power starting value from unknown and observed power, the
not-declared lines, an unreachable bulb and the distinct disabled button colors.
`apps/dashboard/tests/layout.mjs` fails any checked view whose text overlaps. No check contacts a
device, the Tidbyt cloud or the LAN. Installation and the physical brightness
check stay separate.

Hub #20 adds an optional `lifx.status` feed block and a per-bulb `status`
block (`brightnessCapPercent`, `quietCapPercent`, both 1-100) to the private
host configuration; a qualified bulb paints automatic status only when both
are present, through a `LifxStatusPublisher` the host starts and stops
alongside the Tidbyt runner, reusing its `HubStatusFeed` from
`@jimmie-potts/agent-status`. `apps/local-controllers/tests/config.test.mjs`
covers the new fields' defaults and validation (bad hub URL, empty owner ID,
out-of-range or fractional caps, unknown fields), and
`apps/local-controllers/tests/host.test.mjs` drives one end-to-end paint
through a real loopback hub and a bulb configured with a status block, while
confirming a bulb without one never paints even though it is qualified. The
host derives the controller's `modeStateRoot` from its own lease root
(`<leaseRoot>/modes`) rather than relying on any package default; a dedicated
test confirms a `mode.set` file lands there. Every LIFX status test that
starts a real controller or host passes its own test-scoped `modeStateRoot`/
lease directory; never the default path under the developer's home, which
the source checks must not touch.
`apps/dashboard/tests/local-controllers.mjs` extends its existing LIFX
scenario with the mode control: Work disables color and temperature with the
ADR 0005 reason and a one-click Switch to Free, which re-enables them, while
power and brightness stay mode-independent throughout.

## Session retirement checks

See [Session retirement checks](../apps/hub/DEVELOPMENT.md#session-retirement-checks) for the authoritative procedure.

## Shared title and project checks

See [Shared title and project checks](../apps/hub/DEVELOPMENT.md#shared-title-and-project-checks) for the authoritative procedure.

## Owner capacity checks

See [Owner capacity checks](../apps/hub/DEVELOPMENT.md#owner-capacity-checks) for the authoritative procedure.

## Claude Desktop host session checks

See [Claude Desktop host session checks](../apps/hub/DEVELOPMENT.md#claude-desktop-host-session-checks) for the authoritative procedure.

## App verification and preview runs

See [App verification and preview runs](../packages/app-verify/TESTING.md#app-verification-and-preview-runs) for the authoritative procedure.

### Host routing checks

See [Host routing checks](../packages/app-verify/TESTING.md#host-routing-checks) for the authoritative procedure.

## Pixoo module checks

`modules/pixoo/` is the Pixoo runtime module, `@jimmie-potts/pixoo` (#843), built
from the packages and presentation imported for #25. Its
[README](../modules/pixoo/README.md) describes the module and records the
source commit, the edits and every file left in divoom-app-upgrade. Use Node 24
and run `npm ci`, `npm run build`, `npm run typecheck`, `npm run lint:js` and
`npm run test:pixoo` from the worktree root, plus `test:runtime:built`,
`test:runtime:scenarios:built`, `check:workflow` and
`test:workflow`. Select local disposable scenarios or the full verification
suite under [Runtime verification runs](#runtime-verification-runs).
The build compiles the module and its tests
(`tsc -p modules/pixoo/tsconfig.json`) before the runtime, which ships it. The
core CI job runs `test:pixoo:built` after its fresh build.

`apps/runtime/tests/moment-refusal.test.ts` runs the actual Pixoo and Tidbyt
modules with simulated transports through the core tracker. It checks that a
missed moment start is recorded as an owner refusal with no effect, retains the
window explanation, and is not replayed. After the build, run
`node --test apps/runtime/dist/tests/moment-refusal.test.js`; the existing
`test:runtime:built` CI suite includes it. The registered `missed-moment-start`
scenario adds the authenticated HTTP gateway and both real handlers, with
Pixoo and Tronbyt simulations. It checks the reply, owner, operation record,
zero moment writes and duplicate refusal. Run it after the build with
`node --test --test-name-pattern='missed-moment-start' apps/runtime/dist/tests/scenarios/catalog.test.js`;
the existing `test:runtime:scenarios:built` CI suite discovers it, and
`scenario-missed-moment-start` is its disposable acceptance capture.

The Pixoo command-boundary and media tests (#1500) run in the existing
`test:pixoo:built` CI suite. Exercise 21, 59 and 60 direct frames, an imported
and hosted animation above 1,000 frames, decoded output and manifest byte
budgets, historical rendition identities and unchanged writer exclusion.
The registered `pixoo-command-limits` scenario checks authenticated staged
upload, admission on a direct configuration, unchanged display after refusal,
and timing through the final preview PNG. Run
`node --test --test-name-pattern='pixoo-command-limits' apps/runtime/dist/tests/scenarios/catalog.test.js`
after the build. Its capture step is `scenario-pixoo-command-limits`. The
dashboard journey `node apps/runtime/dashboard/tests/pixoo-pages.browser.ts`
checks route explanations and bounded thumbnail decoding in Chromium.
For the extended Art stage and dispatch contracts run `test:events:built`,
`test:events:python`, the controller package consumers, and
`node --test apps/runtime/dist/tests/art-handoff.test.js`.

The reusable Pixoo controls (#1154) add atomic populated creation coverage to
`modules/pixoo/tests/integration/library.test.ts` and browser journeys to
`apps/runtime/dashboard/tests/pixoo-pages.browser.ts`. Run that browser file
after the root build for animated media browsing, playlist drafts and the shared
Home/device/Player card. The browser suite also checks HTTP-only uncertainty in
both directions between card and advanced controls, retained identity across
navigation/reload, and
visible preview cleanup while a replacement owner sync is held. The library
regression is discovered by the existing core CI `test:pixoo:built` suite;
the dashboard smoke journey covers the card's passive Home mount in App verification. These checks use synthetic media and a
disposable simulated owner, and make no physical-device claim.

`test:pixoo:built` runs two suites from the build:
- The moved tests keep Vitest and run from `modules/pixoo/dist/tests`
  (`vitest.config.mjs`), so files that the code forks or starts by path resolve
  beside it. They cover:
  - the fake (simulator) adapter, and the HTTP adapter against loopback stand-ins;
  - rendering through sharp's prebuilt libvips binaries;
  - the SQLite library and its migrations;
  - playback and recovery;
  - hosted GIF transfer;
  - Monitor and Now Playing presentation over 2.0 records;
  - the module's command handling, with the three restored cancellation cases.
- The module's own tests run with node:test from `dist/tests/module`: the
  module test kit's checks, policy A's included; its behavior on a test bus with
  stand-in owners; its configuration and settings conversion; and the library
  migration (#931) on a synthetic library of the installed schema version 3,
  which they write with the module's own code and media child process: what it
  carries and leaves in the backup, its refusals, the verifier's count of each
  planted corruption, the module's start on the migrated store, and a source
  left unchanged.

No test contacts a device or the installed Pixoo service: the module runs with
`SimulatedPixoo`. Test listeners go through
`modules/pixoo/tests/helpers/loopback.ts`. A test that launches a listening
process uses `modules/pixoo/tests/helpers/launch.ts`. Both retry instead of
keeping an installed service's port, such as 41230 or 41231. On 2026-10-07 the
Vitest suite took about 8 s locally for 31 files and 310 tests, and the module's
node:test suites about 35 s for 37 tests.

Generated-art admission uses `modules/pixoo/tests/module/art.test.ts` and the
existing `test:pixoo:built` CI suite. It exercises synthetic PNG/GIF staging,
original preservation, decoded previews and timing, sender/profile refusals,
duplicate renewal, reference-safe cleanup, restart and exact-art moments through
the simulated writer. The `pixoo-art` runtime scenario covers the core handoff.
Run these alongside the module and affected runtime checks above; no real art,
provider key or device is needed.

After the import, divoom-app-upgrade takes only bug fixes. Mirror each one here.

For artwork, after the root build, run from `modules/pixoo`:
`npx vitest run --config vitest.config.mjs dist/tests/unit/now-playing-artwork.test.js dist/tests/unit/artwork-admission.test.js`.
These checks cover full RGB expectations, bounded decoding, delayed/queued
association changes, no-effect cancellation versus partial uncertainty,
attention and Media `off`/`popup`/`whole` deadlines. The module's
`node --test --test-name-pattern='artwork|playback/2.1' modules/pixoo/dist/tests/module/module.test.js`
check runs from the root, using real workers and the simulated device. Run the
shared `speaker-artwork` scenario above and retain its disposable capture under
[Runtime verification runs](#runtime-verification-runs). All are discovered by
the existing CI suites; no check contacts an installed service or device.

## Pixoo catalog and preview checks

Hub #353 adds `apps/hub/tests/pixoo-catalog.test.mjs` to the existing Hub and
packaged Hub suites. It covers minor-version negotiation and fallback, scoped
catalog reads, pagination, exact frame bytes and hashes, conditional membership,
malformed responses and zero command writes. Its reusable synthetic catalog and
PNG generator live in `apps/hub/tests/pixoo-catalog-fixture.mjs`.

`apps/dashboard/tests/pixoo-client.test.mjs` covers authenticated PNG scheduling;
`apps/dashboard/tests/pixoo-media.mjs` runs in `test:dashboard:browser`. It checks a 20-frame variable-delay animation,
full-color pixels, ordered/unnamed playlists, pagination, catalog
revision refresh, hidden-widget cancellation and mobile overflow.
It also pages away from a slow preview read still in flight (Hub #946): the next
page of media must wait for the controller's answer, because the hub holds its one
slot until then, instead of being refused with `capacity`. `client.test.mjs` covers
the same queue rules without a browser.
The shared dashboard fixture changed, so run `npm run test:hub:verify` too.
`DASHBOARD_RECEIPTS` selects a disk-backed screenshot and receipt directory.

After updating the producer pin, run `node scripts/check-hub-pixoo.mjs
/absolute/prepared/pixoo` against the built producer. It uploads a synthetic PNG
into its disposable simulator, then compares the native cached frame with the
Hub client's manifest/PNG routes and checks conditional 304. No live catalog,
installation or device is touched. Retain all ordinary Hub, dashboard, shared
contract/state/MCP and workflow checks.

The Pixoo catalog browser regression `apps/dashboard/tests/pixoo-refresh.mjs` covers all declared playlist names across pagination and profile compatibility after a server restart with an unchanged catalog revision. It runs in the existing dashboard browser suite against synthetic controllers.


## Shared observability contract checks

See [Shared observability contract checks](../packages/observability/TESTING.md#shared-observability-contract-checks) for the authoritative procedure.

## Shared observability pilot checks

See [Shared observability pilot checks](../packages/observability/TESTING.md#shared-observability-pilot-checks) for the authoritative procedure.

### Source validation

See [Source validation](../packages/observability/TESTING.md#source-validation) for the authoritative procedure.

### Local synthetic qualification

See [Local synthetic qualification](../packages/observability/TESTING.md#local-synthetic-qualification) for the authoritative procedure.

### Cleanup and retained evidence

See [Cleanup and retained evidence](../packages/observability/TESTING.md#cleanup-and-retained-evidence) for the authoritative procedure.

### Existing Grafana viewer

See [Existing Grafana viewer](../packages/observability/TESTING.md#existing-grafana-viewer) for the authoritative procedure.

### Functional disposition and deferred work

See [Functional disposition and deferred work](../packages/observability/TESTING.md#functional-disposition-and-deferred-work) for the authoritative procedure.

## Shared host diagnostics checks

See [Shared host diagnostics checks](../packages/observability/TESTING.md#shared-host-diagnostics-checks) for the authoritative procedure.

## BB-8 hibernation

BB-8 is hibernated indefinitely by owner choice. Its dedicated module/helper,
package and browser scripts are removed from normal commands and CI. Runtime
scenario discovery and shared upgrade/browser cases exclude BB-8 behavior.
Dedicated test sources remain with a `.hibernated` suffix. The module's package
marks `bunny.hibernated: true`, so generated runtime and frontend registries omit
it; root build/typecheck/lint and workspace installation omit the dormant module/helper. Build removes their
obsolete generated output so an existing checkout cannot rediscover old tests.

Retain schemas, source, private state and ownership/layout guards. Routine
upgrades follow the focused change-assessment and independent recovery policy
in [UPGRADE.md](../apps/runtime/UPGRADE.md); dormant phase certificates are not
a forward-admission gate.
Generic inventory fixtures may name retained source paths without importing or
executing BB-8. A new owner decision and restored validation are prerequisites
for resumption. The owning [module](../modules/bb8/README.md) and
[helper](../apps/bb8-windows/README.md) guides preserve historical protocol details.

## ONN module checks

ONN is hibernated. Dedicated module, native-reader, browser, scenario and qualification checks are retained as dormant sources and are excluded from default build and CI. Run `node --test tests/onn_hibernation.test.mjs` for active registry absence. Build/typecheck/lint, workflow/CI-selection checks and shared runtime/dashboard checks remain required for hibernation changes. The shared television-viewport keyboard journey remains active. Historical instructions remain in the [module guide](../modules/onn/README.md).

## Roborock module checks

After the root build, run
`node --test apps/runtime/dist/tests/scenarios/roborock.test.js` and
`node --test apps/runtime/dist/verify/tests/roborock.test.js` for the offline and
recovery catalog checks. Offline preparation captures a revision for that action
and waits at most 10 seconds of requested harness waits for a newer reader
revision, then keeps the separate 10-second unavailable check. The preparation
revision can come from an earlier read or maintenance; it does not establish
collector completion or an offline observation. The controls cover an 8-second
successful read already in flight followed by a 4-second offline read, a frozen
reader revision, a missing transition and actual history/time faults. Each read
retains its existing nine-second transport and ten-second collector bounds.
The deterministic scheduling example proves a verification timing assumption;
it does not identify the cause of a historical hosted failure.

The reusable card (#390) extends `test:roborock:browser`, already selected by
App verification, and the module/dashboard unit suites. After the root build,
run `npm run test:roborock:built`, `npm run test:roborock:consumer:built`,
`npm run test:runtime-dashboard:built` and `npm run test:roborock:browser`.
The focused browser journey checks Home/page reuse, passive tabs and history,
fixed geometry, source freshness/refusals, scoped cleanup, keyboard access and
light/dark desktop/phone layout. Use synthetic inputs only; this does
not establish installed or physical acceptance. Keep the shared build/type,
contract/workflow checks and full dashboard browser suite below.

Use Node 24 and `npm ci`, then build before type-aware lint. Run
`npm run build`, `npm run typecheck`, `npm run lint:js`,
`npm run test:roborock:built`, `npm run test:roborock:consumer:built` and
`npm run test:roborock:browser`. The module suite includes the SDK module test
kit; the transport retains its separate transport and consumer suites.
Collector regressions cover a completed cleaning record followed by returning
and docking: eligible cleaning samples and an unverified map capture remain
available, while returning-only observations cannot attach an old run or fetch
its map. Returning originals remain private even when outside the run window.
They also cover a failed first poll that recovers without a restart, including
with a clock that moves between reads, repeated failure at the capped backoff,
a target load that never settles, shutdown during a failed observation, and
steady polling with timer lag that records no `missed-poll` gap, over the real
reader and a synthetic wire.

Run the affected event, SDK, runtime, MCP and runtime-dashboard suites, plus
`npm run check:workflow` and `npm run test:workflow`. The Roborock catalog
scenario runs over both in-memory transports. Follow
[runtime development](../apps/runtime/DEVELOPMENT.md) for its focused disposable
run and full-suite triggers. These checks use synthetic records and simulated
transport. Source success does not establish installation, current
account/device compatibility or map attribution.

## Companions source checks

Browser speech (#1097) uses the existing companion unit discovery and
`test:companions:browser` journey. After the root build, run
`node --test modules/companions/dist/tests/speech-driver.test.js` for bounded
local voice discovery, final permission checks, callback ordering, Stop, mute
and uncertain output without replay. The existing core CI module group runs
these tests. `speech-coordinator.test.js` verifies manual availability, one
active/one pending candidate, priority cancellation, missing receipts, delayed
policy, full disk and restart/outbox recovery. Runtime's `companion-speech.test.js`
checks the internal tracked adapter; `speech-live.test.js` uses the real gateway
and two SDK browser sessions to check selected output, Quiet/mute and no catch-up.
Both are discovered by the existing runtime CI suite. The `speech-session`,
`speech-browser`, `speech-qualification` and `speech-qualification-file` unit
files check immediate local cancellation, ordered receipt writes, late endpoint
registration, failed browser hints and private receipt refusal. The existing
companions browser entry calls `speech.browser.ts` against a disposable real
runtime with synthetic browser identity and audio. It exercises explicit selection,
completion, Stop, mute, category/Quiet suppression, delayed voice rechecks,
reload/disconnect/restart silence, uncertainty, reader controls and desktop/phone
keyboard checks. `speech-readiness.ts` mounts the real Reachy page and delivers companion or
speech-state restart, failure and removal, category mute, text disable and
restrictive speech availability before React renders, then resolves pending
voice discovery. Each must submit zero audio; an unchanged eligible control
must still submit once. Endpoint changes also
require event schema, SDK remote, runtime
gateway and dashboard tests, plus root build/type/lint and shared contract and
workflow checks. Browser checks use fake audio and synthetic inputs; they do
not establish installed playback or human perception.

The runtime verification `browser-speech` capture uses the real synthetic runtime
and dashboard with fake browser speech. Its existing `steps.test.ts` catalog entry
runs under the App verification checks; the dashboard speech journey shares the
same browser fixture. Run `npm run build` before either. This capture covers
manual availability and controls without playing native audio; installed Chrome
acceptance remains separate.

Coding suggestions (#1098) use the existing companion unit discovery and
`test:companions:browser` hosted journey. After the root build, run
`node --test modules/companions/dist/tests/suggestions.test.js` for the fixed
attribution/relevance corpus and policy, freshness, revision and isolation
refusals. The browser journey checks the deliberate form, explicit clipboard,
supersession/disconnect, keyboard and narrow viewport. Existing core and
App verification CI include both commands; no new suite/job is needed. Run
root build/type/lint, companion and runtime/dashboard tests, shared contract and
workflow checks, and the full runtime dashboard browser suite. Use synthetic
evidence only; this provides no installed-client or physical acceptance.

The Duck Home widget (#662) uses the existing companion unit suite, runtime
scenario discovery and companions browser journey. Check explicit selection,
latest/history isolation, correction/removal, restart, stale/denied reads,
keyboard and narrow layout. Existing CI already selects these suites for
companions/dashboard changes; no new job is needed. Use only synthetic data.

Reusable companion cards (#1230) extend the same companion browser journey with
Home/page reuse, explicit conversation selection, stationary artwork, stable tab
geometry, qualified speech lifetime and replacement-sync privacy.
Run the focused `node apps/runtime/dashboard/tests/companion-cards.browser.ts`
after the root build, then `npm run test:companions:browser` and the full runtime
dashboard browser suite. Existing companion/runtime/dashboard test discovery and
App verification CI cover these paths; no new CI job is required. Use private
disposable synthetic state, never installed voices, conversations or robot output.

The B.U.N.N.Y. conversation (#46) adds `assistant.test.js`, `anthropic.test.js`
and `configure.test.js` to the companions suite: the turn loop with approval,
decline, stale approval, uncertain dispatch, allowlist refusal and provider
refusal/truncation/fault codes; the Anthropic adapter's request shape,
tool-use parsing, usage, error mapping and abort against a fake transport; and
the section with a keyed provider through the harness's secret. After the root
build run `node --test modules/companions/dist/tests/assistant.test.js modules/companions/dist/tests/anthropic.test.js modules/companions/dist/tests/configure.test.js`,
`node --test apps/runtime/dist/tests/assistant-dispatch.test.js` for the core's
admission of the module's `assistant-dispatch` command, `node --test packages/event-contracts/tests/assistant.test.mjs`
for the dispatch family and the state's provider, model and tool fields, the
`assistant-task` and `assistant-mode-approval` catalog scenarios over both
transports and in a disposable runtime, and `npm run test:companions:browser`
for the conversation page's approved and declined proposals across reload,
clarification with the read tool, cancellation, keyboard and narrow viewport.
The companions module now takes a section (an empty one keeps the synthetic
default), so harnesses that start it pass one. Existing core, runtime and App
verification CI discover these checks; no new job is needed. They use the
synthetic provider and fake transports only: no live provider, key, installed
client or device is exercised.

Use Node 24 from the worktree root. `npm run build`, `npm run typecheck`,
`npm run lint:js` and `npm run test:companions:built` check the optional
[companions module](../modules/companions/README.md). The core CI module
group runs that suite. Event-family validation runs in `test:events:built`;
core intake, gateway and duplicate/recovery checks join `test:runtime:built`.
Run the `reachy-text`, `assistant-task`, `assistant-mode-approval`, `preferences` and `companion-knowledge` catalog scenarios over both transports and in a disposable
runtime, and the companions browser journey in the runtime dashboard suite.
These are synthetic source checks; installation remains a separately selected batch.

The companions suite includes real process exits after a checkpoint, after answer
admission and during a call, plus fake-clock budgets, full disk and outbox recovery.
Shared profile 1.6 diagnostic changes require the observability JS/Python,
query, archive-consumer and browser checks listed in its owning guide. Assistant
and Reachy states use one owner revision sequence and the SDK's combined sync
contract. The dashboard keeps React contributions mounted during reconnect so
private history and drafts remain readable; the existing host command control
locks writes against stale operations.

### Home-Wi-Fi dashboard verification

The optional HTTPS browser entry uses `apps/runtime/tests/wifi-proxy.test.ts`,
discovered by the Runtime unit tests CI job, alongside the gateway suite. The owning
[runtime checks](../apps/runtime/DEVELOPMENT.md#runtime-checks) and
[setup recipe](../apps/runtime/WIFI.md#source-verification) describe the focused
Caddy/phone-width browser journey. It uses synthetic controls and keeps actual
installed iPhone acceptance separate; the root build, typecheck, JavaScript lint,
SDK, contracts and workflow checks remain applicable.

Coding delegation (#502) uses the same discovery. After the root build, run
`node --test modules/companions/dist/tests/coding-coordinator.test.js` for one
endpoint, one operation, the tracked outcome at start, result delivery, refused
and missing starts, a lost endpoint, restart without resend and cancel;
`assistant.test.js` covers the delegation end to end through the module with a
fake worker on the bus. Runtime's `coding-access.test.js`, `coding-dispatch.test.js`
and `coding-worker.test.js` check the credential role's endpoint-only grant, the
core's forwarding of `coding-dispatch`, and the worker over a fake harness and a
temporary repository; `test:events:built` discovers `coding.test.mjs` for the
seven families. The companions browser entry calls `coding-delegation.browser.ts`,
which connects a fake worker through the real gateway with the coding-worker
credential and drives a proposal, approval, wait and result on the Conversation
page. Installing the worker on the Mac is the [worker guide](coding-worker.md);
source evidence establishes no installed run.

## Runtime upgrade operator checks

Use Node 24 and `npm ci`, then run `npm run build`, `npm run typecheck`,
`npm run lint:js`, `npm run test:runtime:built`, `npm run check:workflow` and
`npm run test:workflow`. The existing runtime CI job runs these operator tests.
Focused request/source/path/composition regressions cover retained inactive owners,
two-release integrity, stale requests, optional recovery, drift, lock, ownership
and bounded health. Procedure fixtures exercise stopped-writer backup, selection,
receipts and interrupted resolution using synthetic state. Recovery remains
independent of forward eligibility; no checks execute hibernated BB-8 code or
qualify an installed/physical device.

## Local Mac Codex hook checks

Remote hook qualification (#566) builds with Node 24, then runs
`node --test packages/sdk/dist/tests/remote-publish.test.js apps/runtime/dist/tests/hook.test.js apps/runtime/dist/tests/remote-hooks.test.js`
and the native wrapper suite below. HTTPS fixtures use the host's `openssl` to
create a disposable synthetic certificate; they never disable certificate
verification. These suites are already discovered by the SDK and runtime core
CI commands. The Linux resolver regression compiles its synthetic
`stalled-dns.c` fixture with `cc` and uses `LD_PRELOAD` only in disposable hook
subprocesses. It proves both entrypoints terminate a real pending resolver at
their own deadline, with literal-IP controls; other platforms explicitly skip
this Linux fixture. It contacts no DNS server. Run build/type/lint, SDK, event and existing contract-consumer tests,
plus workflow checks. Disposable TLS and four synthetic host/provider feeds do
not qualify installed clients, source credentials or the real private route.

For #1183, use Node 24 and build before lint/type checks. Run the existing
lifecycle JS/Python corpus, agent-state JS/Python/package and event-family checks,
plus runtime hook tests and dashboard session tests. The native wrapper suite is
`node --test apps/runtime/tests/mac-codex-hook.test.mjs`; existing core runtime CI
runs it explicitly because `.mjs` source tests are not TypeScript outputs.
Run container entrypoint/operator tests for exact single-source admission and
refusal of wider grants. Shared contract, MCP, workflow and affected consumer
checks remain required. Synthetic tests do not qualify an installed Codex client:
Mac acceptance must observe local Desktop and CLI hooks separately, verify
existing Computer Use configuration/notify preservation and supported browser operation,
metadata-only delivery, loopback-only access and stopped backup/restart. Internal
notification-helper delivery remains unproven; no undocumented invocation is
part of acceptance.
Cloud-orchestrated tasks and physical devices remain outside this qualification.

## Explicit preference checks

For #501, after the root build run `node --test modules/companions/dist/tests/preferences.test.js`
for the private SQLite lifecycle, active-only retrieval, additive import, repeated/old
exports, invalid input, transaction rollback and SQLite full-disk refusal. Existing `test:companions:built` CI
discovery includes it. The runtime `preferences` scenario covers authenticated reads,
reader refusals, metadata privacy and restart over both scenario transports.
`npm run test:companions:browser` includes the real preference page, clipboard,
private import/export and keyboard checks. Preserve build/type/lint, affected
event/runtime/SDK consumers and workflow validation. All data is synthetic; these
checks neither install the feature nor qualify a live model or physical device.

## Qualified Mac batch operator checks

The existing operator suite includes a synthetic native Windows boundary check:
with `process.platform` set to `win32` and no `getuid`, manual start and stop,
and named-volume backup and restore, retain their Docker paths without POSIX
coordination files. A separate Mac boundary check refuses missing UID support
before Docker work. These are source regressions, not new Windows qualification.

Use Node 24 and `npm ci`, then `npm run build`, `npm run typecheck`,
`npm run lint:js`, `npm run test:deployment`, `npm run check:workflow` and
`npm run test:workflow`. The runtime CI group runs the operation/deployment tests
beside the existing container operator and backup suites. These synthetic tests
cover qualification and target refusals, stopped backup ordering, preserved latest
state, failed client/start handling, operation contention, manual maintenance
exclusion, interruption reconciliation and latest-state/config-bound image return.
The shared qualification suite owns hosted receipt/job/artifact negative cases.

For the explicit Docker exercise, select two local immutable ARM64 production
image IDs in `BUNNY_BATCH_TEST_PREVIOUS_IMAGE` and `BUNNY_BATCH_TEST_TARGET_IMAGE`,
then run `node scripts/tests/bunny-deployment.docker.mjs`. It creates a new random
project and fresh synthetic volumes, with network `none`, no published port and
control disabled. It verifies real stopped backup, replacement, core health,
browser session protocol, release recording and the previous production runtime
reopening a copy of the candidate's latest core state. It removes only its owned
test resources and confirms their absence. Its injected qualification is synthetic;
this is not a hosted release or installed/client/physical acceptance claim.
The [operator guide](bunny-container.md#deploy-a-qualified-batch) owns real operation.

## ONN backup and qualified maintenance helper checks

Use Node 24 and `npm ci`, then run `npm run build`, `npm run typecheck`,
`npm run lint:js`, `node --test scripts/tests/bunny.test.mjs
scripts/tests/bunny-backup.test.mjs scripts/tests/bunny-deployment.test.mjs
scripts/tests/bunny-operations.test.mjs`, `npm run check:workflow` and
`npm run test:workflow`. Existing runtime CI test discovery includes these files.
The worker suite requires Linux private-file semantics; Mac reports those cases
skipped. It covers raw configuration, version 1/2 readers, zero filesystem access
for declared ONN dependencies, refusal of dependency/secret-reference overlap
before reference I/O, secret and descriptor tampering, WAL/keys/assets,
real lease contention and interruption. Packaged ARM64 qualification runs that
same worker suite in its `scenarios` lane. Negative controls run the launcher
both without a lane and as each lane's command. A failing helper, or any other
packaged file, fails the run. Host tests cover the qualified helper's
old target and actual image identity, raw/serialized helper refusal, authenticated
pinned-main ancestry before download/load (including an authentic-looking green
unmerged run and unavailable or contradictory comparisons), safe stderr
and unchanged native Windows default commands.

For the actual old-image/new-helper exercise, select local immutable ARM64
production IDs in `BUNNY_BACKUP_TEST_OLD_IMAGE` and
`BUNNY_BACKUP_TEST_HELPER_IMAGE`, then run
`node scripts/tests/bunny-maintenance.docker.mjs`. It creates fresh synthetic
projects/volumes with network `none`, no published port, disabled control and
nonexistent synthetic host dependencies. It proves the old refusal, byte-exact
full configuration, helper/source attribution, real lease refusal, wrong helper
refusal, changed-secret refusal before target writes and a separate empty-target
round-trip retaining inactive synthetic ONN state. It verifies exact owned-resource
cleanup. Its qualification metadata is an explicitly controlled test fixture;
only the actual hosted intake qualifies a real helper. No installed system,
personal client, host dependency, ADB server or physical device is accessed.

## MicroDuck simulator checks

Before product implementation, #623 adds `test:microduck:built` for module tests
and `test:microduck:browser` for tracked dashboard controls. Use Node 24, npm ci,
build, typecheck and lint:js, plus test:events:built, test:sdk:built,
test:runtime:built, test:runtime:scenarios:built, test:runtime-dashboard:built,
check:workflow and test:workflow. CI runs module tests for modules changes and
browser checks for runtime changes. The module guide owns the private fixture
setup and vendor pins. Ordinary CI uses fakes; real robotd/MuJoCo acceptance is
separate in an isolated Linux ARM64 fixture. No installed or hardware evidence
is inferred. Test Stop independently of pending replies, both process-loss
directions, lossless sensor freshness, missed return windows, exact held-neutral
recovery, durable suppression, restart/outbox and status-only MCP.

MicroDuck and Reachy control journeys allocate a private per-invocation proof
directory under `DASHBOARD_RECEIPTS`, or the system temporary directory when no
parent is selected, and print the screenshot path. Their world cleanup retains
that proof. Other dashboard journeys keep their existing `DASHBOARD_RECEIPTS`
or explicit output-directory arguments. Select a unique private directory per task.
Run
`node --test apps/runtime/dashboard/tests/browser-artifacts.test.ts` for output
isolation, retained bytes, private permissions and refusal of an unusable parent.
The existing dashboard unit discovery includes these checks. The vendor-only
MicroDuck `/proof` paths remain inside that exercise's separately owned container.
