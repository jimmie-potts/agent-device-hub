# Development setup

## System design documents

The HTML under `docs/system-design/` preserves the September 19, 2026 design
snapshot. Its implementation labels and issue states describe that baseline;
GitHub issues and owning application guides supply current status. Routine
product delivery does not rebaseline it. For an intentional snapshot revision,
edit `source/*.html` and `design.json`, then regenerate the overview, component
pages and complete reading view. `assets/` holds the shared style and browser
behavior. The inventory records the template set and source revision receipts.

```bash
python3 docs/system-design/build.py
python3 docs/system-design/build.py --check
python3 docs/system-design/check.py
node docs/system-design/check.cjs
```

The overview's system map and agent observation walkthrough are not authored
under `source/`. They come from the shared definitions `D2` and `D3` in
`docs/work-guide/work/architecture_diagrams.py`, their Archify renderings under
`docs/work-guide/work/architecture/rendered/`, and the atlas-owned link inventory
in `design.json` (`map`). To change either diagram, edit the definition, render
with the installed archify skill (`ARCHIFY_DIR=... python3
docs/work-guide/work/architecture_diagrams.py`), rebuild the guide and the atlas,
and run both check sets. `check.py` fails when a saved specification or rendered
SVG no longer matches its definition or receipt.

The generator and static check use Python's standard library. Browser checks use
installed Playwright/Chromium, with the same `GUIDE_PLAYWRIGHT_MODULE` and
`GUIDE_CHROMIUM_PATH` overrides as the work guide. `BUNNY_DESIGN_RECEIPTS` selects
an external screenshot/PDF/receipt directory; the default is a temporary folder.
The Work guide CI job runs these document checks using its pinned browser setup.

The API/database reference is linked from the design navigation. Its Scalar
viewers embed three source-pinned OpenAPI documents; SchemaSpy reports cover the
three existing SQLite schemas. Keep `docs/system-design/reference/` together
when copying the HTML. Bundled assets allow offline browsing. Request controls
are disabled here; the owning services retain their origin and credential rules.
The database reports are generated from fresh empty schema fixtures, never live
controller files. The proposed BUNNY store still has no delivered table schema.

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

For an authorized public atlas publication, export from the exact validated Hub
revision with `python3 docs/system-design/export_public.py /absolute/new/site-stage`.
The exporter stages the generated guide as `site-stage/index.html`, its nine
architecture viewers, and the atlas reading pages, bundled reference assets and
downloadable schema/API metadata under `site-stage/atlas/`. It records atlas
hashes in `atlas/manifest.json`, rewrites links for the public layout and adds
return navigation to the work guide. Run it against a clean
`git archive` as well as the worktree; the archive check catches missing tracked
SchemaSpy assets. The public-repository PR copies the exported bytes verbatim.

## Workflow commands

Use Node 24 and npm from the assigned worktree root:

```bash
npm ci
npm run check:workflow
npm run test:workflow
```

Both checks must exit zero. The product specification inventory is
controller-contracts, shared-mcp-gateway, agent-lifecycle-contract,
shared-monitor-performance-baseline, agent-state-core, agent-provider-emitters,
standalone-hub-host, standalone-hub-mcp, shared-monitor-installation,
unified-dashboard, standalone-monitor-qualification, tidbyt-cloud-controller and
tidbyt-agent-status, plus tidbyt-status-installation.

OpenSpec 1.12.0 is pinned locally. Use npm run openspec -- <arguments>. Its wrapper
isolates configuration and suppresses telemetry/completion migration. Initialize
using init --tools none --profile core --no-animation. Do not generate local
skill integrations or run a global OpenSpec installation.

For a WSL sandbox with a read-only npm cache, use a writable temporary cache.
Keep dependency caches, browser binaries and all runtime state outside source.

Depot CI owns the active workflows under `.depot/workflows/`. It runs on pull
requests and pushes to main, and reports each job as a GitHub check. Superseded
PR revisions are cancelled per workflow and PR; main revisions keep independent
runs. Each job has a ten-minute timeout. Branch pushes do not duplicate PR checks.
The two original workflows under `.github/workflows/` are disabled in GitHub
Actions; their earlier billing-blocked runs do not validate a candidate.

