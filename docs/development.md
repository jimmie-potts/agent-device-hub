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
pull requests and pushes to main, and report each job as a GitHub check named
after the job. Superseded PR revisions are cancelled per workflow and PR; main
revisions keep independent runs. Each job has a ten-minute timeout, except the
core and Workflow jobs' fifteen, the retained documentation job's twenty-five and the App verification job's thirty. Branch pushes do not duplicate PR checks.
Hosted runners sometimes stall in apt, in `apt-get update` or in a browser
install's `--with-deps` downloads, until the job's limit. So every apt command in
CI runs through `scripts/apt-retry.sh` (#862): the browser installs in App
verification and retained documentation, with 300 s per attempt, and the hook-qualification
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
Active workflow files are `checks.yml` and `workflow.yml`. The Work Guide
workflow and its path exceptions are removed. The existing Workflow workflow
owns both Workflow checks and Retained documentation checks.

Checks ignores `**/*.md`; both Workflow jobs still run for Markdown-only changes
under the [Markdown-only rule](sdlc.md#markdown-only-ci-routing). Mixed changes
require every configured job. Inspect the complete changed-file list and hosted
event/check records; missing runs alone never establish filtering.
Tag pushes are outside the main-only push trigger. Static tests verify workflow
configuration; only hosted event evidence verifies actual scheduling.

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

Normal CI has five GitHub-hosted Linux jobs, and each suite runs in exactly one of them:

| Check | Runtime and coverage |
| --- | --- |
| Workflow checks (Workflow workflow) | Node 24 workflow validation, delivery preflight fixtures and isolated Linux hook qualification. It also runs for Markdown-only changes. |
| Build, lint and core tests | Node 24 and Python 3.14 in one job: one build, then typecheck, [static analysis](#static-analysis), every kept Node `:built` suite and package consumer (the runtime and its scenario catalog, SDK, events, lifecycle, agent state, the Pixoo module with Vitest and node:test, the Nanoleaf port, the playback, LIFX and Tidbyt modules, MCP, Wispr, maintenance, observability and CHOMPI bridge), the 1.x controller contracts' Node tests, the unit tests of the old dashboard and the runtime's dashboard, and the Python observability, event, lifecycle and agent-state consumers |
| Firmware | Host-compiled CHOMPI controller tests with sanitizers, then the ARM build with the pinned toolchain and the artifact check |
| Retained documentation checks (Workflow workflow) | Python 3.12 diagram/atlas/navigation and maintenance-parser checks, plus Node 24 browser checks with review artifacts |
| App verification | Node 24 build, Chromium, the app-verify core's receipt and unsupervised capture tests and its isolated archive consumer, the CHOMPI bridge and runtime adapters' steps, the bridge control page's browser check, the smoke checks of the old dashboard and the runtime's dashboard, and the observability contract's browser check; lifecycle tests skip with a printed reason when the runner has no systemd user manager |

The Checks workflow performs two full builds across its jobs. The Python
suites run on Python 3.14 only, the version of the installed Nanoleaf runtime.
Checks that call the runner's system
`/usr/bin/python3`, such as the Linux performance qualification and the
maintenance closeout fixtures, use Ubuntu 24.04's Python 3.12. Local validation runs the same commands. Later runtime and browser
changes must add their own issue-appropriate checks.

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
`test:contracts:built` runs because MCP, maintenance, the event mapping tests
and the observability pilot import `@jimmie-potts/device-contracts` from source.
`test:dashboard` and `test:dashboard:smoke` run because #922 copies the
dashboard into the runtime; the copy has its own
[checks](#runtime-dashboard-checks). The Python setup still installs
`requirements-contracts.txt`, whose Pillow pin only the local Tidbyt check uses.

Native Windows is outside the supported CI matrix. Windows development uses
Linux Node/Python runtimes inside WSL. Ubuntu CI does not establish installed
WSL/client or device compatibility. Keep that acceptance evidence separate.
Existing provider qualification records and device ownership are unchanged.

### CI cost and suite timings

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
`npm run preflight -- --help` lists the options. The script compiles
`packages/app-verify` first, because proof receipts are checked with its
`validateReceipt` rather than a second reader.

The tool only reads. Before any network use, its GitHub client refuses every
request except `GET` and the tool's own two GraphQL query documents, matched by
exact text, so it cannot merge, comment, label, approve, dispatch or change
issue state. It writes no file. The only process it starts is `gh auth token`,
and only when neither `GH_TOKEN` nor `GITHUB_TOKEN` is set. The output names
revisions, check IDs, comment URLs, digests and run IDs, plus short structured
fields from the evidence it reads, such as receipt capture reasons. It never
prints tokens, local paths or reviewer return text.

| Gate | What it reads | Rule |
| --- | --- | --- |
| Source identity | PR state, live head against `--head`, base branch tip against `--base`, merge-base, draft, conflicts, fork head, non-main base and closing keywords. The work issue is `--issue` or the single `Refs #<n>` in the PR body; a missing or ambiguous one is unresolved, except for the bot-opened nightly guide refresh | [Review and merge](sdlc.md#review-and-merge) |
| CI | Expected jobs from the revision's workflow directory at the PR head and, once merged, at the main merge commit: `.depot/workflows/` with Depot's `<workflow> / <job>` check names when it exists, otherwise `.github/workflows/` with GitHub Actions' job names. It applies matrix expansion, GitHub path-filter semantics (`*` and `**`; a filter with negation, `?`, `+` or `[]` keeps every job expected) and branch-rule checks; every page of `filter=all` check runs. A workflow edit, including a move between providers, cannot drop a job expected at the merge-base without an unresolved entry; jobs compare by `<workflow> / <job>` | [CI evidence](sdlc.md#ci-evidence) |
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
missing work issue, both finish-line kinds, removed-flag refusals, filtered paths
and dirty or failed-capture receipts. It also
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
CI. The retained old Nanoleaf worker is Python; the current runtime's domain logic is
ported to TypeScript in `modules/nanoleaf` (see [Nanoleaf port](#nanoleaf-port)).

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
`fixtures/v2/`. `test:events:built` also runs `tests/v2.test.mjs`, which
covers every message kind and building block, the size cap, expiry, retry
identity, module schema registration and the error code registry. Profile 2.0
has no Python mirror; `test:events:python` checks profile 1.0 only. Its
sources follow the [strict profile](#strict-profile-for-new-code).

`test:events:built` also runs the core and device payload family tests (Hub #842,
#918):
- `tests/families.test.mjs` runs `fixtures/v2/families.json`: a valid message
  for every core family, each invalid case with its expected detail, and removal,
  expiry and sync scenarios through the reference consumer in
  `tests/consumer.mjs`.
- `tests/devices.test.mjs` runs `fixtures/v2/devices.json`: a valid message for
  every device family, a reply and an outcome for each command family, each
  invalid case with its registry code and detail, the capability rule, the
  routing-key subject of every command family, and the Hub-mode table for each
  participating device kind, which must equal the package README's.
- `tests/status.test.mjs` runs the 2.0 status helper's copied cases against
  valid `session/2.0` records, and checks its ranking and colors against the 1.x
  `@jimmie-potts/agent-status`.
- `tests/mapping.test.mjs` checks that
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
binding with synthetic facts; it starts no runtime or service. The existing core
CI `test:runtime:built` discovery includes this file. The focused check does not
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

See [Runtime checks](../apps/runtime/DEVELOPMENT.md#runtime-checks) for the authoritative procedure.

### Runtime test layers

See [Runtime test layers](../apps/runtime/DEVELOPMENT.md#runtime-test-layers) for the authoritative procedure.

### Runtime verification runs

See [Runtime verification runs](../apps/runtime/DEVELOPMENT.md#runtime-verification-runs) for the authoritative procedure.

## Runtime dashboard checks

See [Runtime dashboard checks](../apps/runtime/DEVELOPMENT.md#runtime-dashboard-checks) for the authoritative procedure.

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
and text-sharing opt-out, keyboard and accessibility. Inspection sends no
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
child process that holds a bulb's lease. The maintenance intake test's clean run
configures every shipped module from its factory's `simulatedSection`. The runtime's catalog
scenario `lifx-bulbs` runs the module in `test:runtime:scenarios:built` and in
[disposable runs](#runtime-verification-runs). Installation and the physical check
belong to the cutover (#840).

## Tidbyt module checks

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
`npm run test:tidbyt-module:built` after its fresh build. The suite covers the
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

## Nanoleaf port

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
module test kit. The runtime's `speaker-playback` catalog scenario runs the
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
`test:runtime:scenarios:built`, `test:maintenance:built`, `check:workflow` and
`test:workflow`. Select local disposable scenarios or the full verification
suite under [Runtime verification runs](#runtime-verification-runs).
The build compiles the module and its tests
(`tsc -p modules/pixoo/tsconfig.json`) before the runtime, which ships it. The
core CI job runs `test:pixoo:built` after its fresh build.

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

After the import, divoom-app-upgrade takes only bug fixes. Mirror each one here.

## Pixoo catalog and preview checks

Hub #353 adds `apps/hub/tests/pixoo-catalog.test.mjs` to the existing Hub and
packaged Hub suites. It covers minor-version negotiation and fallback, scoped
catalog reads, pagination, exact frame bytes and hashes, conditional membership,
malformed responses and zero command writes. Its reusable synthetic catalog and
PNG generator live in `apps/hub/tests/pixoo-catalog-fixture.mjs`.

`apps/dashboard/tests/pixoo-client.test.mjs` covers authenticated PNG scheduling;
`apps/dashboard/tests/pixoo-media.mjs` runs in `test:dashboard:browser`. It checks a 20-frame variable-delay animation,
full-color pixels, reduced motion, ordered/unnamed playlists, pagination, catalog
revision refresh, hidden-widget cancellation, accessibility and mobile overflow.
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

## Maintenance intake checks

For `apps/maintenance`, use Node 24 from the repository root. Run `npm ci`,
`npm run build`, `npm run typecheck`, `npm run test:maintenance:built`,
`npm run test:maintenance:package:built`,
`npm run test:observability:built`, `npm run test:contracts:built`,
`npm run test:contracts:python`, `npm run check:workflow` and
`npm run test:workflow`. All must exit zero. CI runs the intake tests in its
core job. This suite covers the owning tracker-closeout adapter, full
installation receipts, canonical Python recommendation tooling and all five
fixed repository closeout policies in the extracted package. It also checks
the shared error body on blocked intake responses against
`@jimmie-potts/event-contracts`' `errorBody` (Hub #921). Policy cases cover
wrong runtime/repository/revision/owner, tool plan digests and file/link readback,
protected paths, owning instruction fingerprints, unchanged client/physical
acceptance and tool repositories without portfolio writes. It also runs the
built runtime and reads its stderr lines as a synthetic journal (#903). The same
suite covers
the Hub supervisor installer wrapper;
its native deadline guard also requires the Standalone hub, Standalone hub MCP
and Shared monitoring setup checks above. Fixtures use synthetic journal data
and disposable private state; these checks do not establish installed scheduling, credentials, permissions or
physical behavior. See [the intake guide](../apps/maintenance/README.md) for its
trusted supervisor boundary and installed qualification.
