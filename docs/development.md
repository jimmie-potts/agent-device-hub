# Development setup

## System design documents

The HTML under `docs/system-design/` preserves the September 19, 2026 design
snapshot. Its implementation labels and issue states describe that baseline;
GitHub issues and owning application guides supply current status. The current
[SDLC UI policy](sdlc.md#ui-approval-scope) supersedes this snapshot’s obsolete
human UI approval wording. Routine product delivery does not rebaseline it. For an intentional snapshot revision,
edit `source/*.html` and `design.json`, then regenerate the overview, component
pages and complete reading view. `assets/` holds the shared style and browser
behavior. The inventory records the template set and source revision receipts.
The atlas pages and the guide take their colors from the token files in
`docs/skins/`; `python3 docs/skins/check_tokens.py`, which `check.py` also runs,
fails on a color literal in their styles (see the work guide README's "Skin and
tokens" section). The API and database reference under `reference/` keeps its
own stylesheet and bundled viewers and is outside that check.

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
controller files. The proposed B.U.N.N.Y. store still has no delivered table schema.

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
the Work guide CI job. Run the public exporter into a new disk-backed scratch
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
inventory, 390 px navigation and screenshots. The Work guide CI job runs it with
the pinned Chromium alongside the existing guide and atlas browser checks.

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

Guide record contract fixtures run with Node 24 after `npm ci`:
`node --test docs/work-guide/contracts/records.test.mjs`. The Workflow CI
job runs this check separately from OpenSpec validation. It exercises schema
versions, identity, incomplete/stale evidence, operation gates and the public
planning allowlist using synthetic records; it does not qualify the later
normalizer, renderer, protected endpoint or a live provider. Contract delivery
also runs shared build/type/controller/workflow checks and the guide's existing
build, maintenance and browser checks. See the
[field dictionary](work-guide/contracts/README.md).

Epic Guide contract fixtures run the same way:
`node --test docs/work-guide/contracts/epic-guide/contracts.test.mjs`, as a
separate step in the same Workflow job. They exercise `guide-records/2.0` placement,
Project values, the seven-day Recently done window, prerequisite acceptance, the
publication gate, order-aware identity, readiness and projection, the
`guide-release/1.0` binding, and
`guide-views/1.0` catalog and schema agreement, the shared issue card and epic
component, coverage, reasons, boards, briefs and rejection codes, using synthetic
records. They do not qualify the collector, browser, Project access or a
provider. See the [epic Guide dictionary](work-guide/contracts/epic-guide/README.md).

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
core and Workflow jobs' fifteen, the Work guide job's twenty-five and the App verification job's thirty. Branch pushes do not duplicate PR checks.
Hosted runners sometimes stall in apt, in `apt-get update` or in a browser
install's `--with-deps` downloads, until the job's limit. So every apt command in
CI runs through `scripts/apt-retry.sh` (#862): the browser installs in App
verification and Work guide, with 300 s per attempt, and the hook-qualification
step's `apt-get update` and `apt-get install`, together, with 180 s per attempt.
The script makes apt drop and retry a connection or download that receives
nothing for 30 s; a slow download that still receives data does not time out.
After a failed attempt, it stops the apt-get the attempt left running, waits up
to 60 s for apt and dpkg to exit, runs `dpkg --configure -a` and retries, three
attempts in all. The step limits (20 minutes for the browser installs, 14 for the
hook step) and the job limits leave room for two stalled attempts. Because it
changes apt's configuration and stops every `apt-get`, the script refuses to run
unless `GITHUB_ACTIONS` is `true`.
The workflow files have new names (`checks.yml`, `workflow.yml` and `guide.yml`)
because GitHub keeps the manually disabled state of the retired `ci.yml` and
`work-guide.yml` copies, whose earlier billing-blocked runs do not validate a
candidate. A branch that still has `.depot/workflows/` runs on Depot, so rebase
it onto current main before pushing.
The old nightly guide refresh was retired on 2026-09-30 at the owner's request.
Its GitHub Actions workflow is disabled and removed from source; the rolling PR
is closed without merge. Manual guide tooling and its regression tests remain
until the replacement Guide's consumer audit retires them. This does not change
the validation or merge gates. See the [guide procedure](work-guide/README.md#nightly-refresh).
The guide maintenance suite includes the history/report, retired-term, staged
input, validation and local-Git publisher tests. The publisher tests use a local
bare repository and recorded API responses; actual dispatch evidence is separate.


All three workflows use `paths-ignore: ['docs/work-guide/**']` for PRs and
main pushes. Guide-only edits, including generators and tests, retain local guide
validation under [the SDLC exception](sdlc.md#guide-only-ci-exception). The
Checks workflow also ignores `**/*.md`. A change whose files are all Markdown
runs only the Workflow and Work guide jobs, under the
[Markdown-only rule](sdlc.md#markdown-only-ci-routing). Mixed changes require
every configured job. Do not infer filtering from a missing
run alone. Inspect the complete changed-file scope and hosted event and
check records; keep the normal gate when scope or filter behavior is uncertain.
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
| Build, lint and core tests | Node 24 and Python 3.14 in one job: one build, then typecheck, [static analysis](#static-analysis), every kept Node `:built` suite and package consumer (the runtime and its scenario catalog, SDK, events, lifecycle, agent state, the Pixoo module with Vitest and node:test, the Nanoleaf port, the playback, LIFX and Tidbyt modules, MCP, Wispr, maintenance, observability and CHOMPI bridge), the 1.x controller contracts' Node tests, the old dashboard's unit tests, and the Python observability, event, lifecycle and agent-state consumers |
| Firmware | Host-compiled CHOMPI controller tests with sanitizers, then the ARM build with the pinned toolchain and the artifact check |
| Work guide | Python 3.12 generation/maintenance and Node 24 browser checks with review artifacts |
| App verification | Node 24 build, Chromium, the app-verify core's receipt and unsupervised capture tests and its isolated archive consumer, the CHOMPI bridge and runtime adapters' steps, the bridge control page's browser check, the old dashboard's smoke check and the observability contract's browser check; lifecycle tests skip with a printed reason when the runner has no systemd user manager |

The Checks workflow performs two full builds across its jobs. The Python
suites run on Python 3.14 only, the version of the installed Nanoleaf runtime.
Checks that call the runner's system
`/usr/bin/python3`, such as the Linux performance qualification and the
maintenance closeout fixtures, use Ubuntu 24.04's Python 3.12. Local validation runs the same commands. Later runtime and browser
changes must add their own issue-appropriate checks.

### Old system checks

The old system is the old Hub (`apps/hub`), its dashboard (`apps/dashboard`),
the old controllers and services, and the 1.x controller contracts. It keeps
running on the owner's machine until the cutover (#840), receives no further
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
dashboard into the runtime. The Python setup still installs
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

`npm run lint:js` runs ESLint with [`eslint.config.mjs`](../eslint.config.mjs).
Run `npm run build` first. Typed rules read the workspace packages' built
declaration files, so missing or stale `dist/` output changes the results. The
core CI job runs it right after the build and typecheck, and never fixes files.

Coverage is every tracked `.js`, `.mjs`, `.cjs`, `.ts` and `.tsx` file outside the
exclusions below.

- **All files** get ESLint's recommended rules.
- **TypeScript files** also get typescript-eslint's type-checked recommended
  rules, including `no-floating-promises` and `no-misused-promises`.
  - Each file uses its nearest `tsconfig.json`.
  - The config lists the few files that belong to no project; they use the
    default project.
  - JavaScript files get no type-aware rules.
- **Dashboard files** also get the React Hooks rules `rules-of-hooks` and
  `exhaustive-deps`.
- **Globals:**
  - Page code gets browser globals.
  - Node scripts that pass callbacks to Playwright get browser and Node globals.
  - ES modules get Node's built-in globals.
  - `.cjs` files also get the CommonJS globals.

The excluded categories are:

- everything the root `.gitignore` lists, including dependencies, build output,
  local data and agent worktrees, plus the firmware build trees;
- the Work guide's published releases (`docs/work-guide/outputs/`);
- vendored reference assets (`docs/system-design/reference/assets/` and
  `docs/system-design/reference/database/`);
- saved source copies from other repositories
  (`docs/work-guide/work/architecture/sources/`).

Add a category only with its reason. Do not exclude maintained source to hide
findings.

The config adjusts some rule options to match existing idioms rather than
defects:
- empty `catch` blocks are allowed for best-effort cleanup;
- a leading underscore marks a deliberately unused name;
- side-effect ternaries are allowed;
- a promise may be rejected with a caught error of unknown type;
- `prefer-const` ignores a handle that signal handlers read before its single
  assignment.

For a deliberate exception elsewhere, outside the strict profile, use
`// eslint-disable-next-line <rule> -- <reason>`. Unused disable directives fail.

### Adoption baseline

[`eslint-suppressions.json`](../eslint-suppressions.json) records how many
findings each file had for each rule when the gate was adopted.

ESLint fails when a file exceeds its recorded count for a rule. It also fails
when a linted file has fewer findings than recorded, until you run
`npx eslint . --prune-suppressions` and commit the smaller file. After deleting
or renaming a file, run the same prune, because entries for files ESLint no
longer lints are not reported.

Never use `--suppress-all` or `--suppress-rule` to pass new findings. Fix the
code instead. The one exception is existing code moved in from another
repository as a snapshot, as the Pixoo's was until its module story cleared it
(#843). Pass only the imported files to `--suppress-all`, and fix findings in
code written for the move.

| Baselined rules | Why they remain | Triage owner |
| --- | --- | --- |
| `no-unsafe-*`, `no-explicit-any`, `restrict-*`, `no-base-to-string`, `unbound-method`, `no-redundant-type-constituents` | Untyped parsed or external data passes through code that predates the rules. Typing it means a refactor in each module, not a mechanical fix. | [#770](https://github.com/jimmie-potts/agent-device-hub/issues/770). Code that the B.U.N.N.Y. runtime replaces drops its entries when retired. |
| `require-await`, `preserve-caught-error` | Fixes change a function's return type or an error's shape. Each needs review in its module. | #770 |
| Every rule in `apps/chompi-bridge/` | The owner's CHOMPI work is active there, so adoption did not edit it. | The CHOMPI bridge owner, then [#837](https://github.com/jimmie-potts/agent-device-hub/issues/837) |

### Strict profile for new code

New code for the runtime follows a stricter profile from its first commit
([#867](https://github.com/jimmie-potts/agent-device-hub/issues/867)). It covers
`apps/runtime/`, `packages/sdk/`, `modules/` and the 2.0 contract sources in
`packages/event-contracts/src/v2/`, and starts with no baseline entries. Staged
imported code keeps the shared rules until its module story converts it; none
is staged now, since the Pixoo module joined the profile
([#843](https://github.com/jimmie-potts/agent-device-hub/issues/843)). To cover another path, add its glob to `strict` in
`eslint.config.mjs`; the guard tests read that list.

- **Lint (`bunny/strict`):**
  - switches over a union must handle every member, and a catch-all `default`
    does not count;
  - conditions must be explicit: strings, numbers and nullable primitives are
    compared, never tested for truthiness, so `undefined` is never confused
    with zero, `false` or an empty string. A nullable object may still be
    tested directly;
  - no non-null assertions.
- **No inline ESLint comments:** covered files, including JavaScript under
  `modules/`, set `noInlineConfig`. ESLint ignores every `eslint-disable`,
  `eslint` or `global` comment there and reports it as a warning, which
  `lint:js` fails. An exception is a config entry after the profile blocks in
  `eslint.config.mjs`, scoped to its files, with a comment giving the reason.
- **Module boundary (`bunny/module-boundary`):** a file under `modules/<name>/`
  imports only its own files, `@jimmie-potts/sdk`, `@jimmie-potts/event-contracts`,
  Node built-ins and third-party packages. Workspace packages are those in
  `workspaceScopes` (`@jimmie-potts/`); every workspace package must use one of
  them. It checks static, re-export, type and
  literal dynamic imports, including `file:` URLs, and rejects non-literal
  dynamic imports. Paths resolve from the repository root, so the rule works
  from any directory. `createRequire` and `.cjs` files are not checked.
- **Safe errors:** production code keeps off the console and keeps exception
  text and hand-built error bodies out of what it builds. See
  [Safe-error rules](#safe-error-rules).
- **Compiler:** new packages extend `tsconfig.strict.json`, which adds
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`, `noImplicitReturns` and `noFallthroughCasesInSwitch`
  to the shared settings.

The local rules live in `scripts/eslint/bunny-rules.mjs`.
`tests/strict_profile.test.mjs`, run by `npm run test:workflow`, checks:
- which paths the profile covers, the exact rule options and that inline
  comments fail lint there;
- the module boundary rule, including type imports;
- each safe-error rule's valid and invalid shapes and where the rules apply;
  that only a named exception listed in the table below lifts one, and only
  the profile block sets its options; and that each file exception names files
  that exist and still hides a finding of every rule it lifts;
- that every TypeScript project compiling covered code keeps the five compiler
  settings, as `tsc --showConfig` reports them;
- that covered paths have no lint baseline entries;
- that every workspace package uses a scope listed in `workspaceScopes`;
- that the compiler base rejects an unchecked index and an explicit `undefined`
  optional property.

Guide-only revisions skip the core job under the
[SDLC exception](sdlc.md#guide-only-ci-exception). Run
`npx eslint docs/work-guide` for them. It needs no build, because the guide has
no linted TypeScript.

### Safe-error rules

Three rules apply ADR 0012's
[Safe errors](decisions/0012-bunny-event-platform.md#errors-effects-and-outcomes)
and [Observability](decisions/0012-bunny-event-platform.md#observability) rules
to production code under the profile
([#953](https://github.com/jimmie-potts/agent-device-hub/issues/953)): the
`strict` globs and JavaScript under `modules/`, without staged code or tests.
Each message names the ADR rule and the safe alternative. The rules read syntax
only, so they also check JavaScript. They catch the mechanical cases; the SDK's
and the runtime's tests cover the rest.

- **`bunny/no-console`:** no global `console`, `node:console`, `process.stdout`
  or `process.stderr`, also through `node:process`. Record through the
  module's logger; the SDK reports through `onDiagnostic`, which the runtime
  connects to its sink.
  - Reading `process.stdout.isTTY` also counts, so a command-line check belongs
    in a listed entry point.
  - It misses:
    - `process.emitWarning`, which the SDK's default `onError` uses with fixed
      text;
    - writes to file descriptors 1 and 2;
    - an alias of `process`, `globalThis.process.stdout`, and `stdout` or
      `stderr` destructured from `process` or from the default `node:process`
      import (`const {stdout} = process`);
    - `await import('node:console')`.
- **`bunny/no-raw-error-text`:** no reading an exception's `message`, `stack`
  or `cause`, directly or by destructuring, and no turning it into text with a
  template literal, `String()`, `+`, `+=`, `JSON.stringify`, `toString()` or
  `node:util`'s `inspect` or `format`. Keep the exception as a `cause`, and
  report its registry code, its type (the SDK's `errorType`) and fixed text.
  - An exception is a catch binding; the first parameter of an inline `.catch`
    handler, a `.then` rejection handler, or an `error`, `uncaughtException` or
    `unhandledRejection` listener; a parameter whose type names an error class
    (a name ending in `Error` or `Exception`); or a variable or a simple member
    chain, such as `r.reason`, `event.error` or `this.#failure`, inside an
    `instanceof` test against an error class.
  - A value narrowed by `instanceof Error` counts wherever it came from, so
    `error instanceof Error ? error.message : 'unknown'` fails in a helper or a
    callback too. The cost is that a message check such as
    `error.message.includes('ECONNRESET')` fails; test `error.code` or the
    class instead.
  - An error class this repository declares holds fixed text from the code that
    raised it: one declared in the file, or imported by a relative path or from
    a `workspaceScopes` package. Its message and text may be read where an
    `instanceof` test, an early exit or the parameter's type proves the value
    is one. Its `stack` and `cause` may not, nor may `inspect` or `format`,
    which print the stack. The rule checks where foreign text is wrapped in an
    own class instead, so an own class built from text the rule does not track
    passes. It cannot tell an own class whose message carries input: Nanoleaf's
    `ValueError` quotes the text it could not parse in `compat.ts` and the
    address it refused in `transport.ts`.
  - It misses:
    - an alias (`const failure = error`), a helper the exception is passed to, a
      custom type guard, an untyped callback parameter outside these shapes, and
      a value typed `any`;
    - a computed member or a call inside an `instanceof` test, such as
      `r[key] instanceof Error`;
    - a tagged template, such as ``String.raw`${error}` ``;
    - `[label, error].join()` and `'failed: '.concat(error)`;
    - a narrowed catch binding that is later reassigned: the earlier
      `instanceof` test still counts.
- **`bunny/error-body-from-registry`:** no object literal with an `error`
  property whose value is an object literal with its own `code`, as in
  `{error: {code, ...}}`. This includes the error block inside a reply or an
  outcome. Build the body with `errorBody(code, {detail})` from
  `@jimmie-potts/event-contracts`, so its code and `retryable` flag come from the
  registry. Passing on a body or its `error` member, or spreading it, as in
  `{error: {...refused.error, requestId}}`, is allowed; overriding its `code` is
  not. It misses an error block built in a separate variable and a body written
  as JSON text.

Exceptions are config blocks named `bunny/safe-errors/<reason>` after the
profile blocks, never inline comments, and each is listed here.
`tests/strict_profile.test.mjs` fails on a block that lifts a rule without that
name or this listing, and on a file exception that no longer hides a finding.

| Block | Where | Rules lifted | Why | Owner and conversion |
| --- | --- | --- | --- | --- |
| `ignores` in `bunny/safe-errors` | Tests: `**/tests/**` and `*.test.*` | All three | Tests read errors to report failures and spell out the bodies they expect. | Permanent |
| `bunny/safe-errors/scripts` | `apps/runtime/scripts/` | `no-console` | Scripts write their results to the terminal. | Permanent |
| `bunny/safe-errors/stream-owners` | `streamOwners` in `eslint.config.mjs` | `no-console` | The runtime's journal sink (`log.ts`) and process entry (`process.ts`), and the verification run's supervisor and network guard, own the process's standard streams. | Permanent. A new entry point is added by name. |
| `bunny/safe-errors/contracts` | `packages/event-contracts/` | `error-body-from-registry` | It defines `errorBody`. | Permanent |
| `bunny/safe-errors/runtime-usage` | `apps/runtime/src/process.ts` | `no-raw-error-text` | A malformed command line's usage error quotes `parseArgs`'s message. | [#954](https://github.com/jimmie-potts/agent-device-hub/issues/954), at its pickup |
| `bunny/safe-errors/verification-harness` | `apps/runtime/verify/supervisor.ts` | `no-raw-error-text`, `error-body-from-registry` | The verification harness quotes a failure's message in its own refusal body, its lamp failures and its start-failure lines. | #954, at its pickup |

The table understates what the verification harness quotes.
`apps/runtime/verify/adapter.ts` also turns exceptions into text, through
`describe` in `apps/runtime/tests/scenarios/parts.ts`, which is exempt as test
code.

<a id="depot-diagnostic-access"></a>

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
nothing. The retired `ci.yml` and `work-guide.yml` still appear, disabled, with
the same workflow names as `checks.yml` and `guide.yml`, so select workflows by
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
| Guide-only exception | Every changed path, including rename sources, under `docs/work-guide/`; no run from the revision's CI provider; a `--guide-receipt` (the guide check's `guide-verification.json`) matching the committed guide HTML, with its screenshots and print check beside it; a `--guide-record` for that revision (see below). A merged guide-only PR needs a record for its head and one for its merge commit | [Guide-only CI exception](sdlc.md#guide-only-ci-exception) |
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

A guide-only record is a comment or review on the PR written by
the delivery account: the PR author, or the repository owner when a bot opened
the PR. Bot comments, other accounts' comments and comments with an HTML marker,
such as review reports and provider summaries, never count.

A guide-only record names the full revision and the guide HTML SHA-256, and
reports each of the four local checks in exactly this form: the command
(without a colon), a colon, and `exit 0` or `passed` as the entire value.

```text
- python3 docs/work-guide/work/build_guide.py: exit 0
- python3 docs/work-guide/work/test_maintenance.py: exit 0
- node docs/skins/check_places.cjs: exit 0
- git diff --exit-code -- docs/work-guide/outputs: exit 0
```

Every line that names one of these checks must have that form. Any other
wording, such as `2 failures, 40 passed`, `did not pass` or
`exit 1; rerun: exit 0`, leaves the check unverified and the exception
unresolved.

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
missing work issue, both finish-line kinds, the guide-only exception with its
evidence and with mixed paths, and dirty or failed-capture receipts. It also
covers the read-only guard and a run under Node's permission model, which
denies file writes and child processes. CI runs it in the Workflow checks job.
Fixtures do not qualify live GitHub state or installed clients.

## Execution recommendation generator

When changing `docs/work-guide/work/recommendations.py`, run the focused prompt
and parser regression suite from the assigned worktree root:

```bash
python3 docs/work-guide/work/test_maintenance.py Recommendations
python3 docs/work-guide/work/test_maintenance.py
```

Retain a failing-before/passing-after result for changed prompt behavior. Check
recommended and cheaper starts for Claude Code and Codex across all four session
types, including render/read round trips and unchanged-upsert behavior.
Investigate-first prompts must remain read-only. Model and level declarations
cover only settings named for each role; current runtime observations remain
separate, and missing observations must not become a mismatch. Observed required
mismatches and unmet explicit verified-identity requirements still stop work.

Also run the Node 24 workflow setup and checks above and report the actual
OpenSpec inventory. Generator-only source maintenance does not refresh issue
bodies, regenerate the dated guide or publish an edition. Intentional guide
updates still follow the guide procedure; CI filtering and evidence requirements
remain those in the SDLC.

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
CI. The installed Nanoleaf worker is Python until the cutover; its domain logic is
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

Use Node 24 and run `npm run build`, `npm run typecheck`, `npm run lint:js` and
`npm run test:sdk` from the worktree root. `test:sdk` builds, then runs
`test:sdk:built`: the compiled tests in `packages/sdk/dist/tests/`. The core CI
job runs `npm run test:sdk:built` after its fresh build. The tests check every
message they see against profile 2.0 with the event contracts' validator, and a
test fails if one is invalid; the bus itself does not validate. One conformance
suite runs against both transports. The remote tests start an edge on
127.0.0.1 at a free port with run-generated tokens, and the outbox and kit tests
keep SQLite files under the system temporary directory. They need no runtime,
device or other network.

## Runtime checks

`apps/runtime` is the runtime skeleton and module host from
[ADR 0012](decisions/0012-bunny-event-platform.md); its
[README](../apps/runtime/README.md) covers running it, health, state, failure
isolation and the event-loop lag check. It follows the
[strict profile](#strict-profile-for-new-code), tests included.

Use Node 24 and run `npm run build`, `npm run typecheck`, `npm run lint:js` and
`npm run test:runtime` from the worktree root. `test:runtime` builds, then runs
`test:runtime:built`: the compiled tests in `apps/runtime/dist/tests/`. The core
CI job runs `npm run test:runtime:built` after its fresh build. The tests use
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
runtime's records must pass the diagnostic contract's validator (#903), as
maintenance intake reads them, and `runtime.stopped` must count no lost record or
span. The decision-record and tracing tests read the runtime's records and the
spans its host adapter hands a test sink (#949). They need no device or network.
`node apps/runtime/scripts/measure-memory.mjs` measures the
zero-module memory for #123, and `measure-edge-memory.mjs` the edge under a
stalled reader; the README's Memory section says how.
`node apps/runtime/scripts/measure-commits.mjs` measures the SQLite commits,
blocked time and event-loop delay of the core's intake, a LIFX command and the
outbox (#972, #123); the README's Commits section says how.

### Runtime test layers

Every runtime story is tested at four layers
([epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827)).
The core CI job runs the first three after its fresh build, on every PR that
runs the Checks workflow; Markdown-only changes skip them. The App verification
job judges the fourth layer's capture steps without a user manager.

| Layer | Command | What it runs |
| --- | --- | --- |
| Unit | Each package's own: `npm run test:sdk:built`, `npm run test:runtime:built`, `npm run test:nanoleaf:built`, `npm run test:pixoo:built`, `npm run test:playback:built`, `npm run test:lifx-module:built`, `npm run test:tidbyt-module:built` | The package's and its modules' own tests, moved tests included |
| Contract and conformance | `npm run test:events:built` | The profile 2.0 and core family fixtures. The SDK's transport conformance suite runs within `test:sdk:built`, and each module runs the module test kit within its own suite, as the fixture modules do in `test:runtime:built` |
| End-to-end | `npm run test:runtime:scenarios:built` | The runtime's scenario catalog in the in-memory harness, over both transports (tier 1) |
| Acceptance | `npm run -s verify:runtime -- <operation>`, with `npm run test:runtime:verify:built` in CI | The same catalog in disposable runs, for the Acceptance reviewer (tier 2) |

`npm run test:runtime:scenarios` builds, then runs
`test:runtime:scenarios:built`: the compiled tests in
`apps/runtime/dist/tests/scenarios/`. To run some scenarios only, name them
after a build, for example
`node --test --test-name-pattern=end-to-end apps/runtime/dist/tests/scenarios/*.test.js`.
Each catalog scenario runs twice in the runtime's module host, on a manual
clock: once with its parts on the host's bus, and once through a `RemoteEdge`
on 127.0.0.1 with run-generated tokens. The harness never listens on an
installed service's port (8765, 8787, 8788, 8791 or 41231), keeps its state in
a private directory under the system temporary directory, which must be
outside every Git checkout, and checks every message against profile 2.0. It
needs no device. The [runtime README](../apps/runtime/README.md#scenario-catalog)
describes the catalog and how a story adds to it.

### Runtime verification runs

Hub #920 adds the runtime adapter for the
[app verification contract](app-verification.md),
`npm run -s verify:runtime -- <operation>`. A run serves the runtime from the
checkout with `--simulate`, `--edge`, `--config` and `--environment test`,
either with the shipped module list or with the fixture modules, over simulated
devices, on loopback. The
[adapter README](../apps/runtime/verify/README.md) lists its run scenarios,
capture steps and boundary checks. After `npm run build`, with Node 24 from the
worktree root:

```bash
npm run test:runtime:verify:built   # capture steps, boundary checks, the supervisor, and real runs where a user manager exists
npm run -s verify:runtime -- help
```

`test:runtime:verify:built` starts runs without a user manager and judges every
capture step through `runCaptureStep`: one per catalog scenario, so the same
scenarios pass in the in-memory harness and in a run. It also starts each
boundary negative control and shows its check fails, shows the network guard
refuses `net`, `http`, `https`, `fetch` and `dgram` in a worker thread and a
child Node process too, and checks that `build-current` watches every source
the run loads. It also judges the follow query of Hub #950, which reads one request's or trace's journal
records and spans in a run (see [Follow one request](../apps/runtime/verify/README.md#follow-one-request)),
and the runtime tests (`test:runtime:built`) cover the bounded, private span file that the
run's runtime writes. The host route takes the runtime as `--app runtime`. Its lifecycle tests drive
real transient units and skip with a printed reason without a user manager; the
App verification CI job runs the rest. It needs Playwright Chromium and an
outside-checkout `TMPDIR`, as the app verification tests do.

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

Hub #5 targets Node 24 on Linux in WSL. Run `npm ci`, `npm run build`,
`npm run typecheck`, `npm run test:hub` and `npm run test:hub:package` from the worktree root, alongside
the shared controller/lifecycle/state/MCP and workflow suites. Both are
[old system checks](#old-system-checks) that run locally, not in CI. Tests use disposable private Linux state, synthetic credentials and
fake loopback controllers. They do not start installed services or operate
devices. The source includes supervised child release, fenced import, route readiness,
interrupted coordinator recovery and rollback tests. Full integrated performance
qualification remains #30; source checks do not install or activate personal hooks.
The hub and setup suites refuse a `TMPDIR` inside any Git checkout and fail
with `store-in-checkout`, so a task-scoped `.local/scratch` folder does not
work for them. Set `TMPDIR` to a folder under `~/.cache/agent-device-hub/` with a
short name, such as `~/.cache/agent-device-hub/gh916t`, before `npm run test:hub`
or `npm run test:setup`. Keep the `TMPDIR` path at most 48 bytes: a Hub test
binds a Unix socket 59 bytes below it, and a socket path stops at 107 bytes, so
a longer one fails with `listen EINVAL`.

Running build identity is covered by `apps/hub/tests/build.test.mjs` in the
Hub and extracted-package suites: metadata failures (including linked manifests), read authorization,
unhealthy status, manifest replacement and a real process restart across a
current-link switch. `test:hub:package` also runs
`scripts/hub-build-identity.test.mjs` against disposable Git repositories to
verify clean, dirty, missing and equal-version/different-commit provenance.
The extracted manifest must carry the package command's captured source identity.
The running packaged Hub must report that identity in health and dashboard context.
Complete dependency inventories and the 8 MiB manifest boundary are covered;
oversized or invalid metadata still reports unknown.

Hub upgrade command checks use `apps/hub/tests/install-*.test.mjs` through
`npm run test:hub` and `npm run test:hub:package`, which run locally, not in CI.
Use the private test TMPDIR
above. Fixtures cover approval drift, package/dependency inventories, compatible
latest-state recovery, both shared-layout adoption orders, interruption,
receipt finalization and owned retention. They use synthetic state and fake
service control; installed upgrade acceptance follows the exact-plan checkpoint
under [applicable authority](sdlc.md#installation-and-evidence), including standing
authorization without a renewed human approval.
`install-service-contract.test.mjs` covers systemd omitting an empty
`EnvironmentFiles` property, binds a configured list and still rejects a missing
freeze capability. Its fake `systemctl` runs in an isolated child process.
`install-plan.test.mjs` also covers large protected Codex executables: streaming
fingerprints detect changed bytes, enforce a 256 MiB protected-file limit and
retain the 64 MiB default limit for release inventories.

Controller contract 1.1 reads for #576 are covered by
`apps/hub/tests/controller-versions.test.mjs` and the `status` case at the end of
`apps/hub/tests/mcp.test.mjs`, which `test:hub:built`, `test:hub:mcp:built` and the
packaged hub tests already include. They run over
loopback HTTP against the shared fake controller in
`apps/hub/tests/fake-controller.mjs` (`startFakeController({serves})`, with `'1.1'`,
`'1.0'`, `'1.0-negotiating'` and `'1.0-unknown-route'` (Nanoleaf's 404 refusal), epoch restarts, injected timeouts and 5xx answers,
and a log of every request and command). Import it from a test instead of writing
another ad hoc server; it is not a `*.test.mjs` suite. The cases cover negotiation
and the `1.0-only` verdict per controller epoch, unchanged 1.0 readers, the strict
`apiVersion` parameter on the snapshot route, MCP `status` and zero command POSTs.
No registered controller serves 1.1 yet, so these checks are fake-controller
evidence only; installed and controller-adoption acceptance stay with
codex-nanoleaf#158 and divoom-app-upgrade#92.

The moment sender for #335 is covered by `apps/hub/tests/moment-sender.test.mjs`,
the slot-wait cases in `apps/hub/tests/controllers.test.mjs` and the moment command
cases in `apps/hub/tests/controller-versions.test.mjs`, which the same hub suites
already include. The shared fake now admits commands
through the contract's reference `admit`, and its `answerNext`, `hold` and
`moments()` script a device's answer, stall a request and list the moment POSTs.
The cases inject the hub-monotonic clock and cover the bounded slot wait, the
request built from the snapshot, the not-sent reasons with no POST, ambiguous
answers with exactly one POST, independent devices and no command after a hub
restart. They are fake-controller evidence; a live moment needs a controller that
serves 1.1 and a caller such as #336 or #358.

The owner moment route for #336, `POST /api/controllers/v1/:id/moment`, is covered
by `apps/hub/tests/moment-route.test.mjs`, which `test:hub:built` and the packaged
hub tests already include. It runs against the shared
fake and covers:

- `forbidden` for `read` scope, another device grant and a missing mutation header;
- 400 `invalid-request` for a palette, an extra field, a bad mood ID or an
  out-of-range duration, with no controller request;
- `not-sent` with no command for an undeclared mood, a duration above the device
  limit, a 1.0-only controller and a controller without moments;
- exactly one POST with a fresh `momentId`, `event` and no palette for a valid press;
- failed receipts, a lost answer and a typed refusal passed through as typed;
- a controller that stalls past the route's 2.5 s bound, answered `uncertain`
  inside the 3 s cap with one request;
- a press that waits for the device slot and still sends once.

Playback for #175 and #233 is covered by `apps/hub/tests/playback.test.mjs`, which
`test:hub`, `test:hub:built` and the packaged hub tests already include through
the `apps/hub/tests/*.test.mjs` pattern. It runs the
shared playback module against fake sources with no speaker code, the Sony
module against a fake loopback receiver and the Sonos module against a fake
loopback AVTransport service. Freshness checks use a controlled clock. The #233
cases cover two sources under one playback ID: independent freshness, the
preference rule (Move alone, grouped, Sony alone, a Move that goes silent
mid-song staying stale and then yielding to the Sony), a command checked after
the presented source changed, and the rejected `selected` configuration form.
Route checks cover authentication, the configured target, unsupported controls,
duplicate and concurrent commands, failed/uncertain results and a hub with both
sources. The dashboard browser fixture and `mcp.test.mjs` use the same
configuration shape. These tests do not contact a speaker or phone. Installed
playback acceptance with a real iPhone, HT-A9 and Move needs separately
authorized speaker addresses and is recorded on the issue.

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

## CHOMPI controller checks

Hub #741 adds the [CHOMPI HID protocol](../packages/chompi-protocol/README.md),
the [controller firmware](../firmware/chompi-controller/README.md) and the
[bridge transport core](../apps/chompi-bridge/README.md). Both sides test
against `packages/chompi-protocol/fixtures/v1.json`.

Firmware, from the repository root:

```bash
npm run test:firmware
npm run test:firmware:arm
```

`test:firmware` builds and runs the pure C++ host tests with a C++17 compiler,
AddressSanitizer and UndefinedBehaviorSanitizer: protocol vectors, debounce,
encoder turn and click separation, the bounded queue, session `hello`, host
timeout, two-part light frames, LED chain encoding and USB restart timing and
back-off. `test:firmware:arm` downloads GNU Arm Embedded Toolchain
10.3-2021.10 once into the user cache and verifies its SHA-256 (or uses
`ARM_GCC_BIN`), fetches the pinned upstream sources into the ignored
`firmware/chompi-controller/.upstream/`, builds `04_AGENT.bin` and runs the
artifact check: memory regions, `boot_info` at `0x38800000`, the controller USB
identity and the absence of MIDI, CDC and SD code. The Firmware CI job runs
both. Neither flashes or opens a device; installation and physical behavior
belong to #743.

Bridge, with Node 24 from the assigned worktree root:

```bash
npm ci
npm run build
npm run typecheck
npm run test:chompi-bridge
```

The suite runs every protocol vector and tests the connection manager against
a fake transport and a manual clock: hello gating, epoch and sequence rules,
synthetic releases on disconnect, stale handling, light frame split and resend,
and bounded subscriptions. It also covers a simulator roundtrip, the
single-instance lock across processes, the node-hid adapter against a stand-in
module, and the CLI. No test loads node-hid or touches USB. The contracts CI job
runs `npm run test:chompi-bridge:built` after the shared build.

Run `npm run test:chompi-bridge:native:built` separately under native Windows
Node 24 after a build, using an isolated runtime rather than changing the
global Windows Node. It fails on other platforms. Before running it, have Codex
show one ordinary task with the sidebar expanded and the selected row visible:
Codex exposes only on-screen rows, so the selected-thread probe otherwise fails
with `selected-row-count` or `document-count`. On a `\\wsl.localhost`
checkout installed from Linux, run `npm ci` on Windows first so the
`@koromix/koffi-win32-x64` prebuild sits beside koffi. The check enumerates
HID devices read-only, checks that the matcher rejects the stock CHOMPI ID,
checks that the named-pipe lock refuses a second holder and is released on
exit and on kill, and runs the Windows OS adapter's read-only observations:
the koffi FFI load, the foreground window identity, a ping to the UI
Automation helper, the composer, Codex selected-thread, approval-card and
card-button observations, the read-only model and effort picker reads (#906) with the UI Automation patterns each
client's controls expose, the read-only shape of Claude's next-step band and composer (#907: counts, focus, the
level where the band was found and emptiness, never text), and the installed client versions. Its Win32 surface replaces `SendInput` and `ShellExecute`
with throwing guards, so it types nothing and opens no link. It checks the volume, client-tap and chord key tables and
that malformed volume requests and client taps are refused before any attempt, without sending a key. It
reads card buttons only; it never focuses or presses one, calls no model or effort setting action, and focuses or
invokes no next-step suggestion.
It then reruns the portable suites except the codec fixtures, which need the
protocol workspace link. It opens no device. Linux CI does not qualify
Windows HID, named pipes, FFI or UI Automation.

### CHOMPI task routing checks

Hub #742 adds the routing core under `apps/chompi-bridge/src/routing/`. The
same `npm run test:chompi-bridge` runs its `routing-*.test.mjs` suites with
a scripted fake OS adapter, a fake Hub `fetch`, `ManualClock` and the device
simulator: profile validation and reload, the read-only feed client (GET-only,
refetch on change, timeouts, size limits, stale handling, the 1.2 fallback and
token-file privacy), slot assignment, release and persistence across task pages (#822: the version 1 to 2
file migration, interrupted writes, corrupt files and rollback), knob-4 paging, state lights and the page LED,
each row of the no-misrouting matrix, press-time Send gating, Record, big-wheel scrolling and card
answers (#821: detents, click stillness, wheel-chosen presses, refusal flashes and unknown card states), the
Attention click on knob 4 and volume knob (#865: first-seen order across pages, repeat cycling, refusal, volume detents, mute and
Record), the model and effort knobs (#906, `routing-knobs.test.mjs`: per-detent UI Automation steps, selection only
of a confirmed focused option, readback outcomes, range ends, unsupported effort, Codex chords first and the Power
fallback, a single Codex Escape even with every read lagging, no stray key, refusals and closing before other
controls), the next-step knob (#907, the same suite: per-detent suggestion focus stopping at the ends, a still click
invoking only the confirmed highlighted suggestion into an empty composer, one Right arrow for the ghost text into a
focused empty composer, no suggestion text in logs, refusals, lagging reads and closing to the composer), loss handling,
exit and uncaught-error key release, adapter warm-up, profile-version reload and an end-to-end
`run --profile` session. The fake adapter models the
qualified app behavior; the tests do not open links, type keys, read Codex or
Claude data or contact a Hub. `windows-adapter.test.mjs` checks how the
Windows adapter reads the helper's approval-card counts and card-button
replies for each client, and `windows-uia-helper.test.mjs` checks the helper
operations' scope statically, including that only the two card operations and
the eight setting actions change UI state, each with one kind of change after a
fresh read, and that the picker read is read-only and returns only the qualified
controls' model and effort labels. Live focus, dictation placement, card answers, model
and effort menus and lights on the device belong to the installed trials (#743,
#821, and #745 for #906).

### CHOMPI bridge verification runs

Hub #853 adds a simulated desktop (`src/sim/desktop.ts`, selected only by
`run --desktop sim`), a synthetic Hub feed (`src/sim/hub.ts`) and a shared
scenario catalog (`src/sim/scenarios.ts`). After `npm run build`, with Node 24
from the worktree root:

```bash
npm run test:chompi-bridge:built          # adapter contract, synthetic feed, flag gating, runner tests
npm run -s test:chompi-bridge:scenarios   # Tier 1: every catalog scenario in memory
npm run test:chompi-bridge:verify:built   # boundary checks and every capture step
npm run test:chompi-bridge:browser        # control page browser and accessibility check
```

Tier 1 runs each scenario against the real CLI (`run --simulate --desktop sim`)
on a manual clock, with the synthetic feed in memory. It takes about a second,
opens no port and touches no device or desktop. Name scenarios to run only
those, or pass `--list` or `--json`. The contracts CI job runs it after
`test:chompi-bridge:built`.

`test:chompi-bridge:verify:built` starts runs without a user manager. It starts
the three negative-control runs and shows that each boundary check fails, and
judges every capture step through `runCaptureStep`. `test:chompi-bridge:browser`
drives the control page with the keyboard and runs axe (WCAG 2.1 A and AA) at
1440 px and phone width. Both need Playwright Chromium. The App verification
CI job runs them. Use an outside-checkout `TMPDIR` locally, as for
the app verification tests.

A disposable run (Tier 2) uses the app verification lifecycle:
`npm run -s verify:chompi -- start`, `capture <run-id> <step>`, `stop <run-id>`.
The run serves the bridge, the control page and the synthetic feed on one
loopback port. The [adapter README](../apps/chompi-bridge/verify/README.md)
lists its steps and boundaries. Runs prove routing behavior only; Windows client
fidelity stays with the native check and the owner's installed checks.

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

Hub #471 adds `apps/dashboard/tests/wispr.test.mjs` to the unit glob and
`apps/dashboard/tests/wispr.mjs` to the existing browser matrix.
After `npm run build`, run `node apps/dashboard/tests/wispr.mjs` for the focused
real synthetic SQLite collector → aggregate files → authenticated Hub → browser
check. Use the outside-checkout `TMPDIR` documented under Standalone hub checks;
this fixture uses the real private Hub store. `DASHBOARD_RECEIPTS` retains synthetic
screenshots. The check covers hand-calculated totals, stages, separate edit pairs,
numeric downloads, independent home/page filters, permission retirement and
responsive accessibility. Unit tests cover preset coverage, missing values and
in-flight snapshot/opt-out guards. No personal database or installed service is used.

Hub #6 uses Node 24 and React/TypeScript. Run `npm ci`, `npm run build`,
`npm run build:dashboard`, `npm run typecheck:dashboard`, `npm run test:dashboard`
and `npm run test:dashboard:browser`. Browser checks use Playwright Chromium,
synthetic state and fake controllers. No check installs a personal service,
opens live state or contacts hardware. A change to
`apps/dashboard/tests/fixture.mjs`, to a fake it serves, or to UI that a
[Hub verification](../apps/hub/verify/README.md) step drives also runs
`npm run test:hub:verify`.

Since #827, CI runs only the unit tests (`npm run test:dashboard`, in the core
job) and a smoke check (`npm run test:dashboard:smoke`, in the App verification
job). The full browser suite took 500 s in CI, so it runs
locally: run `npm run test:dashboard:browser` when a change touches
`apps/dashboard`, its fixture or fakes, or the Hub code they drive, and when
#922 copies the dashboard into the runtime.

`apps/dashboard/tests/smoke.mjs` opens one trusted-loopback page on the
fixture's Hub and checks that:

- the Hub serves the built dashboard, which opens signed in without a login form;
- the home renders the fixture's session and its `wall` and `pixel` widgets
  without sending a device command;
- axe finds no WCAG 2.1 A or AA violation on the home at 1,280 px;
- choosing Quiet in the `wall` widget's mode select sends exactly one guarded
  `mode.set` command with the snapshot's request ID, configuration revision and
  generation.

It takes about 2 s locally. When #922 copies the dashboard, give the
copy the same pattern: a short smoke check in CI and its full browser suite as a
local check.

The browser matrix's `running Hub build` cases check Connections with synthetic
known metadata and an older context without a build field. They cover read-only
inspection, full revision copying and clipboard failure, unknown fallback,
desktop/mobile accessibility and zero device commands. Set `DASHBOARD_SCENARIO`
to `running Hub build` to run these cases alone; set `DASHBOARD_RECEIPTS` to an
evidence directory to retain their screenshots. Actual process identity is
verified separately by the Hub tests described above.

Hub #179 extends `npm run test:hub`, `npm run test:dashboard:browser` and
`npm run test:hub:package` with disposable owner-launch and browser-session
checks. Cover single-use and expired codes, rejected cross-origin exchanges,
read/control alias bounds without ingest/admin/MCP access, disconnect, reload
and inspection without device writes. They run on Node 24 and do not use the
installed Hub.

Hub #276 adds `apps/hub/tests/trusted-loopback.test.mjs` to `npm run test:hub`
and `apps/dashboard/tests/trusted.mjs` to `npm run test:dashboard:browser`.
They cover the session route off by default, invalid `browserAccess` values,
refused Host, Origin, fetch-metadata, header and body cases, the `localhost`
alias, launcher-equivalent grants without ingest/admin/MCP, the shared session
limit and retirement, and in Chromium sign-in on load, reload, second tab,
`pagehide` logout, eviction recovery, Disconnect, a failed request and the
unchanged page without the option. They do not use the installed Hub.

Hub #561 adds `apps/hub/tests/linked-navigation.test.mjs` to `npm run test:hub`
and the packaged hub tests, and a linked-navigation block to
`apps/dashboard/tests/trusted.mjs`. The hub test covers the page route's
fetch-metadata cases. A same-site top-level document navigation loads `/` on
either loopback name. Every page response refuses framing and sends
`Cross-Origin-Opener-Policy: same-origin`. Cross-site, framed, fetched,
Origin-carrying and foreign-Host requests are refused. The assets, the API
routes, the session route and the launch exchange refuse same-site requests.
In Chromium, another loopback app's link opens the dashboard signed in in a new
tab, while a link from another host name and an iframe are refused. A negative
control has a page on another loopback port re-navigate a window it opened to
the Hub every 10 to 30 ms. The owner's session must survive and the Hub must
hold at most two sessions; without the opener policy the owner is evicted
within about two seconds.

Hub #244 adds `apps/hub/tests/browser-sessions.test.mjs` and
`apps/hub/tests/replay.test.mjs` to `npm run test:hub` and the packaged hub
tests. They repeat launch, monitor read, command and logout, then cover expiry
and oldest-session eviction. Session, ledger, stream and replay counts must
return to the configured-credential bound. A configured credential's logout
keeps its tickets and streams. A monitor, controller or integration write whose
body arrives after logout is refused before any controller call, as is a late
write from a configured credential rotated in the meantime.
Deferred fake operations cover a pending command that resolves, rejects or
outlives its caller after retirement.

Hub #151 extends the matrix with general-control scenarios: one guarded command
per control in Media, Monitor gating with the explicit Media switch and a pending
mode, concurrent edits with typed conflicts and locked uncertain actions, and
read-only or undeclared capabilities with named reasons. The hub dashboard test
checks that general commands are schema-validated and scoped before any
controller request. The fake Pixoo declares the capabilities of Pixoo `main`
`c81bc31`, with controller v1 modes unsupported; the dashboard README records
the mapping. Record current-candidate UI evidence under the
[UI verification policy](sdlc.md#ui-approval-scope).

Hub #323 adds a read-only Nanoleaf scenario to the same matrix, using the
fixture's optional `panels` component. `apps/hub/tests/integration.test.mjs`
checks that a read-only extension snapshot validates and passes through the
integration route.

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
and the Work/Quiet/pending/unknown gating. Record current-candidate UI evidence under the
[UI verification policy](sdlc.md#ui-approval-scope).

Hub #355 adds `apps/dashboard/tests/art.test.mjs` to `npm run test:dashboard`
and `apps/dashboard/tests/art.mjs` to `npm run test:dashboard:browser`. The fake
Nanoleaf controller serves a 15-Line, 12-connector layout and, with the
`panels` option, an 18-triangle NL22 layout on the read-only geometry route, or
an explicit empty layout, a 404 like an owner that predates the route, a
hub-valid layout the renderer rejects, or one transport failure before the
layout. The browser check covers the drawn Lines with reservation colors and
labels, keyboard selection shared with the mapping form, pending marks, one
geometry read per session, a stale controller, the Panels with their controller
offline, the schematic fallbacks, the retried read, reads only and axe at
1280 px and 390 px, then drives status, activity, mode, the opening assembly and
reduced motion through a component harness bundled from `tests/art-harness.tsx`.
Record current-candidate UI evidence under the
[UI verification policy](sdlc.md#ui-approval-scope).

Hub #231 adds matrix scenarios for fresh guards and one-step settings:
- A controller generation advance between render and activation sends one
  command with current guards, and an open draft shows no conflict.
- A generation advance after the fresh read is shown as `stale-generation` and
  is not resubmitted.
- Accepted brightness and power changes leave their forms ready for the next
  change. Uncertain results still lock until an explicit reload, with keyboard
  focus on the reload button.
- Reapply Work sends one Nanoleaf mode command that ends an override, and a
  same-mode command with nothing to reapply is shown as already in effect.
- Start Monitor sends one Pixoo integration Monitor command, names the
  screen-off reason and leaves no empty block once Monitor is presenting.

The fake controllers reject a generation mismatch as `stale-generation`. The
fake Nanoleaf follows Nanoleaf `main` `08b6b83` same-mode handling, including
the configuration revision advance on admission, and the fake Pixoo reports
participation like Pixoo `main` `01da65d`. Client unit tests cover the status
wording and lock rules, including that only a same-mode reapply reports a
cancel as already in effect. Record current-candidate UI evidence under the
[UI verification policy](sdlc.md#ui-approval-scope).

Hub #245 moves the command lifecycle shared by draft forms and one-click actions
into `apps/dashboard/src/lifecycle.ts`. `apps/dashboard/tests/lifecycle.test.mjs`
runs under `npm run test:dashboard` and applies each case to both consumers:
- blocked and failed preparation;
- accepted, queued and terminal receipts;
- definite rejection, where another client's receipt is never adopted;
- uncertain and partial locks with explicit reload;
- a failed refresh after a result, and a stale read reaching the controller once.

A matrix scenario checks end to end that user-visible behaviour is unchanged on
the Pixoo brightness form and the Pause action. A failed device read before
sending sends nothing, recovery sends one command with current guards, a failed
read after an accepted command keeps its receipt, and a double click sends one
command. The app's reads resolve with an error record rather than rejecting, so
the rejected-promise paths are covered by the unit tests.

Hub #37 adds a now-playing matrix scenario with a fake Sony receiver behind the
fixture's hub. It covers only declared controls (no Play), one Next command,
paused Next/Previous with the stale-title note, a receiver refusal, an uncertain
result that locks without retry, a read-only credential, stale and unavailable
snapshots, and the view disappearing with no further playback reads once the
grant is removed. Client unit tests cover the button and reason rules, the
fresh-read command builder and the receipt mapping. The hub's `playback.test.mjs`
covers the launcher session's playback grant, the context field and the paused
Sony declaration. `mcp.test.mjs` covers the source-bound playback tools:
discovery by scope and grant, `hub_devices`, duplicate request IDs, typed
rejections, uncertain results, credential changes and a staged hub. None
contacts a receiver. The
owner's 2026-09-25 paused-state live check is recorded in the issue's refined
acceptance and in PR #275. Installed browser and Codex MCP acceptance come after
merge under the applicable [installation authority](sdlc.md#installation-and-evidence)
and are recorded on the issue. Record current-candidate UI evidence under the
[UI verification policy](sdlc.md#ui-approval-scope).

Hub #277 makes the dashboard a dense control surface. `apps/dashboard/tests/routes.test.mjs`
and `widgets.test.mjs` run under `npm run test:dashboard`; the browser suite
adds the first-screen, width-reach, route, alias-collision, unknown-address and
1,280 px height checks, and the matrix and local-controllers suites address
navigation links and open the Details disclosure where a fact moved behind it.
Hub #444 extends the existing Dashboard browser check with six registered
components. Their full widget bounds must fit the first screen at the owner's
2,133 × 1,200 viewport, 1,440 × 900 and 1,280 × 720; merely starting in view
is insufficient. The check also looks for text overlap at all three desktop
sizes and keeps the 390 px Home check. It uses disposable Hub and fake-controller
fixtures and contacts no physical device.
The owner's design decision on the candidate removes the Apply buttons: the
suites drive a select, slider, text field or Power button directly, a matrix
scenario checks the home widget's quick actions, the shared lock and running
state between the widget and the page, the surviving session draft and the skip
link, and the lifecycle unit test carries the form wording. The overlap check ignores closed disclosures. Full-page height at
1,280 px is recorded in the browser receipt. Record current-candidate UI evidence under the
[UI verification policy](sdlc.md#ui-approval-scope).

Hub #336 adds the Moments card. `apps/dashboard/tests/moments.test.mjs` runs
under `npm run test:dashboard` and covers the capability, mood, preset and
undeclared-line rules, every result line, the live line in the controller clock
and the lifecycle's `interpret` and `describe` hooks. `apps/dashboard/tests/moments.mjs`
joins `npm run test:dashboard:browser`. It drives the fixture's `moments` option,
a wall that serves controller contract 1.1 and uses the contract's reference
`admit` and `moment` operations as its admission and writer on a live device
clock. The suite covers:

- card presence and the home widget;
- the menu, presets and switch;
- one send per press, menu choice and preset, with a keyboard menu step that
  sends nothing until Enter;
- blocked, missed and 1.0-only lines;
- the uncertain lock with focus on the reload;
- supersede;
- the live line from scheduled to playing to each ending;
- the faster refresh stopping within 5 s of the end and never on a hidden page;
- axe at 1,280 px and 390 px.

The existing matrix and local-controller suites now expect moments in the
undeclared line. The device page reads `?apiVersion=1.1`, which 1.0 fakes answer
unchanged. Hub verification adds the three moment steps above. Record current-candidate UI evidence under the
[UI verification policy](sdlc.md#ui-approval-scope).

Browser suite gotchas, learned in #277:

- Chromium compiles the `pattern` attribute with the `v` flag, so an unescaped
  hyphen at the end of a class such as `[A-Za-z0-9_.-]` makes the pattern fail
  to compile, and the browser silently skips it. Write `[A-Za-z0-9_.\-]`. The
  Project ID field had this since #151 and the hub's own validation masked it.
- The suites use `page.locator('section:visible')` and expect exactly one
  match, so a page must never nest a `<section>`; panels are
  `div[role=group]`. Every page except Connections stays mounted and hidden, so
  an unscoped exact-text lookup can match the hidden home. Scope it to the
  visible section.
- `textOverlaps` in `apps/dashboard/tests/layout.mjs` must skip the content of a
  closed `<details>`, which Chromium still reports with boxes.
- Playwright's `fill()` on a range input dispatches only `input` and `change`,
  with no pointer or key events. `getByLabel('X', {exact: true})` fails for
  `<label>X<select>` because the option text joins the label; use
  `getByRole('combobox', {name})`.

## Shared monitoring setup checks

Hub #8 adds local setup operations to the hub package. `npm run test:setup`
builds and runs isolated configuration, credential and hook tests, which
`test:hub:built` also runs. The hub package check also
executes these tests in the offline installed archive. Use Node 24 on Linux/WSL.
These tests also refuse a `TMPDIR` inside a Git checkout; see
[Standalone hub checks](#standalone-hub-checks).
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
offline archive installation. Both run locally, not in CI; `test:hub:built`
includes the setup tests. Run the pinned consumer check above locally as well. Publish new state
2.0.0 and Hub 0.2.0 archives with hashes and the merged source revision; preserve
previous release bytes. Package version changes do not change snapshot/storage 1.0.

## Standalone hub MCP checks

`npm run test:hub:mcp` builds and exercises the optional host MCP route with disposable storage, synthetic credentials and fake loopback controllers. The broader hub and installed archive tests also include these scenarios; all of them run locally, not in CI. Retain all shared MCP, contract and workflow checks. No test starts an installed agent or contacts a physical device.

The media cases cover alias-bound playlist start and controller v1 playback
actions, strict inputs, current control/device permissions, typed owner
rejections, replay and ambiguous results without automatic retries. The Hub
suites run these cases directly and in the offline hub archive.

## Hub automation checks

Hub #358 adds event rules, the interrupt set, event intake, arbitration and the
automation log. `npm run test:hub:automation` builds and runs
`apps/hub/tests/automation.test.mjs` on its own. The file also runs in
`npm run test:hub` and in the packaged hub tests through the
`apps/hub/tests/*.test.mjs` pattern. Set `TMPDIR` outside any Git checkout, as for the
[standalone hub checks](#standalone-hub-checks).

The tests use disposable private stores, synthetic credentials, a fake event
source, an injected target reader and a fake moment sender with the #335
single-device shape. They cover restart persistence and one-time seeding,
route scopes and typed errors, duplicate and replayed events, each arbitration
block, independent per-target hand-off with no retry, and the lifecycle
source. The shared fake controller scenarios run the composed reader and the
real `sendMoment`: blocked targets get no controller command, the capable
target gets exactly one 1.1 moment, and a typed refusal is logged without a
resend. No test starts an installed service or contacts a device. Also run the standalone hub, hub MCP and shared
monitoring setup checks above, plus the shared build, type, contract and
workflow checks.

Hub #426 adds `automation-metadata.test.mjs` to the same hub and offline-package
test patterns. It exercises the real intake and SQLite log with the PR and
meeting fixtures in `apps/hub/fixtures/moment-title-events.json`: bounded
Unicode display fields, credential rejection before deduplication, legacy log
rows, restart readback, blocked moments and duplicate/replay protection. The
fixture cases in `automation.test.mjs` also read the metadata through the
authenticated log route and verify that controller intents retain their strict
1.1 shape. The existing hub suites run both files.

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
To check whether one of its services or another node process is still running,
do not use `pgrep -f <pattern>`: it also matches the agent's own shell, whose
command line contains the pattern. Read `/proc/<pid>/cmdline` for each
candidate node process instead.

This local cross-repository check needs explicit prepared private sources; ordinary
CI retains its existing component, contract, browser and package tests without
adding private repository credentials. Run `npm run typecheck`,
`npm run test:hub:built`, `npm run test:dashboard`, `npm run test:dashboard:browser`,
`npm run check:workflow` and `npm run test:workflow` alongside the source check.
The Hub command includes `tests/compatibility_process.test.mjs`, which checks
forced process cleanup and failed preflight reports without private source
access.
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
and recoveries) and its module test kit run in real time (`module-kit.test.ts`). Under the runtime, `test:runtime:built` runs
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

Hub #218 added focused cases to the existing `test:agent-state`, `test:hub` and their packaged suites. Hub #241 parameterizes the owner, Tidbyt and dashboard cases over Codex Desktop, Codex CLI and Claude Code, and adds mixed-path and upgraded-store cases. Run their Python snapshot fixtures as well. The existing CI jobs include these paths; no new device job is needed. Cover atomic tree removal, one revision, released capacity, other paths preserved, old ends/events across restart and resume, history bounds, legacy import, stored accepted ends settled on startup, failed commits, archive admission with unavailable evidence, default snapshot 1.0 and opt-in 1.1. Existing fake-clock retention tests preserve the 24-hour fallback.

Run the focused Nanoleaf companion checks against its owning service, plus Pixoo/Tidbyt current-snapshot, empty-idle, reconnect and dashboard-removal scenarios. A consumer that retains task-specific state needs snapshot 1.1 generations to detect recreation between reads. Source checks do not establish installed-client timing or visible Line release.

The #218 source acceptance harness uses the existing Pixoo source pin and the Nanoleaf candidate pin in `apps/hub/fixtures/retirement-nanoleaf-source.json`. Prepare those exact sources on disk, install their declared dependencies, and build Pixoo. Then run:

```bash
node scripts/check-session-retirement.mjs /absolute/pixoo-source /absolute/nanoleaf-source /absolute/retirement-report.json
```

Set `RETIREMENT_PATH` to `codex/desktop` (the default), `codex/cli` or `claude/code` and run it once per path. It supplies actual owner snapshots to both consumers, checks the shared fixture corpus through Nanoleaf, and distinguishes healthy-empty reconnect from unavailable retained state. It launches no device worker. The existing Tidbyt publisher and dashboard browser jobs also exercise retirement on every path. Keep the standalone harness receipts alongside required CI; they are source evidence, not installed or physical acceptance.

## Shared title and project checks

Hub #424 adds lifecycle 1.1 and snapshot 1.2 corpora to the existing TypeScript
and Python checks. New state tests cover rename ordering, label provenance,
legacy projections and synthetic restart. Hook tests cover explicit version
selection, bounded Codex/Claude title reads, missing sources and content
exclusion. HTTP tests exercise the configured Desktop index and Unicode labels;
MCP and browser checks cover metadata exposure. The existing glob-based suites
include these tests; the Hub's run locally since #827. `test:dashboard:browser` also runs
`apps/dashboard/tests/session-metadata.mjs` for desktop/mobile candidates.

Run build/type, controller, lifecycle, state, agent-status, Tidbyt, LIFX,
local-controller, MCP, Hub, setup, dashboard and workflow checks, including both
language corpora and isolated packages. The local source-consumer compatibility
checks retain their pinned historical source revisions. Record installed and
physical acceptance separately; these fixtures establish neither.

The lifecycle 1.1.0 archive is built from the candidate source and bundled in
agent-state 3.4.0 with archive/manifest hashes. Hub 0.4.1 bundles those artifacts. Its controller-contracts 1.1.0 and Device MCP
1.0.1 dependencies come from their published archives in `vendor/`, checked
against fixed archive and manifest hashes; their original receipts are retained.
The Hub package check rejects a changed archive or rebuilt manifest, then runs
the installed package tests with the published dependencies.
Publication follows the reviewed merged revision, with immutable source/checksum
receipts and preserved prior release bytes. Packaging scratch is disk-backed
under `.local/scratch/package-archives`; runtime fixtures keep their small
private stores outside Git checkouts.

## Owner capacity checks

Hub #807 lets a new root task displace a finished child subtree without attention
when the owner is full. `packages/agent-state/tests/capacity.test.mjs` covers
displacement with descendants and two revisions, ranking by subtree evidence,
protection of running (`active`), real-hook `unknown` and attended subtrees,
rejection of a new child, events that create no root (acknowledgment, guarded
retired root, old observation, archived Codex Desktop conversation) and a failed
displacement commit. The glob-based `npm run test:agent-state` and the existing CI
jobs run it, so no new command or CI job is needed. Run the agent-state check set
listed above. Live admission while the installed owner is full is an installed
observation.

## Claude Desktop host session checks

Hub #784 adds lifecycle 1.2 (`packages/lifecycle-contracts/fixtures/lifecycle-v1.2.json`,
validated in TypeScript through the `/v1.2` subpath while the root module keeps rejecting 1.2)
and snapshot 1.3 (`packages/agent-state/fixtures/snapshots-v1.3.json`) corpora to
the existing TypeScript and Python checks. `host-session-provider.test.mjs` covers
Desktop, CLI, missing, malformed, oversized, throwing, child, Codex and
older-version environments. `host-session.test.mjs` in agent-state covers the
memory-only owner map, `/clear`, retirement, expiry, failed commits, restart and
durable 2.1 exports. The Hub's `host-session.test.mjs` reads the
on-disk store and checks it against the stored durable 2.1 schema. The setup,
setup-hook and MCP suites cover the 1.2 selection. The existing
glob-based suites run all of them, so no new command is needed. CI runs the
agent-state suites; the Hub's run locally since #827.

Run the build/type, contract, lifecycle, state, Hub, setup, MCP, package and
workflow checks listed above. Synthetic environments prove the mapping only;
whether installed Desktop hooks inherit the variables is installed-observation
evidence.

## App verification and preview runs

[App verification](app-verification.md) defines the operations, receipt,
storage, supervisor and failure behavior for disposable application runs with
synthetic data, and [ADR 0009](decisions/0009-app-verification-runs.md) records
the decisions. Runs use transient `systemd --user` units, keep runtime state
under `~/.local/state/app-verify/` and proof under the canonical checkout's
`.local/evidence/verify/`, and never use the installed ports or services.

Hub #494 implements the lifecycle once in the private workspace package
[`packages/app-verify`](../packages/app-verify/README.md)
(`@jimmie-potts/app-verify`), which the Hub, Nanoleaf and Pixoo adapters
consume through one plug-in each. Use Node 24 from the worktree root and run
`npm run build`, `npm run typecheck` (which also type-checks the package's
caller examples), `npm run test:app-verify` and `npm run test:app-verify:package`.
The `verify`, `verify:compose`, `verify:chompi` and `verify:runtime` scripts set
`APP_VERIFY_SINGLE_RUN=1`, so a second `start` beside a live run is refused
([one run at a time](app-verification.md#one-run-at-a-time)); the test suites
do not set it.
`npm run -s verify -- prerequisites` is the Hub's read-only local inspection;
it never qualifies launch, capture or Windows browser handoff. Pinned Nanoleaf
and Pixoo adapters remain on core 1.1.0 and report the operation unsupported.
Set `TMPDIR` outside every Git checkout, for example
`~/.cache/agent-device-hub/<task>-tmp`: the tests' runtime roots live under
it, and the core refuses runtime state inside a checkout.

The suite has two parts:

- **Everywhere, including CI:** receipt validation, `help`, `start` refusing
  without a user manager (exit 3, nothing created; forced locally by hiding
  the user bus), `tests/lock.test.mjs` (concurrent receipt updates against a
  lock left by a killed writer lose nothing, and a stuck or holder-less lock
  breaker ends in `receipt-locked` or is cleared), and
  `tests/unsupervised.test.mjs`. That file judges capture
  steps through `runCaptureStep`: the reference passes, and a `control-*`
  wrong expectation, predicates that return `false`, a known-broken app and a
  step without assertions fail. Missing Playwright, Chromium or ffmpeg is
  `unavailable`, and an encoder that writes nothing or a truncated WebM is
  `failed`, as is a step whose served artifact changed before or during it.
  The lock file also forces a prepared lock directory swept
  mid-acquire and a stale dead-breaker record, and `tests/inputs.test.mjs`
  runs its input refusals and `runCaptureStep` inputs test here.
  `tests/error-body.test.mjs` checks the shared error body on each refusal
  that needs no run, and checks every body against
  `@jimmie-potts/event-contracts`' `errorBody` (Hub #921).
  `tests/single-run.test.mjs` checks the one-run guard's refusal wording
  against the README's example, and that a guarded `start` without a user
  manager still exits 3 (Hub #944).
- **Only on a host with a user manager** (`systemctl --user
  is-system-running` answering `running`, `degraded`, `starting` or
  `initializing`): every lifecycle test. These start real transient units
  named `app-verify-avt-*` with leases of seconds and a fixture counter
  application, and stop every unit they created. They cover start order,
  failed and interrupted starts, concurrency and reseeds, extend (including a
  refused timer and a stray one), expiry, doctor staleness, restart, frozen
  proof, attachments, interrupted captures, receipt-less stop and a stop
  retried after `receipt-locked`, and, for 1.1, inputs kept across every
  relaunch, scenario-specific inputs, redacted failure details and extra
  endpoints (`tests/endpoints.test.mjs`), and the one-run guard: a second
  `start` with `APP_VERIFY_SINGLE_RUN=1` is refused beside a live run of any
  app and leaves that run untouched, two starts begun together cannot both
  pass, a held claim refuses a start, and failed units, stray timers and the
  host route's command unit never block it. Without a
  manager they skip, each with the printed reason, unless
  `APP_VERIFY_REQUIRE_SYSTEMD=1` makes that a failure. The delivery evidence
  records them from the owner's WSL host.

The package check installs the packed archive into an isolated consumer under
`TMPDIR`, outside every checkout, that supplies its own Playwright. It verifies
every file hash, checks that no other `@jimmie-potts` package resolves there,
runs the packaged suite and repeats any skip reason. The error body's registry
check prints its skip reason there. Neither check touches installed services,
personal state or devices, and neither contacts Windows: the tests set
`APP_VERIFY_WINDOWS_CHECK=off`.

The App verification CI job runs both after a fresh build and Chromium
install. Depot's Ubuntu runner, which ran CI until #870, was not booted with
systemd: on PR #552, `systemctl --user is-system-running` answered `offline` and
`loginctl enable-linger` failed with "System has not been booted with systemd
as init system (PID 1)". GitHub-hosted runners do have a user manager, but under
their systemd 255 the lease timer does not read back
([run](https://github.com/jimmie-potts/agent-device-hub/actions/runs/37464802851), [#873](https://github.com/jimmie-potts/agent-device-hub/issues/873)).
The App verification job therefore hides the user bus, the lifecycle tests skip,
and CI proves the first part only.
`npm run package:app-verify` writes
`artifacts/jimmie-potts-app-verify-<version>.tgz` and its `.sha256` for a
release; other repositories vendor that archive.

The Hub adapter ([`apps/hub/verify`](../apps/hub/verify/README.md)) runs the
real hub and dashboard with the dashboard fixture's fake controllers. Its
entry point is `npm run -s verify -- <operation>` after `npm run build`, and
its README keeps the feature map of steps, UI entries, driver actions,
scenarios and expected observations. Run `npm run test:hub:verify` with the
checks above and the Standalone hub and Dashboard checks, because the adapter
reuses `apps/dashboard/tests/fixture.mjs`. It is an
[old system check](#old-system-checks) that runs locally, not in CI. It covers:

- its unsupervised step test judges the seven reference steps on the correct
  app and under each seeded fault (`write-on-read`, `duplicate-forward`,
  `replay-on-recovery`), plus the two `control-*` steps. Three of them are
  the Hub #336 moment steps (`moment-plays`, `moment-blocked-on-status`,
  `moment-uncertain-no-replay`) on the `moments` scenario;
- its build test checks the build-freshness sources against esbuild's
  dashboard inputs;
- its wrapper test checks the unbuilt core's single JSON result and exit 3,
  built delegation, and distinct reporting of a broken core dependency;
- its proof test checks both verification launchers, the unchanged installed
  CLI, same-port reuse, retained proof after shutdown and Chromium image/video
  loading. Core `tests/proof.test.mjs` checks commitment, checksum and path
  confinement, symlink refusal, methods, origins, ranges, later captures and
  failed captures. Both existing test globs include these cases;
- its run tests use real user units and skip there with the printed reason.

For #559, the real-manager run test also checks handoff URLs after reseed,
repeat handoff and stop. The focused expiry test proves that a frozen proof
URL closes when the run's own lease expires. Use `APP_VERIFY_REQUIRE_SYSTEMD=1`
on the owner host so these checks cannot pass by skipping. These are disposable
verification runs; no installed Hub or device is involved.

The Nanoleaf and Pixoo adapters document theirs in their own repositories.

Hub #495 composes one preview from the three adapters with
`npm run -s verify:compose -- <operation>`; see
[Composed previews](app-verification.md#composed-previews). The composition
tests (`apps/hub/verify/tests/compose.test.mjs`) run in
`npm run test:hub:verify`. They use real user units with stand-in consumer
adapters in disposable pinned Git checkouts and skip without a user manager.
They also check that a composition is
refused beside a live run and starts its own three runs under the one-run
guard (Hub #944). The safety-thaw cases also change a run's own lease
without updating the composition, expire it during a freeze, and verify stop
removes the timer and service after an interrupted injection.
`apps/hub/verify/tests/safety-thaw.test.mjs` covers lease decisions and command
ordering without a manager; it does not replace those real-unit cases.

Hub #557 adds portable pause/identity and operation-interruption checks in
`feed-pause.test.mjs` and `reset.test.mjs`, covered by the same CI test glob and
verify type check. Its additional `compose.test.mjs` cases cover reset success,
each failed phase and interrupted owner reseeding with real user units. Run
those with `APP_VERIFY_REQUIRE_SYSTEMD=1` on the owner host; a skipped case is
not qualification. The recorded qualification also retains the actual failing
held-ack mutation and orphan-adapter regression, so the checks can detect the
unsafe behavior they protect against.

Hub #649 adds core-written receipt regressions for default runtime labels and
ordinary shareable proof permissions. These run in the same portable test glob.
They preserve private runtime/control checks and reject unsafe proof ownership,
links, write permissions, oversized files and mismatched identity. Lease checks
use the same bounded receipt snapshot already checked by the reset guard.

The cross-repository check with the real consumers runs locally from this
worktree after `npm run build`:

1. Prepare each consumer at its pin in
   [`compose.json`](../apps/hub/verify/compose.json) as a detached worktree
   under disk-backed scratch:
   - codex-nanoleaf: `npm ci`, and a Python 3.12 or later virtual
     environment with `requirements-controller.txt`, exported as `PYTHON`;
   - divoom-app-upgrade: its Node 24.5 or later `npm ci`. Its adapter builds
     on `start`.
2. Run `start` with both `--checkout` paths, then
   `capture <id> integrated-lifecycle`, `capture <id> integrated-command`,
   `capture <id> one-owner`, `inject <id> consumer-loss pixoo`,
   `handoff <id>`, `reset <id>`, `doctor <id>`, another `reset <id>` and
   `stop <id>`. After each reset, require current feeds at the initial owner
   revision, unchanged run ids/ports/pairing tokens and frozen proof hashes.
   Read all three pages to confirm the changed session and device settings have
   returned to their seeded state.
3. Run the controls in a separate composition, so they never freeze or
   reseed the Pixoo of a preview already handed to the owner; otherwise run
   them after `handoff`:
   - `inject <id> consumer-loss pixoo --step control-replay-after-recovery`
     must hold at "nothing but the loss-time command reached a writer, and
     that at most once";
   - `inject <id> second-owner pixoo` must hold at "the Pixoo reads its
     sessions only from the Hub: current at the owner's revision, with
     exactly the Hub's sessions".

   `compose` exits 0 only for a held control and records the expected
   assertion. A control that exits 1 did not hold, whatever its reason.

For the reset qualification, `node apps/hub/verify/tests/qualify-reset.mjs
<nanoleaf-checkout> <pixoo-checkout> <new-evidence-directory>` automates the
three captures, handoff, two resets, page screenshots, feed/identity/token/hash
checks, the loss/replay/second-owner injections above, and owner-first stop.
Use a short disk-backed `TMPDIR` outside Git and
run through `fnm exec --using=.nvmrc --`. Its JSON record and raw command logs
must all pass; screenshots alone are not a pass. This driver uses disposable
runs and the manifest pins, and preserves evidence after cleanup.
Append `--host-defaults`, with absolute `PYTHON` and `FNM_BIN` environment
paths, to qualify the documented `verify:host --host` route using the core's
default runtime and canonical proof roots. This mode requires the same explicit
host authority as preview launches. It records command-unit cleanup, verifies
unchanged lease expiries, and copies each frozen proof set into its evidence
directory. It stops only the recorded composition; it never deletes the shared
runtime root. This default-storage case is required for receipt compatibility
changes; a private temporary-root fixture alone does not cover it.
It requests snapshot 1.2 for the shared session titles, confirms a changed title
is visible on each page before reset, then checks those titles are absent after
each reset. A portable real-Hub HTTP test covers that version negotiation;
the default snapshot 1.0 route continues to omit shared titles.

The delivery evidence records the composition id, its `composition.json`,
each run's verified set and the consumer revisions. Only the delivery
composition's runs are delivery receipts; a controls composition's runs are
not. A composition proves
simulated cross-service behavior only, not installed or physical
acceptance.

### Host routing checks

Run `npm run test:verify-host` with Node 24 from the Hub worktree. CI runs this
in the App verification job. It checks explicit selection, named adapter and
checkout identity, literal arguments, minimal environment, denied supervisor,
command-only cleanup, timeout/abort, preserved nonzero adapter results, and
unknown outcomes without a start retry. The transport test starts only a
disposable Node subprocess; supervisor fixtures start no systemd units.
These source checks do not qualify the named host or Windows browser. Keep
shared build/type, controller-contract and workflow checks for this source
change; unchanged app lifecycle/consumer behavior keeps its existing CI checks.

## Pixoo module checks

`modules/pixoo/` is the Pixoo runtime module, `@jimmie-potts/pixoo` (#843), built
from the packages and presentation imported for #25. Its
[README](../modules/pixoo/README.md) describes the module and records the
source commit, the edits and every file left in divoom-app-upgrade. Use Node 24
and run `npm ci`, `npm run build`, `npm run typecheck`, `npm run lint:js` and
`npm run test:pixoo` from the worktree root, plus the runtime's checks
(`test:runtime:built`, `test:runtime:scenarios:built`, and
`test:runtime:verify:built` alone), `test:maintenance:built`, `check:workflow`
and `test:workflow`. The build compiles the module and its tests
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
  stand-in owners; and its configuration and settings conversion.

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

## Epic Guide browser

Hub #511 adds a separate static candidate; the legacy Guide remains available.
Use Node 24 after `npm ci`, and the existing Python story parsers.

```bash
node --test docs/work-guide/browser/tests/*.test.mjs
node docs/work-guide/browser/tests/browser.mjs
node docs/work-guide/browser/tests/live.mjs
node docs/work-guide/browser/build.mjs --collect
# Use --collect --rest if GraphQL quota is unavailable; Search must reconcile completely.
node docs/work-guide/browser/build.mjs --build
node docs/work-guide/browser/build.mjs --check
```

Adapter checks cover terminal pagination, independent inventory reconciliation,
whole-attempt consistency, required ancestry, optional metadata gaps, UTC
completion boundaries, prerequisite outcomes and last-good preservation.
Browser checks exercise the actual generator/renderer with a large epic, mobile,
keyboard, Back/filter state, theme, reduced motion, per-page print, briefs and
clipboard denial; negative controls reject mixed releases and unsafe projection.
The build emits canonical records, release manifest and actionable inventory
audit. Source candidate verification does not establish hosted/public acceptance.
Run the existing Guide maintenance/build/browser and shared build/type/controller
contract/workflow checks as well. CI runs these browser tests with pinned Chromium.

## Shared observability contract checks

The source contract in `packages/observability` uses Node 24 and Python 3.14. From the assigned worktree, run `npm ci`, install
`requirements-contracts.txt` in an isolated Python environment, then run
`npm run build`, `npm run typecheck`, `npm run test:observability`,
`npm run test:observability:python`, `npm run test:observability:query` and
`npm run test:observability:package` and `npm run test:observability:browser`
(with Chromium in the shared Playwright cache). The browser check runs in the
App verification CI job, where Chromium is already installed. The core CI job
runs the built conformance, Python, query and archive-consumer checks. Keep
the shared controller/lifecycle/workflow and affected consumer checks required
by the final change.

Fixtures cover safe canonical records, exact OTLP mappings, strict version
projections, privacy, context isolation and bounded sink failures. Profile 1.2
fixtures cover the runtime's records and their negative controls, profile 1.3
fixtures its decision, outbox and device records and theirs (#949), profile 1.4
fixtures the gateway's route, method and credentials reload and theirs (#835), and
`tests/profile.test.mjs` checks that the schema and catalog agree, that every
earlier profile rejects each profile's additions, and the runtime scopes'
rules. `tests/host.test.mjs` checks that a host records only its profile's span
names, which `test_host.py` checks for the Python helper, and records spans
through the host adapter's bounded local span sink with no collector.
The package check verifies immutable archive contents and independent TypeScript/Python
consumers. These checks use synthetic records, no collector, device or live
state. Real ingestion and Grafana queries belong to the separately bounded functional
pilot; passing fixtures do not establish adoption. Performance is unqualified.

## Shared observability pilot checks

The functional pilot in [#704](https://github.com/jimmie-potts/agent-device-hub/issues/704)
checks real ingestion, trace/log correlation and representative failure behavior.
The owner-approved scope revision of 2026-10-02 defers paired performance
qualification. A supported functional result does not claim acceptable overhead,
installed coverage or physical-device behavior.

### Source validation

Use Node 24 and Python 3.14. Run `npm ci`, the shared build/type/contract
and workflow checks, the owning Hub/Hub MCP/package checks, and
`npm run test:observability:pilot`. CI runs the pilot tests in the core
job. The source tests use synthetic inputs and no Docker.

Hub synthetic state must be outside every Git checkout. On this host use:

```bash
TMPDIR=/home/jimmie/projects/.local/scratch/o704 fnm exec --using=.nvmrc -- npm run test:observability:pilot
```

Keep npm and browser downloads in the shared caches. Put durable evidence in
the main checkout's `.local/evidence/`, never only inside a removable worktree.
The pilot consumes the checksum-verified observability 1.0.0 archive from
`vendor/`; Node and Python packaged-consumer checks reject damaged inputs.
Public dependencies use the consumer lock
matching the root lock; run root `npm ci` first to populate their exact tarballs.
Consumer setup needs no cached registry metadata.

### Local synthetic qualification

The existing local Docker engine is required. Do not install or reconfigure it
as part of these commands. The pinned backend is
`grafana/otel-lgtm:0.34.0@sha256:c6a56be719990e78b1d32e879988a219904300ecde1b9bfeec472831a56a922b`.
The run requires that image already present and verifies its identity and size.

The profile uses a fresh task-owned ordinary bridge and volume, exact loopback
port bindings, two CPUs and 4 GiB RAM with no extra swap. Keep at least 8 GiB
host-available RAM, at most 10 GiB image space and 2 GiB run data. The resource
watchdog stops the owned stack on a cap breach or missing required evidence.
No privileged mode, physical device, host networking, daemon or firewall change
is permitted. An ordinary bridge allows outbound traffic; all producer state is
synthetic and backend analytics/plugin downloads are disabled.

Supply a new evidence directory and an existing disk-backed state parent outside
Git. Choose free ports; the example uses 43000–43004:

```bash
fnm exec --using=.nvmrc -- npm run qualify:observability -- ingestion \
  --evidence-dir /home/jimmie/projects/agent-device-hub/.local/evidence/gh-706-observability/final-ingestion \
  --state-parent /home/jimmie/projects/.local/scratch/o704 \
  --endpoint unix:///var/run/docker.sock \
  --ports 43000,43001,43002,43003,43004
```

`ingestion` performs one authenticated Hub brightness command through the fake
controller, plus a Python contract fixture. Expect seven Node logs/six spans and
one Python log/span. Saved queries compare canonical identities and fields in
Loki/Tempo within a 30-second visibility window; export acknowledgment alone
cannot pass. The Python fixture proves compatible ingestion, not complete Python
application instrumentation. The backend stops and its confirmed run-owned resources/state are removed before the command returns.

Other supported modes use the same arguments:

- `backend-smoke`: readiness and resource checks, with no application workload.
- `delivery-smoke`: three commands with prequeue identities and loss accounting.
- `command-faults`: ten representative command, context and error scenarios.
- `paused-collector` and `absent-collector`: retained bounded fault procedures,
  each using 200 sequential commands per mode. They are available for relevant
  regressions; routinely repeating them is not required for the practical pilot.

The application uses the real Hub route and native ticket semantics. The fake
controller has an independent execution oracle; admission is not execution and
a timeout after admission remains uncertain. No command is automatically retried.
Pino has one Collector log path. Manual and narrowly scoped outgoing HTTP spans
use the shared fields. No incoming pre-authentication instrumentation, device
endpoint tracing, baggage or tracestate is enabled. Host-owned queues remain
bounded to 1,024 records/4 MiB per signal, with 8 KiB records and drop-newest
counters. Flush is bounded to one second; the pilot reserves 50 ms of that for
finalization. Preserve the failed original flush attempt in historical evidence.

### Cleanup and retained evidence

Each run saves exact ownership manifests and lifecycle results. A failed or
partial allocation must be inspected before cleanup; never retry ambiguous
start/stop/removal effects or use Docker prune. After a confirmed stop, the command automatically invokes the receipt-based
`cleanupQualification` helper in `scripts/observability/qualification-cleanup.mjs`
verifies stopped containers and application absence, removes only the recorded
container/network/volume and synthetic state, and retains evidence. Cleanup
refuses foreign resources, running applications and unknown state. Preserve its
receipt and verify that unrelated containers remain untouched. The container
teardown budget is 30 seconds.

### Existing Grafana viewer

Keep the backend inside a monitored `withReadyBackend` action while inspecting
it; standalone qualification stops it on return. Do not restart a stopped run
merely to inspect its UI. Existing applicable screenshots and queries may be
reused with their source revision and limitations recorded.

1. Read the Node `trace_id` from `ingestion-producer.json`. Open the selected
   loopback Grafana port and choose **Explore → Loki**.
2. Select the recorded time range and query
   `{service_namespace="bunny",deployment_environment_name="test"} | trace_id="<trace_id>"`.
   Inspect `event_name`, `severity_text`, `bunny_operation`, `bunny_outcome`,
   `bunny_ticket_epoch`, `bunny_ticket_sequence`, `span_id` and service fields.
3. Open **Explore → Tempo** and look up the same trace ID. The fixture has six
   Node spans across Hub, controller and worker, including queue/execution.
4. Retain the exact queries, time range and screenshots. Manual trace-ID lookup
   is the initial workflow; no automatic log-to-trace link is claimed.

The pinned Collector copies OTLP event names to the queryable `event_name`
attribute for Loki. Loki normalizes attribute dots to underscores; the query
reader preserves typed values. Request/ticket/trace identities remain metadata,
not high-cardinality stream labels. Python uses the same mapping.

### Functional disposition and deferred work

A supported recommendation needs applicable ingestion/viewer, command/failure
and cleanup evidence plus normal independent reviews, tests and CI. Run a short
final-candidate functional check and rerun tests affected by changes. Reuse
existing valid evidence instead of repeating every experiment. Missing or failed
functional evidence remains a blocker; source tests alone do not prove ingestion.

The original paired harness is recoverable from
`archive/gh-704-full-qualification-20261002` at `3e2f363`. Both attempted suites
remain inconclusive; neither produced a qualified measured pair. Original
threshold bytes and raw results remain evidence. They are not relabeled passing
under the new scope. Numerical overhead qualification, exhaustive browser/hook/
helper coverage and production backend operation are deferred. Revisit budgets
if real use exposes drops, resource problems or materially greater volume.

No command here installs a daily-use service, changes personal hooks/settings,
migrates live state or operates a physical device. Practical source adoption and
its enable/disable configuration are separate from an explicitly authorized
installation.

## Shared host diagnostics checks

`npm run test:observability:built` includes the explicit Node host runtime
checks against a loopback fake OTLP endpoint. `npm run test:observability:python`
and `npm run test:observability:package:built` cover the Python host and external
immutable consumer; both run in the core CI job with Python 3.14.
Run build/type first and install the pinned contract and host requirements.
Browser conformance keeps the pure entrypoint separate. Hub CLI/request/worker
adoption is covered by the existing Hub/MCP/setup checks. These are synthetic
source checks; they do not install services or qualify physical devices.

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