Both Depot workflows use `paths-ignore: ['docs/work-guide/**']` for PRs and main
pushes. Guide-only edits, including generators and tests, retain local guide
validation under [the SDLC exception](sdlc.md#guide-only-ci-exception). Mixed
changes require every configured Depot job. Do not infer filtering from a missing
run alone. Inspect the complete changed-file scope and hosted Depot event and
check records; keep the normal gate when scope or filter behavior is uncertain.
Tag pushes are outside the main-only push trigger. Static tests verify workflow
configuration; only hosted event evidence verifies actual scheduling.

Product CI jobs run `npm run build` and `npm run typecheck` once, then use
`:built` variants of the controller, lifecycle, agent-state, Tidbyt and MCP
TypeScript/package test commands. These variants require output freshly built
in that same job. The
existing standalone commands still build first and stop if compilation fails.
Python commands are unchanged. Python setup caches pip downloads by runtime,
platform and `requirements-contracts.txt`; dependency installation still runs.
No installed dependencies or compiled output are shared between jobs.

Normal Depot CI has six Linux jobs:

| Check | Runtime and coverage |
| --- | --- |
| Workflow checks | Node 24 workflow validation and isolated Linux hook qualification |
| Contracts and state, Python 3.12 | Controller contracts, lifecycle contracts and agent state in both languages, the Tidbyt controller and its Pillow golden-image check, performance checks and isolated package consumers |
| Contracts and state, Python 3.14 | The same suites on the second supported Python version |
| MCP | Node 24 build/type, tool/service tests, loopback protocol tests and isolated archive consumers |
| Work guide | Python 3.12 generation/maintenance and Node 24 browser checks with review artifacts |
| Dashboard | Node 24 build/type, controller-backed browser fixtures and accessibility |

Each combined contracts/state job installs dependencies, builds and typechecks
once before running its suites. The core workflow performs four full builds
across its jobs. Local validation runs the same commands. Later runtime and
browser changes must add their own issue-appropriate checks.

Native Windows is outside the supported CI matrix. Windows development uses
Linux Node/Python runtimes inside WSL. Ubuntu CI does not establish installed
WSL/client or device compatibility. Keep that acceptance evidence separate.
Existing provider qualification records and device ownership are unchanged.

## Depot diagnostic access

Routine merge and main-CI evidence uses the GitHub check records described in
[the SDLC](sdlc.md#depot-ci-evidence). Query the exact SHA with pagination:

```bash
gh api --paginate 'repos/jimmie-potts/agent-device-hub/commits/<sha>/check-runs?per_page=100&filter=latest'
gh api --paginate 'repos/jimmie-potts/agent-device-hub/check-runs/<check-id>/annotations?per_page=100'
```

For reruns or contradictory results, repeat the check-run query with
`filter=all`. Compare the complete expected job set, provider, revision and event
association; the commands alone do not establish eligibility.

When deeper evidence is required, use the supported Depot CLI or
[Depot CI API](https://depot.dev/docs/api/ci/reference), without relying on browser
sign-in. With an installed CLI, discover runs for the repository and SHA, inspect
the matching run, then read the relevant attempt's logs:

```bash
depot ci run list --repo jimmie-potts/agent-device-hub --sha <sha>
depot ci status <run-id> --output json
depot ci logs <attempt-id> --timestamps
```

See the [CLI reference](https://depot.dev/docs/cli/reference/depot-ci) for optional
organization selection and log export. These are read operations; access does
not itself authorize dispatch, retry, cancellation, secret changes or SSH.

An owner provisions authentication outside Git and supplies `DEPOT_TOKEN` through
the agent's secure environment, or uses `depot login` for local development.
Verify access by reading a known run and one job's logs before claiming diagnostic
access is configured. Never paste credentials into chat, command arguments,
committed files or delivery evidence. Keep raw logs outside Git and summarize
only the evidence needed for the task.

Depot's [authentication documentation](https://depot.dev/docs/cli/authentication)
currently permits user and organization tokens for CI, not project or registry
pull tokens. Organization tokens cover one organization; user tokens cover the
user's organizations. Neither is documented as read-only CI access. Prefer an
organization token for this integration and treat its write capabilities as
outside read-only diagnosis. Credential provisioning and successful access
verification are separate from adopting the merge policy; absent diagnostic
credentials do not block otherwise complete routine check evidence.

## Shared tooling provenance

The bootstrap wrapper, validator and fixtures adapt the existing Pixoo tooling
at revision 4fd259b08ff22dcf73938162f7dff67b71d23ed9. They preserve its CLI and
configuration-isolation behavior. This temporary bootstrap copy is recorded;
[agent-device-hub#10](https://github.com/jimmie-potts/agent-device-hub/issues/10) owns publishing the common package, and [divoom-app-upgrade#38](https://github.com/jimmie-potts/divoom-app-upgrade/issues/38) and
[codex-nanoleaf#31](https://github.com/jimmie-potts/codex-nanoleaf/issues/31) own replacing the device copies. No shared skill is vendored.

## Agent setup

Use the reviewed [agent-skills catalog](https://github.com/jimmie-potts/agent-skills)
outside this checkout. The workflow uses code-review, tdd,
grill-with-docs, grilling, domain-modeling, writing-for-agents, unslop and the
OpenSpec propose/explore/apply/update/sync/archive skills.

Use [docs/sdlc.md](sdlc.md) for delivery. Use the shared deliver-work skill only
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
CI. The Nanoleaf worker remains Python; sharing a repository does not require
a common runtime or combined process.

Reserve shared contracts, root package/lockfile changes and CI for the coordinating
writer. Work on separate deliverables uses separate worktrees, even for different
controller directories. Reconcile the latest shared changes before validation.
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

Use Node 24 and Python 3.12 or 3.14 from the worktree root. After npm ci, install
Python dependencies in an isolated environment with
`python3 -m pip install -r requirements-contracts.txt`.

Run `npm run build`, `npm run typecheck`, `npm run test:contracts`,
`npm run test:contracts:python` and `npm run test:package`. Every command must
exit zero. Both languages execute the same 134 schema and 86 semantic cases.
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

`npm run package:mcp` creates `@jimmie-potts/device-mcp` 1.0.0 under artifacts/.
The private controller-contract archive is pinned under vendor/ with its original
release receipt. Packaging verifies its SHA-256 before bundling it. The MCP package
test installs outside the checkout, verifies both manifests, runs the tool/protocol
suite and typechecks consumer examples without private-registry credentials.

Pin the resulting immutable private MCP release archive and receipt in each
consumer's vendor directory before adoption. Consumer CI then needs no new
cross-repository secret. Keep actual MCP release source/hash receipts outside the
reviewed commit. Read [the module guide](../packages/mcp/README.md) for the API,
protocol matrix, SDK license and remaining installed-client/physical acceptance.

## Agent lifecycle contract checks

Hub #2 adds `packages/lifecycle-contracts`, a private versioned lifecycle schema
and TypeScript/Python consumers. Use Node 24 and Python 3.12 or 3.14, run `npm ci`
and install `requirements-contracts.txt` in an isolated Python environment.
Run `npm run build`, `npm run typecheck`, `npm run test:lifecycle`,
`npm run test:lifecycle:python` and `npm run test:lifecycle:package`, in addition
to all existing workflow, controller-contract and MCP checks. The combined
contracts/state jobs run lifecycle checks on Ubuntu with both Python versions.
Tests use synthetic metadata only.
`npm run package:lifecycle` builds the private archive with a file-hash manifest;
record its source revision and archive hash externally after reviewed delivery.
No command installs hooks, launches a client or contacts a device.

## Early performance measurement tooling

`npm run test:performance` uses Python 3.12 or 3.14 to check measurement
statistics, pinned source verification, isolated legacy admission and bounded
worker failure handling. The combined contracts/state jobs run this command
on Ubuntu with both Python versions. The tests use synthetic state and do not
establish installed-client, full hook,
helper-route or physical performance. See [the early measurement procedure](performance-baseline.md)
for actual profile commands and pending budget gates.

## Linux hook performance qualification

Run `npm run test:performance:linux` on Linux with system Python 3.12 or 3.14
under `/usr` and the packaged `bwrap` executable available. These thirteen focused
checks execute the pinned real hook in disposable PID/network/mount namespaces,
verify provenance and failure retention, and test detached-child cleanup. They
perform no timing benchmark or device operations. CI runs them once in the
Ubuntu workflow job; the other four Ubuntu jobs remain required.
Hosted setup refreshes the package index before installing Ubuntu's `bubblewrap`
and `apparmor-profiles` packages,
then loads `/usr/share/apparmor/extra-profiles/bwrap-userns-restrict` and checks
namespace startup before running the tests. It does not disable
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

## Tidbyt controller checks

The runner tests in the same `test:tidbyt` suite cover authenticated loopback
feed reads, wrong-owner and malformed responses, body/time bounds, private
configuration, local process exclusion, crash release and shutdown. They use
a real in-memory shared owner with fake cloud transport and run in the existing
Tidbyt CI jobs. No installed service or physical device participates.

Hub #16 adds the `controllers/tidbyt` workspace package, an in-process Tidbyt cloud
controller. Use Node 24 and Python 3.12 or 3.14. Run `npm run build`,
`npm run typecheck` and `npm run test:tidbyt`. After installing
`requirements-contracts.txt`, which pins Pillow, run `npm run test:tidbyt:python`.
Keep running the shared controller-contract and workflow checks alongside them.
The combined contracts/state CI jobs run `npm run test:tidbyt:built` and
`npm run test:tidbyt:python` on both Python versions.

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
check before removal and backoff after repeated failures. Every receipt and snapshot is checked with the controller v1 `validate()`. The
Python check decodes the committed golden images with Pillow, independently of
the encoder. No check reads credentials or contacts the Tidbyt cloud or a
device. Visible results need the separately authorized installation in #21.

## Agent state core checks

Hub #3 adds the embeddable `packages/agent-state` owner and source provider emitters.
Use Node 24 and Python 3.12 or 3.14. Run `npm run build`, `npm run typecheck`,
`npm run test:agent-state`, `npm run test:agent-state:python` and
`npm run test:agent-state:package`, alongside all existing shared checks.
CI runs the core, Python fixtures and external package consumers in the combined
Ubuntu contracts/state jobs with Python 3.12 and 3.14. Tests use fake providers,
exclusive test stores, disposable state and loopback transports. They do not
install hooks, launch clients or operate devices. `:built` commands require a
fresh build in the same job. Host storage conformance, installed qualification
and integrated performance remain separately evidenced downstream gates.

## Standalone hub checks

Hub #5 targets Node 24 on Linux in WSL. Run `npm ci`, `npm run build`,
`npm run typecheck`, `npm run test:hub` and `npm run test:hub:package` from the worktree root, alongside
the shared controller/lifecycle/state/MCP and workflow suites. The combined
Ubuntu contracts/state CI jobs run `npm run test:hub:built` and `npm run test:hub:package:built` after their fresh
build. Tests use disposable private Linux state, synthetic credentials and
fake loopback controllers. They do not start installed services or operate
devices. The source includes supervised child release, fenced import, route readiness,
interrupted coordinator recovery and rollback tests. Full integrated performance
qualification remains #30; source checks do not install or activate personal hooks.

For owning-service acceptance, prepare the immutable revisions in
`apps/hub/fixtures/pixoo-source.json` and `nanoleaf-source.json` in disposable
checkouts. Build Pixoo with its Node 24 `npm ci` and `npm run build`.
Run from this hub worktree after building:

```bash
node scripts/check-hub-pixoo.mjs /absolute/prepared/pixoo
node scripts/check-hub-nanoleaf.mjs /absolute/prepared/nanoleaf
```

Both helpers verify pinned source hashes and use temporary simulator/test state.
Pixoo exercises native settings plus its actual producer, selected-source facade,
browser label/acknowledgment routes and renderer through cutover and fresh-store
rollback. Nanoleaf exercises the real HTTP settings service with a disposable
worker fixture. Native tokens never enter the printed receipt. These local
cross-repository checks complement CI's pinned fixtures and isolated package tests;
CI does not fetch another private repository with broader credentials.

## Dashboard checks

Hub #6 uses Node 24 and React/TypeScript. Run `npm ci`, `npm run build`,
`npm run build:dashboard`, `npm run typecheck:dashboard`, `npm run test:dashboard`
and `npm run test:dashboard:browser`. Browser checks use Playwright Chromium,
synthetic state and fake controllers. The dashboard CI job runs these checks;
shared hub, contract/state, MCP and workflow jobs remain required. No check
installs a personal service, opens live state or contacts hardware.

Hub #179 extends `npm run test:hub`, `npm run test:dashboard:browser` and
`npm run test:hub:package` with disposable owner-launch and browser-session
checks. Cover single-use and expired codes, rejected cross-origin exchanges,
read/control alias bounds without ingest/admin/MCP access, disconnect, reload
and inspection without device writes. The existing Dashboard CI job and shared
Hub/package jobs run these checks on Node 24. They do not use the installed Hub.

Hub #151 extends the matrix with general-control scenarios: one guarded command
per control in Media, Monitor gating with the explicit Media switch and a pending
mode, concurrent edits with typed conflicts and locked uncertain actions, and
read-only or undeclared capabilities with named reasons. The hub dashboard test
checks that general commands are schema-validated and scoped before any
controller request. The fake Pixoo declares the capabilities of Pixoo `main`
`c81bc31`, with controller v1 modes unsupported; the dashboard README records
the mapping. Human UI approval of the candidate is recorded in its PR.

Hub #153 adds Nanoleaf scenarios to the same matrix: power and brightness in
Work with the override hint, Work gating with the explicit Free switch through
the controller v1 mode command, one guarded scene command with a preserved
selection and focus across reconnect, keyboard focus kept through the Free
switch, a scene activation and a locked draft form, and a controller-side scene
rejection, revision conflict and uncertain result with no retry. The fake Nanoleaf declares
the capabilities of Nanoleaf `main` `8062849` and rejects a scene outside Free
with `unsupported-capability` before any write; the hub route test checks that
scene commands are schema-validated before forwarding. Client unit tests cover
the scene availability order, name-or-ID labelling from the integration snapshot
and the Work/Quiet/pending/unknown gating. Human UI approval of the candidate is
recorded in its PR.
## Shared monitoring setup checks

Hub #8 adds local setup operations to the hub package. `npm run test:setup`
builds and runs isolated configuration, credential and hook tests; CI runs
`npm run test:setup:built` after its fresh build. The hub package check also
executes these tests in the offline installed archive. Use Node 24 on Linux/WSL.
Temporary synthetic settings and fake transports never qualify personal hooks.

For the optional cross-repository source check, build the exact Pixoo archive
revision in `apps/hub/fixtures/pixoo-source.json`, extract the Nanoleaf revision
in `apps/hub/fixtures/nanoleaf-shared-source.json`, then run:

```bash
node scripts/check-hub-shared-consumers.mjs /absolute/pixoo-source /absolute/nanoleaf-source
```

The command verifies pinned source hashes and uses disposable state plus a
suppressed physical worker launch. It covers setup/revocation, two consumer
projections, fenced handoff, legacy selection and latest-state rollback.
It also runs ordinary unordered start/stop/next-start hooks, rejects late retired
activity and exercises Nanoleaf's actual manual acknowledgment without clearing
Pixoo's notice. The actual Pixoo pager and Nanoleaf stored projection receive
the same selected activity while retaining their independent presentation rules.
The existing `check-hub-pixoo.mjs` additionally verifies labels/notices,
acknowledgment and renderer continuity. These require separately available
source archives; neither is a personal installation or a physical check.

For Hub #137, `test:agent-state:built` includes current-status policy, retirement
eviction, old-export recovery, freshness/restart and TypeScript/Python snapshot
compatibility. The original ordinary-provider regression failed before the fix.
`test:setup:built` runs the packaged Desktop hook against the real host and reopens
the same synthetic store. `test:hub:package:built` repeats that check after an
offline archive installation. Existing CI runs these suites on Python 3.12 and
3.14. Run the pinned consumer check above locally as well. Publish new state
2.0.0 and Hub 0.2.0 archives with hashes and the merged source revision; preserve
previous release bytes. Package version changes do not change snapshot/storage 1.0.

## Standalone hub MCP checks

`npm run test:hub:mcp` builds and exercises the optional host MCP route with disposable storage, synthetic credentials and fake loopback controllers. CI runs `test:hub:mcp:built` after its build/type checks; the broader hub and installed archive tests also include these scenarios. Retain all shared MCP, contract and workflow checks. No test starts an installed agent or contacts a physical device.

## Bounded cross-device compatibility

Hub #9 adds verification tooling for the standalone Linux/WSL setup. Build this
Hub worktree with Node 24 using `npm ci` and `npm run build`. Prepare Pixoo at
`apps/hub/fixtures/pixoo-source.json` and Nanoleaf at
`apps/hub/fixtures/compatibility-nanoleaf-source.json` in disposable source
archives. Build Pixoo with Node 24 `npm ci` and `npm run build`; use system
Python 3.12 or 3.14 for Nanoleaf and installed Playwright Chromium for the browser.
Run from the Hub worktree:

```bash
node scripts/check-hub-compatibility.mjs /absolute/pixoo-source /absolute/nanoleaf-source /tmp/new-compatibility-report.json
```

The report path must be new. The runner records preflight failures, verifies the listed owning-source hashes,
and rebuilds Hub/Pixoo before importing their build output. It
starts disposable local services with fake physical boundaries, and drives the
real dashboard and MCP. It tests shared lifecycle semantics, labels, monitor
acknowledgment, native settings/modes, duplicate/late events, one disconnected
consumer and host restart. The JSON report records tested revisions, scenarios,
failures and cleanup. Retain failed reports; do not overwrite them on reruns.

This local cross-repository check needs explicit prepared private sources; ordinary
CI retains its existing component, contract, browser and package tests without
adding private repository credentials. Run `npm run typecheck`,
`npm run test:hub:built`, `npm run test:dashboard`, `npm run test:dashboard:browser`,
`npm run check:workflow` and `npm run test:workflow` alongside the source check.
The Hub command includes `tests/compatibility_process.test.mjs`, so both required
contracts/state CI jobs check forced process cleanup and failed preflight reports
without private source access.
No product code or contract changes are intended. The #30 performance report is
a separate required completion input. Source compatibility does not install
hooks, start an actual agent client or establish visible-device behavior.

## Everyday standalone qualification

Hub #30 adds `npm run test:performance:standalone` for report completeness,
negative acceptance and PID/network/mount confinement, including timeout and
detached-child cleanup. Use Node 24 and system Python 3.12/3.14 with bubblewrap.
The existing Ubuntu workflow job runs these checks after its namespace preflight.
They do not benchmark timing or fetch private consumer repositories. Run the
shared build/type, contract/lifecycle/state, MCP, hub, dashboard and workflow
checks alongside them; the actual specification inventory also includes
`standalone-monitor-qualification` once synchronized.

The separately authorized local command is `npm run qualify:standalone --` with
the arguments in [the qualification runbook](performance-standalone.md). It
prepares pinned consumer sources, then measures only inside a disposable isolated
Linux namespace. Setup/build time is excluded from runtime timings. No installed
hook, agent client, physical device or live state is used. The report retains
failures and is not a substitute for installed or physical acceptance.
