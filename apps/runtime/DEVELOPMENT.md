# Development and verification

Run commands from the repository root with Node 24 and the dependencies in
[development setup](../../docs/development.md). This file owns the component-specific checks;
[SDLC](../../docs/sdlc.md) owns delivery policy and required evidence.

## Runtime checks

Shared device control (#2193) uses the existing runtime, SDK and Companions CI
discovery. After the root build, run `npm run test:runtime:built`,
`npm run test:sdk:built` and `npm run test:companions:built`. The gateway tests
exercise the authenticated MCP tools and the Companions tests use a scripted
provider with disposable device records. The named-device regression compares
status and scene requests through the Anthropic and OpenAI adapters. Runtime MCP
coverage exercises the equivalent Nanoleaf name. Run the shared type, lint, workflow,
event and MCP package checks. Installed client and device checks belong to #2184.

Presence Pro uses `npm run test:presence-pro:built` and
`node --test apps/runtime/dist/tests/presence-pro.test.js` after the root build.
The latter is a disposable authenticated state/SDK/history exercise. Existing
`test:runtime:built` discovery and aggregation run both in CI. Container profile
admission remains covered by `node --test deploy/container/tests/entrypoint.test.mjs`.
See the [module guide](../../modules/presence-pro/README.md) for the stock report
and real loopback Native API checks. No household target is used by these tests.

For local Codex title lookup, after `npm run build` run
`node --test apps/runtime/tests/mac-codex-hook.test.mjs` and the built runtime
`hook` and `remote-hooks` suites. The wrapper tests cover explicitly selected
titles and renames, unavailable titles, supplied-field exclusion and the
unversioned activity-only path using a synthetic Codex home and loopback receiver.
The Container and operator checks CI job already runs this wrapper suite.
Installed producer/receipt selection and the physical Tronbyt rows require
separate readback; passing source tests changes neither.

For retired standby options and settings history modes, use the focused
refusal cases in `deploy/container/tests/entrypoint.test.mjs`,
`scripts/tests/bunny.test.mjs` and `apps/runtime/tests/runtime-ownership.test.ts`.
The entrypoint and operator fixtures verify refusal before state creation
or Docker start. See [operator verification](../../docs/operator-verification.md).

For ordinary history and old-store compatibility, run the built
`history-fact-log`, `history-spans`, `history-open`, `history-alarm`
and `inbox-gateway` suites after the root build. They exercise existing
history filters, old row retention and per-origin sequencing using
synthetic stores and controlled clocks.

### Codex read-receipt checks

After `npm run build`, run
`node --test apps/runtime/dist/tests/codex-receipt-*.test.js apps/runtime/dist/tests/codex-read-*.test.js apps/runtime/dist/tests/read-receipts.test.js apps/runtime/dist/tests/read-helper.test.js`.
The focused suites cover source qualification, native request/response correlation,
compatible version changes, oversized-frame recovery with fresh evidence, refusal of incompatible evidence,
byte forwarding, SDK freshness, target binding and the core transaction. The Mac
launcher test uses synthetic app bundles and runs only on macOS; run it on the host
as well as the Linux receipt suites. It launches no installed application. Existing
`test:runtime:built` and the Runtime unit tests CI job discover these tests automatically.
Use the owning Linux test environment for runtime storage/edge checks, as for the
existing receipt suites. Run shared build/type/lint, event/SDK, contract and workflow
checks before publication. Disposable native protocol checks and the actual
operator-run Desktop check qualify different boundaries; neither alone establishes
installed B.U.N.N.Y. read acceptance.

Automation definition state uses the existing Runtime unit tests and Shared
event contracts jobs. After the root build, run
`node --test apps/runtime/dist/tests/automation-state.test.js apps/runtime/dist/tests/automation-gateway.test.js apps/runtime/dist/tests/automation-routes.test.js apps/runtime/dist/tests/power-schedules.test.js`
and the shared event contract and bookkeeping checks. A manual clock and
synthetic SQLite fixture cover populated-store sync, committed edits and
removals, refused and ignored SQLite writes, registered-secret refusals and
late registration before deferred delivery,
request trace continuity and execution without definition history. Run
`node --test apps/runtime/dashboard/tests/timeline-automation.test.ts` to check that the
Automation filter includes the retained changes and removals. These checks
need no standalone runtime or device.

Automation device following (#1330) uses the existing runtime CI test discovery.
After the root build, run `node --test apps/runtime/dist/tests/automation-device-follow.test.js`
and the automation, power schedule and power limit suites. The disposable runtime
admits two device owners and a playback-only owner, checks independent initial
copies and live following without recurring refusals, and recovers a genuine
owner refusal with the existing bounded retry. It sends no device commands.
Keep installed Mac log observation separate from these synthetic checks.

Private Tailscale access (#1117) uses the existing runtime unit test discovery in CI.
After the root build, run `node --test apps/runtime/dist/tests/private-proxy.test.js apps/runtime/dist/tests/wifi-proxy.test.js`
and the existing gateway suite. These check origin/proxy proof, browser and machine
grants, session expiry, credential revocation and preserved local/Wi-Fi access.
Run the container entrypoint/operator checks for profile admission, plus the
owning build/type/lint, SDK, contracts and workflow checks. Real Caddy forwarding,
disposable browser acceptance and installed iPhone/PC/Mac checks remain distinct.
Run `BUNNY_TEST_ENTRY=private BUNNY_TEST_CADDY=/path/to/verified/caddy node apps/runtime/dashboard/tests/wifi.browser.ts`
for the real private forwarder, synthetic TLS termination, owner password,
scoped machine refusal and mobile-width reconnect/logout journey.
Chromium answers the initial password challenge once; another challenge fails the
journey so automatic test credentials cannot hide a browser sign-in loop.
The test overrides only private loopback ports, uses synthetic data and qualifies
neither Tailscale enrollment nor actual phone/system certificate trust.

Private room models use the existing runtime/core and dashboard test discovery.
After the root build, run `node --test apps/runtime/dist/tests/room-models.test.js`
and `node --test apps/runtime/dashboard/tests/room-bindings.test.ts`, then
`node apps/runtime/dashboard/tests/room-models.browser.ts`. The browser journey
runs in the runtime-selected App verification CI job and the local dashboard
browser suite. It uses synthetic private geometry, real authenticated content
reads, current room assignments and simulated light queues; it checks selection,
reported power, unbound fixtures and reload without replay.
Reader tests cover unsafe permissions, links, malformed buffers, limits and
cancellation. The negative control is the same authenticated read against a
core without room content (404), and the initial browser journey without its
model entry point. None contacts a household device or qualifies iPhone behavior.
Use a private `TMPDIR` outside any checkout when the system temporary directory
contains a `.git` entry; never remove another task's entry to make tests pass.

Weekly routines (#1297, generalizing the #483 power window) use the existing
runtime/core and dashboard test discovery. After the root build, run
`node --test apps/runtime/dist/tests/power-schedules.test.js apps/runtime/dist/tests/automation*.test.js apps/runtime/dist/tests/upgrade-source.test.js`.
The fake clock covers disabled creation, action order and fresh identities, a
refused action that does not stop the next, the mode precondition and its
pass-through, a pending mode change, a Nanoleaf scene in Free, expired actions,
the `busy` guard and Run now outcomes, independent targets, obsolete callbacks
during reads, configuration/owner drift, duplicates, late callbacks, restart
without catch-up, the one forward migration of `power-window/1.0` rows (one
transaction, names read back as display text) and storage refusal before or
after dispatch with per-action diagnostics. The preview (#1586) is checked
guard by guard against the reason the run then logs for the same records, with
no send, log row or claim after it, and `busy` while an occurrence is in flight;
`automation-gateway.test.ts` covers its read-scope route, refusals and reply.
A generic synthetic
owner exercises actual SDK sync and tracked guarded commands. The upgrade
inventory test includes the routine/store inputs; restart tests establish
persistence, not compatibility between historical releases.
The `weekly-routines` catalog scenario exercises authenticated management,
read-only refusal and future-only restart; `routine-actions` runs one routine
with a Pixoo playlist start and a LIFX color, previews it in Work (the start
blocked for the mode, the color would send, nothing admitted or logged), then on Run now in Work and in
Free, then once at its minute, in memory and in disposable runtime runs. Run
both and `automation-lines-moment` after changes to this shared path. The
in-memory catalog runs on Linux, in a disposable Linux container or
[natively on macOS](#native-runs-on-macos). The Automation browser journey covers independent
devices, invalid drafts, Run now, Preview, passive reconnect, lost mutation replies
and read-only controls.
These checks contact no household device and qualify no installed routine or maximum-on limit.

Home-Wi-Fi admission (#1111) uses the existing runtime unit test discovery in CI.
After the root build, run `node --test apps/runtime/dist/tests/wifi-proxy.test.js`
for configured proxy admission, browser sessions, refused origins and preserved
local clients. Run the existing gateway suite alongside it for expiry, streaming,
grants and diagnostic checks. The setup recipe's Caddy check and phone-width
browser journey establish forwarding and UI behavior separately from actual
installed iPhone acceptance; no physical device command is required by these tests.


ONN dedicated qualification is dormant under #1464. Shared upgrade inventory/admission/preflight/source checks remain active to preserve retained state. Run `node --test tests/onn_hibernation.test.mjs` for runtime/frontend registration absence and the ordinary runtime upgrade and core privacy tests for retained compatibility. The ONN module guide retains historical qualification instructions.

Roborock configured-owner qualification also runs
`node --test apps/runtime/dist/tests/roborock-upgrade-profile.test.js apps/runtime/dist/tests/roborock-upgrade-qualification.test.js apps/runtime/dist/tests/upgrade-inputs.test.js apps/runtime/dist/tests/upgrade-admission.test.js apps/runtime/dist/tests/upgrade-preflight.test.js`
after the root build. Existing `test:runtime:built` discovery runs these in the
Runtime unit tests CI job. The metadata tests require the private primary archive and preserve complete
fixed optional-owner coverage. Preflight and post-start tests require coverage,
delivered artifact reader entries and ordinary configured healthy state.
Four synthetic processes use production RoborockStore and SDK Outbox to preserve
candidate originals/versions, samples/gaps, room mappings, private identity,
unverified map bytes/provenance and pending state envelopes. Recovery reads latest
candidate data before genuine unchanged-envelope republish; the older-baseline
negative control fails. All processes use the same built implementation, so this
proves persistence only. Exact artifact compatibility, installed admission,
account/session setup, page/MCP clients and real-run/map acceptance stay separate
under [UPGRADE.md](UPGRADE.md) and the selected issue.

Current-runtime upgrade inventory and receipt checks (#1037) are in
`apps/runtime/tests/runtime-upgrade-check.test.ts`. After the root build, run
`node --test apps/runtime/dist/tests/runtime-upgrade-check.test.js`; existing
`test:runtime:built` discovery also runs them in the Runtime unit tests CI job. They use
small private disposable directories, never installed state or service control.
They compare supplied release manifest/inventory/archive hashes and establish
receipt validation, private atomic persistence and readback. A disposable child
refuses only the receipt directory synchronization through a test preload; the
real CLI must refuse an identical retry until synchronization works, emit a
schema-valid private failure receipt and preserve its visible bytes. Resolution
fixtures also exercise the real CLI under an inherited installation
lock: ordinary replacement refuses, explicit inspected resolution retains the
original bytes, and missing locks, changed evidence, changed approval and
conflicting retained copies refuse. These synthetic evidence files establish
binding and persistence behavior, not installed inspection or coordinator
acceptance. Supplied hashes do not establish trusted merged source or safe archive extraction;
upgrade/recovery, running identity and installed acceptance require their own
procedure evidence.

`node --test apps/runtime/dist/tests/upgrade-admission.test.js` checks the
read-only binding of a coordinator's reviewed qualification decision to exact
private evidence and independently supplied identities. It covers complete
coverage, changed evidence, missing owners, duplicate phases, identity drift,
unknown fields and linked evidence. Existing runtime CI test discovery includes
it. These fixtures establish binding and refusal behavior; the production
preflight, independent acceptance and installed upgrade remain separate gates.

`node --test apps/runtime/dist/tests/upgrade-owner.test.js` checks fixed-service
process observation through an internal reader seam: PID/start identity,
runtime arguments, restart/PID reuse, another user, incomplete observations and
safe refusal diagnostics. Existing runtime CI discovers it. The fixture does
not read the installed service or prove release closure, listener ownership,
build/health identity or upgrade eligibility.

Baseline closure checks also retain nested declared workspace payloads, including
the current `modules/roborock/transport` layout. Changing its compiled dependency
bytes refuses; it is included even when no runtime module imports it. This does
not establish storage compatibility or configured-device acceptance.

The preflight suite also checks the post-start observation composition: a new
process, selected release, unchanged approved inputs and repeated authenticated
build/health reads. Wrong build, unhealthy state, token drift, changed arguments,
changed selection and missing locks refuse. The paths suite uses disposable
files to check the target anchor and exact first-adoption override. These checks
use internal reader fixtures and no installed service. The manual `verify-running`
block applies the plan's finite attempt and process timeout bounds; actual
startup, recovery and failure-to-receipt evidence remain separate requirements.

`node --test apps/runtime/dist/tests/upgrade-lock.test.js` checks inherited FD9
against the named private operation lock. It covers missing/wrong descriptors,
permissions, replaced paths, links and a same-shell `flock` fixture whose
competing operation exits 75. It runs the read-only helper in child processes,
not an installed upgrade. Existing runtime CI discovers it.

`node --test apps/runtime/dist/tests/upgrade-inputs.test.js` checks private
configuration and retained-owner classification using file metadata, including
the core's separate lease file. Live databases are not opened. Unknown owners,
unsafe entries and permissions refuse. Receipt fixtures exercise the shared
validator, installation/filename binding and refusal of valid in-progress,
interrupted, failed-recovery and finalization-failure receipts. This read-only
inspection has a 4,096-file receipt bound and never clears unresolved evidence.
Existing runtime CI discovers it; stopped-writer backup, complete recovery
coverage and final preflight remain separate.

BB-8 is hibernated. Its module/helper, browser, package, scenario and shared
BB-8 upgrade behavior tests are inactive. Dedicated sources are retained with a
`.hibernated` suffix. Shared upgrade suites keep other owner cases and generic
retained-format metadata; production readers and admission refusals are unchanged.
See [development](../../docs/development.md#bb-8-hibernation) before any resumption.

`node --test apps/runtime/dist/tests/upgrade-listener.test.js` binds the selected
loopback TCP listener to the already observed runtime PID's socket descriptors.
Fixtures cover another process or user, wildcard and duplicate listeners,
replacement during inspection, malformed or oversized observations and invalid
inputs. The reader neither discovers processes nor sends HTTP requests. Existing
runtime CI discovers these tests; authenticated build/health reads and release
closure remain separate checks.

`node --test apps/runtime/dist/tests/upgrade-http.test.js` checks the fixed
loopback build and health reads. It binds the bearer to the current read grant,
rejects private-input and owner/listener drift, verifies the expected clean
build, validates health and excludes secret values, reason details and volatile
counters from its result. A disposable loopback server checks the production
GET reader's authentication, redirect refusal and response-size bound. Calls
have a three-second deadline and 256 KiB response limit. Existing runtime CI
discovers these tests. Observing valid degraded health does not accept an
exception or establish upgrade eligibility.

`node --test apps/runtime/dist/tests/upgrade-paths.test.js` checks first adoption
and the required operational frame: exact backup and adoption paths, bounded
stop/post-start limits, pinned private startup-effects and restoration evidence,
and the derived adoption-draft bytes. Changed evidence or occupied destinations
refuse; preparing the exact planned draft does not invalidate the locked plan.
These tests use disposable files and do not accept startup effects or installed
execution. The composed preflight suite also checks operational-evidence drift.
The paths test accepts an explicitly selected 180-second observation attempt and
rejects longer, non-finite, undersized or unsafe integer limits. The stop bound
remains sixty seconds. This parser check does not establish actual installed
verification time; size that bound using the owning procedure before effects.

The suite also checks adoption from the retained direct tree and routine
upgrades through the previous-release
anchor. Foreign or dangling anchors, overlapping mutable paths, wrong release
placement, linked inputs, public operation directories and unexpected entries
refuse without filesystem changes. The request has no observation or acceptance
flags. Existing runtime CI discovers these tests. Accepted baseline closure, hook
protection and the complete preflight remain separate requirements.

`node --test apps/runtime/dist/tests/upgrade-source.test.js` checks release-derived
production input inventories. Resealed artifacts with changed producers,
controllers, outboxes, lockfiles or registry generators refuse when their pinned
inventories are stale. Correct independent release inventories can be bound,
but changed inputs remain explicitly unqualified until coordinator admission
accepts the exact inventory set and complete production recovery evidence.
Missing required anchors and executable-looking build identities also refuse.
Build identity is parsed as data. Explicit operator-only helper exclusions do
not establish that the runtime entry graph excludes those helpers; independent review must verify
that boundary. These synthetic checks do not qualify installed compatibility.

`node --test apps/runtime/dist/tests/upgrade-baseline.test.js` checks actual-byte
comparison against the verified previous release and a privately pinned closure.
The inventory derives production inputs, built files, dependencies and linked
workspace payloads from that release. Fixtures cover changed or missing bytes,
extra dependencies, workspace-local dependency shadows, escaped links, changed
Node or unit files, and drift during inspection. Manifest link resolution also
covers a `.bin` link through a workspace link. Hard-linked files require every
alias to be present in the verified inventory; an external or newly added alias
refuses. Node and unit pins still require single-link files. Directory membership checks are
bounded and do not recursively follow filesystem links. Existing runtime CI
discovers these tests. A matching observation is point-in-time evidence; it does
not accept coordinator admission, startup provenance or upgrade eligibility.

`node --test apps/runtime/dist/tests/upgrade-hooks.test.js` checks the qualified
hook list in the privately pinned baseline closure. It preserves directory and
file links, exact invocation paths and script bytes. Changed links, unsafe files,
duplicate or missing declarations, overlap with installation storage, and drift
during the final read refuse. The checker reads scripts without executing them
and never rewrites a hook or client configuration. Existing runtime CI discovers
these tests. The coordinator's admission must establish list completeness;
fixtures do not establish the installed hook paths.

`node --test apps/runtime/dist/tests/upgrade-preflight.test.js` checks composition
through internal synthetic readers: the original process/listener, pinned source
and admission, baseline/hook/state/receipt continuity, private-input hashes,
authenticated build and health, and exact plan equality under the operation lock.
Changed evidence, unexpected health, a stopped watchdog, missing lock and an
altered plan refuse. The production export binds fixed installed readers; no
request field selects a reader. These fixtures test coordination, not installed
eligibility. The owning component tests above verify the individual readers.
Each composed case calls the preflight or running check in the test process;
the file's two CLI tests keep the real process boundary (#1081).

`node --test apps/runtime/dist/tests/upgrade-procedure.workflow.js` executes the
owning procedure's manual backup and release-selection commands on disposable
byte fixtures. It checks complete sidecar/original/reference retention, private
backup hashes and archive roundtrip, refused unsafe or reused destinations,
atomic anchor selection, and recovery/re-upgrade without replacing newer state.
Backup and stopped-writer checks use an ordinary Bash shell; the documented
blocks enforce their own failure handling.
It also generates a private adoption draft from a synthetic plan, preserves the
observed invocation, and refuses changed frames, reused drafts and systemd
substitution/quoting characters before creating a proposal. The exact adoption
block is also checked with a fake service command: a directory, copy, comparison,
synchronization, reload or start failure prevents later steps.
These Markdown-dependent checks run in the active Workflow job after its root
build, including Markdown-only revisions. They are excluded from the Checks
job’s runtime test glob.
The test does not stop a service, open an installed store or qualify database
reopening. Production-store recovery and established-installation acceptance
require their separate evidence.

The Automation browser journey uses the existing runtime harness with the real
Nanoleaf module over `SimulatedNanoleaf`. It checks explicit disabled creation,
enable/settings/edit/delete, passive drafts, one page-closed tracked moment,
named Free scene/brightness restoration and keyboard. Read-only UI uses an
intercepted authority response; the gateway suite separately checks real reader
refusal. The `automation-lines-moment` catalog scenario adds reader resync and
restart without replay over both existing transports. No physical proof is claimed.

Automation gateway checks (`apps/runtime/tests/automation-gateway.test.ts`) cover
read/control admission, the required write header, bounded bodies, credential
revocation during a pending write and safe error/trace records. The route helper
tests preserve the existing CRUD/settings shapes. Both are discovered by
`npm run test:runtime:built` after the normal build and by the Runtime unit tests CI
job; the Automation page's unit checks join `test:runtime-dashboard:built`.

`apps/runtime` is the current runtime and module host from
[ADR 0012](../../docs/decisions/0012-bunny-event-platform.md); its
[README](README.md) covers running it, health, state, failure
isolation and the event-loop lag check. It follows the
[strict profile](../../docs/development.md#strict-profile-for-new-code), tests included.

For the module frontend contract (Hub #932), the existing SDK manifest/kit
checks and runtime `gateway.test.ts` cover API 1.3 declarations, trusted asset
authentication and response policy, passive-page compatibility, read-only
command refusal and reads without device effects. After the root build, run
`node --test apps/runtime/dist/tests/gateway.test.js` for the gateway boundary.
The SDK suite in core CI and the Runtime unit tests CI job already discover these tests;
they do not replace the browser interaction or disposable Acceptance checks.
`frontend-build.test.ts` uses the production build plugin to bundle a synthetic
module's explicit browser entry and rejects one that imports its Node-side
implementation. Run it after the root build with
`node --test apps/runtime/dist/tests/frontend-build.test.js`; CI's runtime unit
test discovery includes it. It starts no listener and keeps temporary
workspaces under the checkout's ignored `.local/scratch/frontend-build/`.

Use Node 24 and run `npm run build`, `npm run typecheck`, `npm run lint:js` and
`npm run test:runtime` from the worktree root. `test:runtime` builds, then runs
`test:runtime:built`: the compiled tests in `apps/runtime/dist/tests/`. The
Runtime unit tests CI job runs `npm run test:runtime:built` after its fresh build. The tests use
in-test fixture modules, port 0 on loopback and private state directories under
the system temporary directory, which must be outside every Git checkout. Some
start the runtime in child processes, as the service manager would; one kills it
between the fixture lamp's commit and publish. The fixture lamp and chime run the
module test kit. Some start the runtime with `--edge` and `--simulate`: a remote
part with a run-generated credential reaches its gateway (#835), and
configurations without an edge section, and credentials files that are missing,
not private, malformed or that act as the core or a module, are refused. The
gateway tests cover each caller's grant, browser sign-in and its Origin checks,
credential reloads, MCP through `packages/mcp`, module pages and settings, the
route map against the old Hub's sources and the cutover's credential
conversion, and scan every record, answer, health document and span for the
synthetic token prefix `tok_SYNTHETIC835`. The
runtime's records must pass the diagnostic contract's validator (#903), and
`runtime.stopped` must count no lost record or span. The decision-record and tracing tests read the runtime's records and the
spans its host adapter hands a test sink (#949). The Pixoo library migration's
tool (#931) runs in process and as its entry point, against a synthetic library
it writes with the Pixoo module's code, starts the runtime in a child process to
show each one refusing the other's lease, and interrupts the entry point with
SIGINT and SIGTERM. Its full-disk test mounts small private tmpfs file systems
in a user and mount namespace (`unshare -rm`); a host that refuses one skips it
and says why. The Nanoleaf migration's tool
(#933) runs in process and as its entry point, against a synthetic bridge state
it writes with the Nanoleaf module's code, and starts the runtime in a child
process to show each one refusing the other's lease. Its full-disk test fills a
4 MiB tmpfs in a user and mount namespace (`unshare -rm`) at each stage of the
write, and skips with the reason where the host refuses that. The agent hook tests (#926) run `apps/runtime/bin/monitor-hook.mjs`
as child processes with synthetic 1.x producer files and synthetic Claude Code
payloads, against the runtime's gateway, a closed port and a listener that never
answers; they strip any `CLAUDE_CODE_*` variable and `CODEX_HOME` from the hook's
environment. The Codex Desktop tests
run the module's real reader process on a synthetic marker in a temporary Codex home, and make the marker a FIFO with `mkfifo` to stand in for a stalled mount.
No test reads a real client's hook settings or Codex files. They need no device
or network.
`node apps/runtime/scripts/measure-memory.mjs` measures the
zero-module memory for #123, and `measure-edge-memory.mjs` the edge under a
stalled reader; the README's Memory section says how.
`node apps/runtime/scripts/measure-commits.mjs` measures the SQLite commits,
blocked time and event-loop delay of the core's intake, a LIFX command and the
outbox (#972, #123); the README's Commits section says how.
`node apps/runtime/scripts/measure-hook.mjs` measures the agent hook from its
start to its exit against a disposable runtime's edge (#926); the README's
[Agent hooks](README.md#agent-hooks) section says how.

### Upgrade owner qualification

The existing runtime suite includes companion upgrade input/admission and
preflight/running-check regressions, plus
`companions-upgrade-qualification.test.ts`. Its four separate production-module
processes reopen private synthetic stores, preserve settings, admissions,
consumed origins, allowances, archived presentation and outcome identities, and
leave pending reactions empty. The candidate writes distinct records and a new outcome, and a negative control
rejects restoration of the older stopped baseline. Inventory regressions use the
production reader to reject missing configured state, including surviving sidecars.
These checks establish synthetic restart behavior; actual release compatibility and installation still need the owning UPGRADE
procedure and independent artifact evidence.

Run these with the normal build and `npm run test:runtime:built`; the Runtime
unit tests CI job includes them. A focused run can select the compiled
`upgrade-inputs`, `upgrade-admission`, `upgrade-preflight` and
`companions-upgrade-qualification` test files. Runtime-private state tests require
a private temporary directory outside Git and Windows mounts, as the production
state contract does. Other source scratch remains under the repository's
ignored `.local/`. Tests use only their own synthetic databases and fake SDK
inputs, and do not qualify installed health, native readers or physical devices.

### Wemo and maximum-on checks

Run `npm run test:wemo:built` after the root build. It covers identity-checked
loopback SOAP, bounded transport, independent queues, final-effect fences,
persistent holds, explicit read-only release, storage refusal, silent-device
startup/shutdown and SDK module conformance. `npm run test:wemo:browser` exercises
the real module/core/gateway/dashboard with synthetic plugs, including page-closed
enforcement, reload without replay and desktop/phone layout.

`power-limits*.test.ts` covers unknown starts, original run deadlines through
edits/restart, offline/held binding, durable attempt identity and authenticated
bounded routes. `wemo-upgrade-profile.test.ts` covers configured/retained owner
inventory and admission. `wemo-upgrade-qualification.test.ts` starts four separate
current-source processes on the latest synthetic stores and preserves the limit
attempt, Wemo hold, request fence and unacknowledged outcome. Phase labels do not
substitute historical release artifacts or establish installed compatibility.
The `wemo-power-limit` catalog scenario runs over both SDK transports and in
selected disposable verification. Use an outside-checkout private `TMPDIR`.
Actual installation still requires UPGRADE.md's release/latest-state/recovery
admission; none of these checks contact a household device.

### CLI refusal checks

After the root build, run `node --test apps/runtime/dist/tests/process.test.js`
on Linux or [natively on macOS](#native-runs-on-macos) for state-directory and configuration admission, service startup and
shutdown, and process diagnostics. Each independent refusal registers its own
test through the existing helper, retaining its 20-second deadline and child
cleanup. Valid private configuration startup has its own test. Adding another
input must not consume an earlier input's deadline. Diagnostic codes, fixed
messages, stacks, redaction and health assertions remain unchanged. Existing
runtime unit CI discovers these cases; no product or global timeout changes.

### Runtime test layers

Every runtime story is tested at four layers
([epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827)).
The core admission job and the Runtime unit tests and Runtime scenario tests jobs
run the first three, each after its own fresh build, for ready PRs whose
[affected checks](../../docs/development.md#affected-pr-checks) select the runtime.
Broad release qualification runs all four on pinned integrated source.
The App verification job judges the fourth layer's capture steps without a user
manager; focused presentation admission retains affected disposable acceptance.

| Layer | Command | What it runs |
| --- | --- | --- |
| Unit | Each package's own: `npm run test:sdk:built`, `npm run test:runtime:built`, `npm run test:nanoleaf:built`, `npm run test:pixoo:built`, `npm run test:playback:built`, `npm run test:lifx-module:built`, `npm run test:tidbyt-module:built`, `npm run test:codex-desktop:built` | The package's and its modules' own tests, moved tests included |
| Contract and conformance | `npm run test:events:built` | The profile 2.0 and core family fixtures. The SDK's transport conformance suite runs within `test:sdk:built`, and each module runs the module test kit within its own suite, as the fixture modules do in `test:runtime:built` |
| End-to-end | `npm run test:runtime:scenarios:built` | The runtime's scenario catalog in the in-memory harness, over both transports (tier 1) |
| Acceptance | `npm run -s verify:runtime -- <operation>`, with `npm run test:runtime:verify:built` in CI | The same catalog in disposable runs, for the Acceptance reviewer (tier 2) |

`npm run test:runtime:scenarios` builds, then runs
`test:runtime:scenarios:built`: the compiled tests in
`apps/runtime/dist/tests/scenarios/`. To run some scenarios only, name them
after a build, for example
`node --test --test-name-pattern=end-to-end apps/runtime/dist/tests/scenarios/*.test.js`.

The end-to-end diagnostic-record check registers one sequential case per
transport, each using the existing 20-second test bound for startup, scenario,
record inspection and cleanup together. Their declared test budgets
therefore total 40 seconds. Contract validation and the three required module
events stay unchanged; invalid appended records and removal of every matching
required event must still fail. After a root build, select these checks with
`node --test --test-name-pattern='every record the end-to-end scenario writes' apps/runtime/dist/tests/scenarios/runner.test.js`.
A controlled scheduling-delay example demonstrates the old combined-budget
assumption; it does not identify a historical hosted timeout's cause.

The end-to-end spans check also registers one sequential case per transport,
each under the existing 20-second bound for startup, journey, span collection,
assertions and owned cleanup. Their declared budgets total 40 seconds. Both
cases retain duration, parentage, publication-count, restart-link and ordering
assertions. Copies with a bad duration, an orphan parent or a wrong replay link
must fail the same assertion helper without running another journey. After the
root build, select them with
`node --test --test-name-pattern='spans have durations' apps/runtime/dist/tests/scenarios/runner.test.js`.
A finite scheduling-delay control demonstrates the old shared-budget failure;
the historical hosted transport, phase and cause remain unknown.

Each catalog scenario runs twice in the runtime's module host, on a manual
clock: once with its parts on the host's bus, and once through a `RemoteEdge`
on 127.0.0.1 with run-generated tokens. The harness never listens on an
installed service's port (8765, 8787, 8788, 8791 or 41231), keeps its state in
a private directory under the system temporary directory, which must be
outside every Git checkout, and checks every message against profile 2.0. It
needs no device. The [runtime README](README.md#scenario-catalog)
describes the catalog and how a story adds to it.

The fixed Hub mode checks (#924) use synthetic Nanoleaf/Pixoo participants.
After the root build, use Node 24 and an outside-checkout `TMPDIR`:

```bash
node --test --test-concurrency=1 apps/runtime/dist/tests/mode.test.js apps/runtime/dist/tests/mode-participants.test.js apps/runtime/dist/tests/mode-runtime.test.js
node --test --test-concurrency=1 --test-name-pattern='MCP lists|Hub mode HTTP|a core the configuration refuses' apps/runtime/dist/tests/gateway.test.js apps/runtime/dist/tests/config.test.js
node --test --test-concurrency=1 --test-name-pattern='hub-mode over' apps/runtime/dist/tests/scenarios/catalog.test.js
```

These checks cover the durable selection, independent device outcomes, failed
saves, duplicates, explicit reapply, authorization and restart without replay.
The existing runtime and catalog CI suites discover them. The inbox-dependent
Acceptance journey uses the real inbox in a disposable run.

### Native runs on macOS

The runtime unit suite, the scenario catalog and the runtime dashboard browser
journeys also run natively on macOS with Node 24, from the session's own worktree
after its own `npm run build` (Hub #1639). Off Linux the private-file reader checks
the path again after the open instead of reading `/proc/self/fd` (Hub #1355).

```bash
node scripts/native-test.mjs test:runtime:built
node scripts/native-test.mjs test:runtime:scenarios:built
node scripts/native-test.mjs test:runtime:scenarios:built --workers 1 -- --test-name-pattern=art-show
npm run test:runtime-dashboard:browser
```

A bare `node --test` starts one test worker per core less one, and Node refuses
`--test-concurrency` in `NODE_OPTIONS`. `scripts/native-test.mjs` takes a package
script that is one plain `node --test` command, adds `--test-concurrency` (2 unless
`--workers` names another number) and passes the options after `--` to
`node --test`. It sets `TMPDIR` to a new private directory under `/tmp`, by its
resolved path, and removes it afterwards: macOS reaches `/tmp` and its per-user
temporary directory through links, which the private-file checks refuse, and the
resolved per-user path is too long for the launcher's Unix socket. The browser
journeys already run one at a time. Hosted CI keeps calling the package scripts.
`node --test scripts/tests/native-test.test.mjs` checks the runner.

Each run uses its own worktree, build output, ports, synthetic credentials and
state, and never attaches to an installed runtime or its ports.

These runtime unit tests still need Linux and skip elsewhere with a printed reason:

| Test file | Linux need |
| --- | --- |
| `upgrade-lock.test.ts`, two cases of the documented lock block | util-linux `/usr/bin/flock` |
| `runtime-upgrade-check.test.ts`, the inspected receipt resolution | util-linux `/usr/bin/flock` |
| `full-disk.test.ts`, `nanoleaf-full-disk.test.ts`, `pixoo-migration.test.ts` (one case each) | `unshare` for a private tmpfs |
| `remote-hooks.test.ts`, the two stalled native DNS cases | an `LD_PRELOAD` resolver shim |
| `container-listener.test.ts` | the loopback address 127.0.0.2 |
| `codex-desktop-collector.test.ts`, the entry point against a real runtime | kept to Linux by choice, where CI runs it |

On Linux they run, except that the `unshare` cases also skip on a host that refuses
an unprivileged user namespace. The other `:built` unit suites, the old dashboard's
journeys and the Python-dependent tests have not been measured natively.

### Runtime verification runs

Hub #920 adds the runtime adapter for the
[app verification contract](../../docs/app-verification.md),
`npm run -s verify:runtime -- <operation>`. A run serves the runtime from the
checkout with `--simulate`, `--edge`, `--config` and `--environment test`,
either with the shipped module list or with the fixture modules, over simulated
devices, on loopback. The
[adapter README](verify/README.md) lists its run scenarios,
capture steps and boundary checks. After `npm run build`, with Node 24 from the
worktree root:

```bash
npm run -s verify:runtime -- help
npm run test:runtime:verify:built   # full suite, when the local scope below requires it
```

Choose local verification by the behavior changed, including its direct
consumers, rather than by file paths (owner decision, 2026-10-08):

- For device Conversation, exercise `assistant-lifx`, `assistant-wemo`, `assistant-device-catalog`, `assistant-light-show` and `art-show` in the catalog. Run
  `node apps/runtime/dashboard/tests/lifx-conversation.browser.ts` and
  `node apps/runtime/dashboard/tests/show-conversation.browser.ts` after the build. Run the companions suite, the assistant dispatch tests, and
  `test:events:built` for the additive assistant-dispatch contract.
- For a feature, fixture or catalog change, run focused tests for the changed
  behavior and its direct consumers, then exercise the affected catalog
  scenario or scenarios in a disposable run. Reuse those scenarios for the
  independent Acceptance review where it applies. Editing runtime source or a
  scenario file alone does not require the full local verification suite.
- Run `test:runtime:verify:built` locally when the change alters shared
  supervisor, isolation, lifecycle or run-adapter behavior across scenarios.
  This includes shared boundary guards and build-freshness checks. Its runs
  retain their own synthetic state and exact cleanup ownership.
- Documentation-only changes need no product run. Keep the applicable workflow
  and specification checks.

Build once from the candidate before its local `:built` checks and disposable
runs. Record the candidate revision, selected tests and scenarios, why they
cover the affected behavior, their results and any skips or evidence limits.
Required checks must pass. The [Acceptance review policy](../../docs/sdlc.md#acceptance-review)
still requires an independent reviewer. Independent tasks may run simulated
runtimes concurrently, each from its own worktree and build outputs, with
separate ports, credentials and state. The launchers set no run-count limit;
on the Mac, test jobs follow [Test work on the Mac](../../docs/development.md#test-work-on-the-mac).
All runs keep the existing leases, synthetic data, simulated devices and an
outside-checkout `TMPDIR`; they grant no installed-system or physical-device
authority. Reset and stop only owned runs.

The two Runtime verification CI jobs together run the full `test:runtime:verify:built` suite,
split as in [Checks](verify/README.md#checks), on each pinned release qualification and
conservative PR selection. Focused presentation admission can omit both broad jobs while retaining affected disposable
acceptance. Focused local verification does not waive an applicable failed or
missing CI job, contract check, browser check or independent review.

`test:runtime:verify:built` starts runs without a user manager and judges every
capture step through `runCaptureStep`: one per catalog scenario, so the same
scenarios pass in the in-memory harness and in a run. It also starts each
boundary negative control and shows its check fails, shows the network guard
refuses `net`, `http`, `https`, `fetch` and `dgram` in a worker thread and a
child Node process too, and checks that `build-current` watches every source
the run loads. Nested module workspaces declared in the root package file are
also watched and included in the served candidate, with their declared built
import entries checked as outputs. They do not register as device modules.
It also judges the follow query of Hub #950, which reads one request's or trace's journal
records and spans in a run (see [Follow one request](verify/README.md#follow-one-request)),
and the runtime tests (`test:runtime:built`) cover the bounded, private span file that the
run's runtime writes. It starts the `nanoleaf-migrated` run (#933), whose seed migrates a synthetic Nanoleaf bridge
state into the run, and reads the migrated preferences through the run's gateway. It also checks that `start` and
`doctor` judge the runtime's own health as the in-memory harness does, and that the harness's refusals come from the
registry (#954). The host route takes the runtime as `--app runtime`. Its lifecycle tests drive
real transient units and skip with a printed reason without a user manager; the
App verification CI job runs the rest. It needs Playwright Chromium and an
outside-checkout `TMPDIR`, as the app verification tests do.


## Runtime dashboard checks

Art-derived decoration (#683) uses `npm run test:art-theme:browser` after
`npm run build`. App verification runs it in the runtime group, and the full
local browser suite includes it. Synthetic contrasting artworks drive the
real presentation context. Check light/dark at 1440, 390 and 320px, fixed
semantic colors, readable text/focus, unchanged control bounds, explicit
follow/lock/default persistence and storage failures. Delayed or invalid
artwork and malformed saved palette/texture data must keep a valid theme.
Theme application and controls must produce zero provider calls, device
commands and layout saves. Keep screenshots and recordings private.
The registered `art-theme` scenario runs through both runtime transports. Its
`scenario-art-theme` disposable capture demonstrates contrasting saved art and
the real lock/default/follow controls with labelled pointer actions.

Adaptive art and Gallery (#682) use `npm run test:art:browser` after
`npm run build`. App verification runs this focused journey in its runtime group;
the full local browser suite includes it. It uses the real authenticated core/art
owners with synthetic providers and an outside-checkout private `TMPDIR`.
The journey checks the hero's Pin or Unpin, Dismiss and Restore art chips (#1930)
saved per arrangement with independent desktop/phone layouts and restart, card
geometry and focus kept when art arrives, the forecast chip in the hero bound to
the drawn backdrop and cleared when the art is dismissed and at expiry, the backdrop following the selection
with no Art card on Home; rich rendition decode, stale/unavailable
content and late-load cancellation; and request/favorite/feedback/variation with
truthful allowance and job outcomes. Layout-only operations and gallery reads
must send no device command or provider request. Check 1440, 390 and 320px in
light/dark appearance. `DASHBOARD_RECEIPTS` keeps
synthetic screenshots private. Run the full browser suite below for dashboard
changes. Disposable acceptance uses the same synthetic art owner with the actual
Gallery controls; this establishes no installed or physical result.

Qualified read receipts (#1354) use
`node apps/runtime/dashboard/tests/read-receipts.browser.ts` after the root
build. The real helper and authenticated owner publish read provenance in the session/3.0 record to the
dashboard; the journey checks unread before a click, read after confirmation,
read after reload, and unread for a later turn, with no page command. Hosted
smoke includes this disposable journey. It uses synthetic metadata and no
installed client or device.

Home picker search and visual identifiers (#1316) extend the existing
`node apps/runtime/dashboard/tests/home-layout.browser.ts` journey, included
in hosted smoke and the full local browser suite. After the root build it checks
combined name/category filtering, empty/reset, keyboard focus, neutral inline
identifiers, draft-only add/show and the existing save, conflict and attention
guards. It checks light/dark desktop and 320/390px layout. Use an outside-checkout `TMPDIR`; optional `DASHBOARD_RECEIPTS`
keeps screenshots private. No installed source or physical device is used.

Automation tabs (#1315) extend the existing
`node apps/runtime/dashboard/tests/automation.browser.ts` journey, now included
in hosted smoke as well as the full local browser suite. It checks keyboard tab
navigation, on-demand editors, cross-tab drafts, Cancel/save focus, guarded
mutations, global uncertain feedback, recent-attempt evidence and light/dark
layout at 320, 390 and 1440 px. Run it after the root build with an
outside-checkout `TMPDIR`; optional `DASHBOARD_RECEIPTS` keeps screenshots private.
These synthetic checks change no installed routines or devices.

The shared dashboard save lifecycle (#1645) is exercised by the dashboard
unit suite and existing browser journeys. Automation checks that reconnect
reads updated routines without clearing uncertainty or changing its status to
“Up to date.” Wemo checks typed refusal, revision conflict, a delayed owner
copy after an accepted limit save, and explicit refresh without replay.
The Hub mode, Inbox, session label and notice override journeys exercise the
other consumers with the existing synthetic runtime.

Paged Home lists (#1658) extend the same Home editor chain, so hosted smoke and
the full browser suite run them. After the root build,
`node apps/runtime/dashboard/tests/home-paging.browser.ts` checks, in one
column at 560 px where the fixed page sizes apply, Inbox paging
with the total count and card height, keyboard paging, items opened in place on a
later page, last-item dismissal, the Check Inbox landing page, focus after a
background removal, attention-first Agent status, Timeline reset, saved layouts
and 375 px width. `node --test apps/runtime/dashboard/tests/paging.test.ts`
covers the page arithmetic. Synthetic records only; with `DASHBOARD_RECEIPTS` set
it saves private 2x screenshots.

Home card shapes (#1672) replace the Home row balance journey (#1311) in the same
Home editor chain, so hosted smoke and the full browser suite run them. After the
root build, `node apps/runtime/dashboard/tests/home-shapes.browser.ts` checks the
built-in layout and three mixed layouts tiling on the 220px unit grid at 1100,
1440 and 1920 px (whole units, equal gaps, no overlap, all four shapes, saved
DOM order), a later card filling an earlier hole, one column at 375 px, the Edit
Home shape picker with holes, save, reload and Cancel, an old width-only layout
loading in its stated shapes with no write, Inbox and Timeline rows per shape
with an opened entry taking the page (including the open, change shape or
width, close, change back case), and every card in every shape it offers, each
tab face included, with no overflow, clipped control or scroll container. List
cards calculate their rows (owner decision 2026-11-11): the same journey checks
each fixed size in `listFit` (`src/paging.ts`) against the rendered card, a
full list leaving less than one row above its pager, one and zero Inbox items
in each shape, and no change inside a list card for two idle seconds at six
widths. Its `modules` part places the Pixoo, Tidbyt and Wispr cards in each
shape at the three widths and checks their own compact content (#1672 PR B):
nothing past the card even where it hides overflow, no generic face, no blank
band, two idle seconds without change, and a Wide Pixoo Screen off sending one
command whose result shows on the card. With an active session it also drives
Next, Previous, Pause and Resume in Wide and brightness Apply in Large square:
one request each, with the full card's fields, none for moving the slider and
one for a double click. `menus` opens the Pixoo menu in Small square and Wide
and a light card's menu, each over the card below, and checks by pointer that
the last item is on top; `stale` restarts the runtime and checks that the
disabled Pixoo controls say why. The idle recorder
(`apps/runtime/dashboard/tests/list-idle.ts`) counts every attribute write that
changes the value, even when a later write restores it, and leaves out only a
write of the value the attribute already had; `recorder` checks that a
per-frame flip and restore of an attribute, `hidden` and a class is reported.
`HOME_SHAPES_ONLY=tiles,picker,convert,paging,fit,results,short,menus,modules,recorder,idle,shots,stale`
selects parts. `node apps/runtime/dashboard/tests/home-idle.browser.ts`, in the
full browser suite only, sweeps every width from 1100 to 2560 px in 20 px steps
on the built-in and two mixed layouts with 0, 1, 5, 6 and 13 Inbox items and
asserts no change inside a list card for two idle seconds (about ten minutes;
`HOME_IDLE_WIDTHS` or `HOME_IDLE_STEP` narrows a local run).
`node --test apps/runtime/dashboard/tests/home-shapes.test.ts
apps/runtime/dashboard/tests/home-catalog.test.ts` cover packing, columns,
the conversion table, offered shapes and the hero's kept placements. The core's shape
rule and restart are in `apps/runtime/tests/home-layout.test.ts`; the
`home-layout/2.2` schema is in `packages/event-contracts/tests/home-layout.test.mjs`.
Synthetic records only; with `DASHBOARD_RECEIPTS` set it saves private 2x
screenshots. Journeys that inspect a module card's full content on Home
(companions, speech, mode overrides, Music artwork, Roborock, Volcano, Wemo,
Tidbyt, card consistency) do so in one column, where Home keeps full cards, and
check the generic compact face and its Open link on the wide grid (for Wemo, the
press panel, below); the Pixoo,
Tidbyt and Wispr journeys and hosted smoke check those modules' compact cards
there instead.

Home's glass layer (#1929) ends the same Home editor chain, so hosted smoke and
the full browser suite run it. After the root build, `node
apps/runtime/dashboard/tests/home-glass.browser.ts` launches Chromium with
SwiftShader for WebGL 2. It creates two artworks through the art module's
Gallery and serves dark and bright synthetic pixels through the module's content
route. It checks that the Quiet glass wash and then the artwork are drawn behind
see-through card surfaces and a frosted rail; that the boxes the layer last drew
(`data-glass-drawn`, placed where the glass canvas now is and cut to what can be seen, compared by
`apps/runtime/dashboard/tests/glass-boxes.ts`, whose unit test has a negative control)
match every card's box after loading, scrolling, scrolling again with no frame in between (#2023), resizing, moving and reshaping
a card in Edit Home, Cancel, paging the Inbox in one column and a reconnecting
notice above Home; that the frame count holds for two seconds at rest; that a
window resize to 2,560 px draws one frame and, with software rendering, at most
250,000 pixels; that a light switches off and on through the layer,
after a forced context loss (Quiet glass panels) and without WebGL 2; that a
restored context draws again; that leaving Home loses the context; and that all
text drawn over the layer (panels, heading, notices, status lines, empty cells
and the footer) measures at least 4.5:1 against the pixels behind it for a dark
and a bright artwork in light and dark appearance, at rest, while reconnecting
and in Edit Home. The hero's switch and chips (#1930) are measured too, against
their translucent fills as drawn over the layer. For the lit room (#1931) it
places two LIFX lights, the Nanoleaf light and a plug as Small squares, turns
one LIFX light red, and restarts the runtime so the simulated bulbs report at
once. It checks that the red light glows in its observed color from its ring's
center and the wall above it turns red, that the Nanoleaf light and the plug
glow in the skin's warm white, that a held press brightens a panel and eases
back, that the layer rests after the lights ease, that easing still reaches its
targets and rests when every other animation frame repeats the last timestamp,
that lit text keeps 4.5:1, that the dial and the plug show their state and
switch without WebGL 2, and that with every light off the layer draws exactly
what it draws with no lamps. Which run asserts the eased values (owner decision,
2026-11-19, "Check state, not pixels"): the full browser suite
(`home-layout.browser.ts`, run on main in its group's job by
`node scripts/ci-selection/runtime-browser.mjs run <group>`) and a
focused run of this journey require every eased value to reach its exact target
on a live layer. The hosted smoke chain (`npm run test:runtime-dashboard:smoke`,
App verification) runs the journey late in one long process; there each check
first reads the layer's state (`data-glass`, `data-glass-fallback`, the context,
the document's visibility). While the layer is live it asserts the same eased
values; once it has fallen back to Quiet glass or lost its context, it asserts
the Quiet glass panels and usable lit-room controls instead. The exact easing is
also covered by `glass-light.test.ts`. A failed lit-room check prints the
layer's state, a one-second timeline of `data-glass-frames` and
`data-glass-lights`, and the page and console errors. For the unfold (#1932), in a touch-capable window, it opens a light with its arrow by
pointer, touch and Enter and closes it with the arrow and Escape, checking the
Large square shape, focus on the first control tab and back on the arrow, that
opening a second light closes the first, that the cards it moves turn liquid and
the layer then draws nothing, that the opened controls fit with nothing scrolled,
that a window resize and reduced motion turn nothing liquid (reduced motion also
runs no move animation), that the page does not scroll sideways at 1440, 1024,
390 and 320 px with a light open (one column closes it), that Edit Home and a
reload show none open, that the saved layout is unchanged and no command was
sent, that the opened panel's text keeps 4.5:1, that a stale lighting layout's
notice sits inside the dial and the opened panel without moving the dial, and
that the arrow and the opened controls work without WebGL 2. With `DASHBOARD_RECEIPTS`
set it saves private screenshots.

Home's hero (#1930) follows the glass journey in the same chain. After the root
build, `node apps/runtime/dashboard/tests/home-hero.browser.ts` launches Chromium
with SwiftShader and checks the label, the mode word and the switch above the
grid; the light and plug chips against the observed device records, after a light
is switched off and as unknown while the stream is held; the switch from the
keyboard (arrows move without sending, Enter sends one `mode-set` with the current
revision); that the glass thumb's two capsules part while it travels, rest on the
selected segment and that no frame is drawn for two seconds after; Tab reaching
every chip with a visible ring; refused and uncertain results without a second
send; the hero kept with its focused chip across the one-column threshold;
dismissed art drawing the Quiet glass wash and Restore drawing it again; a saved
layout listing the Hub mode and Art cards loading without error, absent from the
grid and the picker, and kept by a save and by Reset; no horizontal scroll at 1440, 390 and
320 px in light and dark; and, without WebGL 2, a plain thumb and a working
switch. `node --test apps/runtime/dashboard/tests/home-hero.test.ts
apps/runtime/dashboard/tests/glass.test.ts` cover the chips' wording and the
thumb's time base. With `DASHBOARD_RECEIPTS` set it saves private screenshots.

The lighting journey's ring dial part (#1931,
`apps/runtime/dashboard/tests/light-dial-journey.ts`, on a fresh world after the
reusable lighting part) compares every command the Small square dial sends by
pointer press and drag, touch tap and drag (through Chrome DevTools touch
events, checking that the page does not scroll) and keyboard (slider keys, Space
and Enter on the switch) with the commands the Wide card sends, and checks that
the ring, the switch and the glow keep observed state while a request is in
flight, refused, newer than the bulb's report or uncertain, and in a read-only
session. The Wemo journey checks the plug press panel the same way by pointer,
keyboard and touch, with a lost reply leaving it locked. Each press, drag or key that should send waits until the dial is settled (enabled, with no request in progress or unresolved, `data-command-busy` absent) and checks that a command was sent; one that landed while the dial was blocked again is done again, at most three times, and a press that sent is never repeated. Each retry prints one `dialRetry` line with the step, the attempt and the dial's state, switch and busy mark; what re-blocks the dial is #2020.

The lighting journey's fuse part (#1933, `apps/runtime/dashboard/tests/fuse-journey.ts`,
on a fresh world with simulated Wemo plugs) drags by the handle with the mouse
(two lights, then a light with a plug) and by touch in a second browser (two
plugs, checking that the page does not scroll), checks the target mark and that
the card follows the pointer, that a drop elsewhere or on another kind of card
returns the card and sends nothing, that the ring still dims, and that the
keyboard path ("Group with", from a light and from a plug, and Ungroup) groups
and ungroups the same units. A refused save shows "Not grouped" and leaves the
lighting layout unchanged. All on with one plug refused at the gateway and one
bulb's write held sends each member its own power command, switches the third
and names the other two; All off then switches all three. The groups are there
after a reload and in a second browser, and a read-only session sees no handle
and disabled controls.

The television journey (#1112) runs the existing shell at a 1,920 × 1,080
viewport from the keyboard only, as a TV browser presents the D-pad. After the
root build, run `node apps/runtime/dashboard/tests/tv.browser.ts`. It checks
visible focus at every Tab stop on its way to Settings, a mode button, a card and
Sign in again; the agent cards' name, client, state and attention on their face
and last-evidence, attention and host/provider source text when opened; a dropped
stream marked stale and reconnected without a command; a mode changed by another
browser shown once and not repeated; Sign in again after a runtime restart from
the keyboard; no text overlap and no horizontal scroll in light and dark. It runs in App verification and in the
full local browser suite. It is synthetic Chromium evidence for the shell; the
owner's checks on the actual ONN are in
[ONN dashboard display qualification](../../docs/onn-dashboard-qualification.md).

Card consistency (#1217) extends the existing hosted smoke entry with
`node apps/runtime/dashboard/tests/card-consistency.browser.ts`. It compares real
synthetic-runtime cards, including an empty room and optional empty MicroDuck
placement, at desktop, the intermediate breakpoint and 320/390px in both themes.
It also compares reused cards on their feature destinations. It checks shared spacing and
type, tab selection/focus/boundary contrast, retained artwork and fixed faces,
corner/footer targets, attention and unavailable controls.
Only fixture setup saves metadata; subsequent inspection sends no product
command. Keep the full dashboard browser suite. Use an outside-checkout TMPDIR
and `DASHBOARD_RECEIPTS` for private screenshots and rendered metrics; these
establish no installed, actual-phone or physical-device result.

Reusable Hub mode and Inbox cards (#1182) extend the existing dashboard unit
discovery with `hub-mode-issues.test.ts`. After the root build, run
`node apps/runtime/dashboard/tests/hub-mode.browser.ts` and
`node apps/runtime/dashboard/tests/inbox-history.browser.ts` for correlated
warning/handling, explicit reapply, no replay, authority and disclosure checks.
Both journeys run through the existing hosted smoke entry and the full local
browser suite. Use an owned private outside-checkout `TMPDIR`; screenshots stay
private. These checks use synthetic devices, not the installed runtime.

Reusable agent cards (#1179) use the existing dashboard unit discovery for
attention/freshness summary rules and Home placement. The existing `browser.ts`
journey covers card disclosure, filtering, label drafts, unread preservation and
reconnect, and checks light/dark desktop/phone keyboard behavior. Run the
full dashboard suite below after building. Existing core CI and App verification
cover these checks; no additional workflow or service is needed.

The reusable Wemo card (#1175) extends the existing `test:wemo:browser` journey
with fixed Power/Auto-off geometry, retained drafts, keyboard switching, Home
reuse and uncertain-limit-save recovery. Existing dashboard unit discovery runs
`wemo-card.test.ts` for observed-versus-desired power and admission gates. These
use the existing App verification and core CI entries; no new workflow is needed.
Keep the page-closed enforcement and independent-plug assertions, and use
`DASHBOARD_RECEIPTS` for private synthetic browser screenshots.

The cleaner shell (#1173) uses the existing dashboard unit discovery for routes,
navigation grouping and directory projection. After the root build, run
`node apps/runtime/dashboard/tests/shell.browser.ts` for five-destination
navigation, retained page addresses, passive browsing and light/dark desktop/phone
layout. The existing hosted smoke and full browser entries include this
journey; synthetic browser proof does not establish actual-phone or device results.

The rail (#1887) extends the same journey and the dashboard unit discovery.
`node --test apps/runtime/dashboard/tests/rail-preference.test.ts` covers the
collapse preference: the default for each window size, one remembered choice per
size, damaged values, refused or missing storage and a change from another tab.
`node apps/runtime/dashboard/tests/shell.browser.ts` checks that Settings, the
feed indicator and the control mode sit at the bottom of a rail that stays in
view; that the rail is expanded at 1440px and an icon rail at 1024px, with each
destination's name kept once and shown on hover; that a toggle survives a reload
for its own window size only and still works when the save is refused; and that
at 390px the menu button opens a drawer which Escape, an outside tap and a chosen
destination close. Journeys that navigate at phone width open the drawer through
`destinationLink` or `openSettings` in
`apps/runtime/dashboard/tests/navigation-helpers.ts`. Run every
dashboard browser journey for a shell change, since the main column's width
below 1200px depends on the rail.

The jump palette (#1888) uses the same two entries.
`node --test apps/runtime/dashboard/tests/jump.test.ts` covers the list (hub
destinations, the pages of running modules once each, and recent pages without
the current one), the filter's ranking over names and hints, which inputs
count as text fields, and the key rules: Command or Control and K, the Mac
exception for Control and K in a text field, the slash outside a field, menu,
list or dialog, and no key while a modal dialog or a full-screen element covers
the page.
`node apps/runtime/dashboard/tests/shell.browser.ts` opens the palette from the
keyboard, the rail's field, the phone bar and the phone drawer; checks the
groups, arrow keys, narrowing, the empty result and that a stopped module's
pages leave the list after a catalog read; checks that the page and the rail
are inert behind it, that closing returns focus, that the browser's back button
closes it, that a chosen page opens at its top with focus on the page from a
scrolled one, and that it fits 390px and 320px windows; and records no command, sync, upload or provider request while
it opens, narrows and closes. It also checks the chosen row's 3:1 boundary in
both themes, that a scrolled list stays put when the shell renders, that the
keys work and typing reaches the field with focus outside it, that a press on a
heading or the footer keeps focus in the field, that the palette's stacking
level is above the full-window visualizer's, that a stubbed full-screen element
keeps it closed, that a slash on a slider opens it, that a held Enter opens it
without choosing a row, that the toggle's box and focus ring stay clear of the
brand, and the height at which the rail stops staying in view. The journey reads the height the full rail needs from the laid-out rail, since fonts differ between a Mac and the Linux container, and checks that the rail scrolls with the page in a window one pixel shorter and stays in view, whole, in a window of exactly that height: with one pinned page, with nothing pinned, where the rail keeps the room for one row, and for an ended
session, whose rail needs more and whose recovery can be scrolled into view. It is opened there on the Devices directory,
which mounts no module page, because a module page reads its copies with a sync
request when it mounts.
`node apps/runtime/dashboard/tests/conversation-workspace.browser.ts` checks
that a slash typed in the composer is text, that the palette opened from the
composer returns focus and the draft, and that it stays closed under the modal
Details drawer.

Conversations in the rail (#1890) add one unit file and one journey.
`node --test modules/companions/dist/tests/conversation-rail.test.js`, part of
`npm run test:companions`, covers the shared store, which tasks wait on an
unanswered question, which of them need the owner, the phone marker's rule and
which question the rail reads.
`node apps/runtime/dashboard/tests/conversation-rail.browser.ts` has two parts.
The first mounts the companions frontend's rail group over a synthetic module
scope with the page's clock held: it checks one history read for each pending
question, the marker for a clarification and an approval and none for delegated
work, no marker and no read from a state copy that is removed, failed,
restarted, unavailable or disconnected, a failed read that is not repeated on a
timer and is made again on the next state change, when the copy is live again
and when the open Conversation page moves to another profile, the kind shared
by the open Conversation page, a modified click, and that the group sends no
command and opens no speech endpoint. The second opens the real dashboard: it opens a profile from Home,
Rooms and a device page, checks that each row fits the rail, on one line where
its own widths allow it, that a short window keeps the conversations and the
foot directly under the pinned pages, each profile's own history, the marker on every
page and after a reload, the phone menu button, the drawer's rows, the icon
rail's label, a failed history read, and a catalog with companions stopped or
without the Conversation page. The companions browser entry runs it, and the
hosted smoke entry does not: run `npm run test:companions:browser` in the Linux
test container when the rail's text or sizes change, because the container's
fonts are wider than a Mac's.
`conversation-workspace.browser.ts` now also checks the one header row, the
920px measure with the composer's width at 1024px, 1280px and 1440px, a
profile chosen in the rail with its own history and draft, that the Devices
menu lists no companion page, and a companion profile opened from the
Companions overview. Journeys choose a profile with `chooseConversation`
in `apps/runtime/dashboard/tests/navigation-helpers.ts`.

The Devices menu and the pinned pages (#1889) add two unit files and one
journey. `node --test apps/runtime/dashboard/tests/device-menu.test.ts` covers
the menu's columns and categories, a module with one page and with several, an
address listed once, a module that is not running, stale observations, an
unread or failed catalog and the arrow, Home and End steps.
`node --test apps/runtime/dashboard/tests/pins.test.ts` covers which addresses
can be pinned, a damaged saved list, pinning and unpinning across a reload,
refused or missing storage, a change from another tab, and the pages that can
be named as pins with their marks.
`node apps/runtime/dashboard/tests/devices-menu.browser.ts` opens the menu from
the Devices row in the full rail and the icon rail; checks its groups, the
keys with focus on an entry and on nothing, the focused entry's ring, Escape,
a press outside, a press inside a framed page, Tab, the palette's key, a
narrowed window, a short window, the browser's back button with focus handed
to the row, and "All devices"; pins and unpins from a page header and
from the rail's rows with the keyboard, across a reload; checks the temporary
row, the Conversation page, a light's own page, a pin whose page is not
declared, a stopped module and its state on a pinned row, the Devices row's
box on the Conversation page, a list longer than the rail and the icon rail's
marks; checks at 390px and 320px that the menu covers the drawer, scrolls and
closes with its own button while the drawer stays open, that the lighting
heading keeps its name on one line, and that the temporary row's pin button is
a full touch target; checks pins with
storage refused; and records no command, sync, upload or provider request
while the menu and the pins are used. The hosted smoke and full browser entries
include it. The menu slides in, so the journey measures its box after its
animation has finished. Devices is not a link, so journeys open the directory
through `openDirectory` in `apps/runtime/dashboard/tests/navigation-helpers.ts`.

The hardware-only Devices, the Companions destination and the display views
(#1950) add four unit files: `directory.test.ts` (hardware only, categories,
brands with their lights, a module that is down), `device-names.test.ts`
(published label, Nanoleaf kind, readable ID, telling names apart),
`companions-overview.test.ts` and `feature-navigation.test.ts` (Pixoo's views,
Tidbyt's one view, existing addresses). `devices-menu.browser.ts` also checks
that the menu lists hardware only with one entry each for Pixoo and Tidbyt,
that Nanoleaf and LIFX start collapsed, expand to their lights and overview by
pointer and keys, skip their collapsed lights with the arrow keys, open again
for the current light and send nothing; that each light opens its own page and
leads back to its brand; that the directory shows the same lights; Tidbyt's
Status and Content, Pixoo's Display, Device settings, Agent status, Media and
Playlists, an old Player bookmark and the palette's Monitor entry; the
Companions overview, an old Habitat bookmark and the conversations; and at
phone width that "All devices" stays in view with both brands open and that
Escape closes the menu before the drawer with focus handed back each time.
Journeys reach a task page with `deviceTab`, Habitat with `openHabitat`, Audio
with `openAudio` and a page outside the hardware inventory with `jumpTo`.
`node apps/runtime/dashboard/tests/devices-glass.browser.ts` checks those pages
on the glass layer with SwiftShader, as `home-glass.browser.ts` does for Home:
every card's glass follows its box at 1440, 390 and 320px and after scrolling,
the card surfaces are clear, nothing draws at rest, a window resize draws one
frame and software rendering stays under 250,000 pixels, a page
that grows below the window draws no frame, the visible
veils stay few, text over the layer keeps 4.5:1 at 1440, 390 and 320px in light
and dark, the popout keeps its fill, the directory, Companions (also after a
reload) and Home opened from the phone drawer look the same after a redraw from
scratch at rest, leaving releases the layer, and with WebGL 2 missing or a lost
context the Quiet glass panels stay and the menu, directory, display tabs and
Companions links work, sending no command. Its contrast samples only glyph
pixels: the page is captured with its text and again with the text transparent,
and a pixel counts where the two differ, measured against the capture without
text, so an empty line-box row over something else, such as an artwork's
shadow, is not taken for text. A run wholly in the window with no glyph pixel
fails the journey, naming the run, since its ink is too close to its ground to
show (`apps/runtime/dashboard/tests/glyph-contrast.ts`, with a negative control in
`apps/runtime/dashboard/tests/glyph-contrast.test.ts`). `devices-menu.browser.ts` also scrolls a glass page
under the open popout in a short window and checks the popout stays whole and
under the pointer, and `pixoo-player.browser.ts` checks that playback status
ticks on the glass Player page draw no frame. With `DASHBOARD_RECEIPTS` set it
writes private screenshots.

Reusable Music cards (#1164) use existing event/core/dashboard test discovery.
After the root build, run `node --test packages/event-contracts/tests/playback-layout.test.mjs apps/runtime/dist/tests/playback-layout.test.js`
for bounded metadata, operator admission, atomic revision guards and restart.
Run `node apps/runtime/dashboard/tests/music-card.browser.ts` for Home/Audio/Rooms,
explicit persistent placement, read-only/stale/uncertain behavior, keyboard,
artwork fallback and narrow layouts. The journey runs
in App verification and the full local dashboard browser suite, using synthetic
tracks and room IDs without household-device contact. Keep the existing artwork
race journey and full owning checks; simulated proof establishes no audible result.

The music visualizer (#1619) adds `dashboard/tests/music-visualizer.test.ts` to the
existing dashboard unit discovery. It drives both effects with a fake feature stream
through the real `CaptureProjection`: silence, a steady level, a single beat,
band changes, and rest when the stream stops, goes stale or changes generation.
It also covers the browser-only effect choice, the shared capture scope, the
catalog entry and the `#/audio/visualizer` address. After the root build, run
`node apps/runtime/dashboard/tests/music-visualizer.browser.ts`, which the
Music-card browser entry also imports. It checks both effects and the resting
state on the Audio panel at 1440, 390 and 320 px, and the Home card at 1440 and
390 px. Layout editing (add, move, reload and remove) runs at 1440 px. The full
view and its Fullscreen API run at 1440 px and at 3,840 × 2,160. The journey also
checks that the visualizer sends no command. It records frame timings at
3,840 × 2,160 for the live effects and for a resting and a blank-canvas baseline in
the same run. These headless, software-rendered timings do not qualify AC6 either
way; whether the full-screen view drops frames is judged at the owner's installed
TV check. `VISUALIZER_EVIDENCE` keeps the screenshots and timings
private. The owner's view of the installed dashboard is separate.

Reusable lighting (#1135) uses the existing event and core test discovery in CI.
After the root build, run
`node --test packages/event-contracts/tests/lighting-layout.test.mjs apps/runtime/dist/tests/lighting-layout.test.js apps/runtime/dist/tests/home-layout.test.js`
for bounded composition, plug members (`lighting-layout/2.1`), authenticated
admission, revision conflicts, durable restart, Home placement reconciliation and
metadata-only effects. The shared dashboard model tests join
`test:runtime-dashboard:built`; the focused browser journey is
`node apps/runtime/dashboard/tests/lighting.browser.ts` (also called by the
controls browser suite). The `lighting-layout` catalog scenario runs in disposable verification. These tests use synthetic
rooms and simulated devices. They do not establish installed/client or physical
acceptance. Keep runtime-private test directories outside Git checkouts under
an owned private `TMPDIR`.

`apps/runtime/dashboard` is the B.U.N.N.Y. dashboard on the runtime (Hub #922),
copied from `apps/dashboard`; its [README](dashboard/README.md)
covers what it has and [PROVENANCE.md](dashboard/PROVENANCE.md)
what was copied and changed. It follows the
[strict profile](../../docs/development.md#strict-profile-for-new-code), tests included: `src/`
type-checks for the browser with its own `tsconfig.json`, and `tests/` for Node
with `apps/runtime/dashboard/tests/tsconfig.json`. Node 24 runs the tests' TypeScript as it is, with no
build step of their own.

Use Node 24 from the worktree root. `npm run build` builds the page into
`apps/runtime/dist/dashboard/`, after the SDK and the event contracts, and
`npm run typecheck` checks both projects.

The module-page tests cover catalog/build agreement and reuse of the shell's
connection, including read-only refusal and cleanup of active or late syncs.
The normal dashboard build also compiles the fixed frontend imports for the
browser. Real feature interactions and trusted iframe execution are verified
by the owning story's focused browser and disposable Acceptance checks.

The Rooms, Music card, Music capture, Music lighting and Home shapes journeys
use `dashboard/tests/journey-runner.ts`. Start each simulated world with
`runJourney`, name the current step with `run.step`, and use `run.newContext`
for every browser context. Its pass-through route remains active when a page
removes one of its handlers. Use `run.closeContext` to retire a context early.
A failure reports the step and a private temporary directory containing one
Playwright trace per context. Open a completed trace locally with
`npx playwright show-trace /path/to/context-1.zip`. The world’s hard deadline
reports the same directory and step. An interrupted context leaves its live
trace there. A successful journey removes its traces.

Dashboard journeys that manage their own browser use `openJourneyContext` from
`dashboard/tests/browser-context.ts`. Each context installs the same pass-through
route as the runner before navigation, including for later tabs and popups. For a
page created by `browser.newPage()`, call `keepRequestInterception(page.context())`
before its first navigation. A journey can remove all of its page routes while
requests are in flight. Playwright keeps HTTP caching disabled for the context.

```bash
npm run test:runtime-dashboard:built     # unit tests: routes, widgets, the session rows and the skin's tokens
npm run test:runtime-dashboard:smoke     # one trusted loopback page, about 2 s; CI's App verification job runs it
node apps/runtime/dashboard/tests/tidbyt-card.browser.ts # reusable read-only Tidbyt card; also runs in hosted smoke
npm run test:runtime-dashboard:browser   # the full browser suite; hosted CI runs it after merges to main (#1942)
npm run test:runtime-dashboard:browser:2 # one of its journey groups; hosted CI runs each group in its own job (#2015)
BUNNY_TEST_CADDY=/path/to/verified/caddy node apps/runtime/dashboard/tests/wifi.browser.ts # local HTTPS, phone width; optional BUNNY_TEST_BROWSER=webkit
node apps/runtime/dashboard/tests/notice-clear.browser.ts # focused confirmed notice override
node apps/runtime/dashboard/tests/hub-mode.browser.ts <private-evidence-dir> # focused Hub mode controls
node apps/runtime/dashboard/tests/inbox-history.browser.ts # focused inbox actions and timeline
node apps/runtime/dashboard/tests/automation.browser.ts # routine/rule tabs, drafts and lost replies
node apps/runtime/dashboard/tests/music-capture.browser.ts # Music/microphone measurement, tracked start/stop and freshness; also in hosted smoke and Music-card browser entry
node apps/runtime/dashboard/tests/music-visualizer.browser.ts # visualizer panel, full view and Home card over the numeric fixture; also in the Music-card browser entry
node apps/runtime/dashboard/tests/music-lighting.browser.ts # Music lighting Start/Stop on simulated Lines, endings, stale reads and lost replies; also in hosted smoke and Music-card browser entry
node apps/runtime/dashboard/tests/pixoo-pages.browser.ts # shared Pixoo cards, playlist drafts and trusted editor bundle
node apps/runtime/dashboard/tests/pixoo-upload.browser.ts # ordinary binary import, retained request and read-only refusal
node apps/runtime/dashboard/tests/pixoo-playlists.browser.ts # create, rename, options, items, order and deletion
node apps/runtime/dashboard/tests/pixoo-library.browser.ts # saved rendition rendering and media deletion without display writes
node apps/runtime/dashboard/tests/pixoo-player.browser.ts # frozen sessions, playback controls and explicit restart with changes
node apps/runtime/dashboard/tests/pixoo-monitor.browser.ts # title refresh, passive reads, presentation controls and Pixoo-only dismissal
node apps/runtime/dashboard/tests/pixoo-settings.browser.ts # safe setup projection and explicit brightness/screen commands
node apps/runtime/dashboard/tests/nanoleaf-pages.browser.ts # retained wall editor through authenticated tracked commands
```

The Music input check uses a numeric-only producer fixture through the real core
and gateway. It verifies passive load/reload/reconnect, measured silence,
expiry, delayed clock qualification, pending and lost Start replies, independent
Stop, read-only refusal, replacement generations and endpoint loss. The configured
microphone journey checks selection without capture, 2.1 starts, fixed refusal,
retry, reload and a return to unchanged 2.0 Music work. Desktop and
320/390 px light/dark checks include keyboard use and
overflow. It opens no native helper or media source. The dashboard unit suite covers
clock jumps, source identity/order, exact conservative expiry and late scope
cleanup. The browser-safe `v2/music-capture-data` export keeps existing wire
values; the event suite verifies export parity and a browser bundle with no
server registry dependency. Run `npm run test:events:built`,
`npm run test:music-producer:built` and `npm run test:runtime:built` for its
existing contract consumers after the shared build.

The Nanoleaf editor check (#934) uses the actual module with a simulated Lines controller. It covers passive reads, local selection, tracked editing, read-only and Origin refusal, observed power, keyboard use and re-entry. The `nanoleaf-editor` catalog scenario runs through both tier-1 transports and disposable Acceptance. `test:nanoleaf:built` includes the literal-source Prism adapter test beside the compiled TypeScript tests; retained browser JavaScript does not require a second runtime build policy.

The same `nanoleaf-pages.browser.ts` entry includes offline decorative show
authoring (#723): starter drafts, immutable named saves, version reads and cue
storyboards through the real gateway/core/module. It checks stale-save,
read-only and Origin refusals, cancelled/failed reads retaining drafts, uncertain
attempts without resend, unchanged simulated device state and light/dark
desktop/390/320px layout. `DASHBOARD_RECEIPTS` keeps synthetic screenshots
outside the checkout. The Nanoleaf built suite covers atomic save/outcome
rollback, full storage, deferred publication, core acknowledgment, restart,
bounded content and delayed-sync freshness. No test uses an installed source,
personal media or physical controller.

The same Nanoleaf browser entry covers reactive presets (#722): explicit named
saves, exact reload and restart, full frozen V1 recipes in synthetic preview,
read-only/Origin/stale/invalid refusals, local drafts through refresh and
reconnect, uncertainty locks through reload, and light/dark 1440/390/320 px layout.
The Nanoleaf built suite includes a frozen previous-source SQLite schema,
full-disk and transaction rollback, deferred outcome publication/core-only
acknowledgment, mixed-family high water and maximal document/query bounds.
Run `node --test modules/nanoleaf/dist/tests/music-presets.test.js modules/nanoleaf/dist/tests/module-presets.test.js modules/nanoleaf/dist/tests/reactive-preset-model.test.js`
after the shared build, then the existing owning suites. These checks use no
audio, installed state or household devices. A browser journey that cannot
start its disposable listener has not satisfied acceptance.

The core CI job runs `test:runtime-dashboard:built`. The browser checks use
Playwright Chromium against the built runtime in the test's own process, with
the core, its gateway on a free loopback port, a private state directory under
the system temporary directory, which must be outside every Git checkout, and a
synthetic hook that publishes lifecycle observations through the SDK edge. They
contact no device and no installed service. `smoke.ts` checks that the gateway
serves the built page, which signs in without a form, shows a synthetic
session's finished turn unread with the Hub mode and inbox panels
and sends no command while it loads. The full suite (`browser.ts` and
`trusted.ts`) adds sessions appearing, an approval raised and cleared, a
finished turn that stays unread until the record clears it, a resync after a
lost stream with no replayed command, positive read evidence and a synthetic
device acknowledgment clearing rows without a page command, routes,
Places, a session that ends with a restart, Disconnect,
the launcher's code, the bookmark on either loopback name, a reload and a
second tab, and another local app's link, frame and hostile re-navigation
(Hub #561). The focused `controls.browser.ts` journey adds a simulated LIFX
control that shows accepted before completion, an uncertain write locked across
reload and read-only refresh without replay, a manifest-declared sign page in the
shell, Connections build identity and keyboard activation.
It also runs directly with `node apps/runtime/dashboard/tests/controls.browser.ts`
after a build when the accepted local scope calls for only that changed journey.
The focused `inbox-history.browser.ts` journey checks explicit resend, dashboard
dismissal visible through MCP, timeline filters, keyboard and read-only access,
and reload without replay.
Run the full suite when a change touches `apps/runtime/dashboard`, the gateway's
page or sign-in routes, or the SDK's remote client. Set `DASHBOARD_RECEIPTS` to
a directory to keep their screenshots.

The focused `hub-mode.browser.ts` journey drives Home's hero (#1930) with
synthetic participants to check keyboard selection, the selected segment's icon,
same-mode reapply, correlated Inbox
navigation/handling, pending versus definitive results, late conflicts, lost
replies, read-only controls and reconnect/reload/restart without replay. Its
controlled adapter checks verify stale evidence and accepted/uncertain handling
locks without another command. It checks light/dark desktop/phone layout on
the hero and the Inbox and writes screenshots to its optional private evidence directory.
It contacts no physical device.

The focused `pixoo-pages.browser.ts` journey uses the real Pixoo module with a
fresh synthetic library and simulated display. It checks a revision-bound name
save through the shared shell, owner-confirmed state, read-only refusal,
reload without resend and no display write. It also executes a
separately bundled trusted editor fixture while retaining passive-page script
refusal. It also imports `pixoo-cards.browser.ts` (#1154), covering the shared card on
Home/device/Player, animated visible pages, selection across searches/pages,
bitmap cleanup, populated creation, draft preservation,
revision refusal, frozen playback, restart, lost replies and reload.
The CI smoke mounts the same card passively. The `pixoo-pages` catalog scenario
also covers atomic populated creation and duplicate/invalid-item refusal through
both transports and disposable verification. The full local browser command
includes this journey and the Library,
Playlists, Player, Monitor and Settings journeys. They cover saved renditions,
referenced previews, explicit controls and read-only access.
Monitor's synthetic Desktop module publishes metadata through its own SDK;
no provider files are read. This proves a title-only update reaches the page
without a manual refresh or a new command.

The `pixoo-pages` catalog scenario exercises declared React pages, passive
bounded reads and previews, one tracked playlist edit and a forged read-only
refusal. Run it in both catalog transports and through the disposable adapter;
independent Acceptance also uses the pages interactively. These are source and
simulator checks, not physical-display acceptance.

### Shared habitat checks

The permanent `#/habitat` page is covered by `test:runtime-dashboard:built`, the full dashboard browser suite and the hosted smoke entry. For a focused run after `npm run build`, use `node apps/runtime/dashboard/tests/habitat.browser.ts` with a private outside-checkout `TMPDIR` as required by the runtime state contract. This exercises synthetic session lifecycle events through the disposable core and existing shell connection, not an installed runtime or physical device. The browser check includes dark/light desktop and 390 px layout, local settings transfer, reconnection and renderer cleanup. Allocation and preference failure cases live in `dashboard/tests/habitat.test.ts`.

### Furnished apartment checks

Anonymous reported presence (#1837) uses the public Presence Pro contract and
the existing dashboard SDK copies. After `npm run build`, run
`node --test apps/runtime/dashboard/tests/apartment-presence.test.ts apps/runtime/dashboard/tests/runtime-feeds.test.ts`
and `node apps/runtime/dashboard/tests/room-models.browser.ts`. Existing dashboard
unit discovery and App verification's room-model journey include these checks.
The synthetic real-owner journey covers room-only reports, separate sensors,
held/unknown points, receipt-time limitations, loss/reconnect, desktop/phone and
zero commands. The same checks cover the combined dot's eligibility and expiry
and switching to the separate Sensors dots. Use a private outside-checkout
`TMPDIR`; it contacts no hardware.
Run the normal shared build/type/lint/contract/workflow and dashboard suites.
Physical enrollment, manual placement checks and usefulness belong to #1842.

After `npm run build`, run `node --test apps/runtime/dist/tests/apartment*.test.js`
and the existing `node apps/runtime/dashboard/tests/room-models.browser.ts` journey.
The Runtime unit tests glob and the existing App verification room-model step
discover this coverage. The checks use a synthetic calibrated plan, normalized
room scans, prepared PNGs and the real core lease, authenticated content API and
simulated light queues. They check previous-version retention, bounded content,
desktop and phone interaction, and zero device commands on passive actions.
Use the private temporary-directory instructions under Native runs on macOS.
