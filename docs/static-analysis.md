# Static analysis

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
  (`docs/diagrams/legacy/sources/`).

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
  them. The Wispr module alone also imports the pure `@jimmie-potts/wispr-contracts`
  package to validate its unchanged collector-file handoff (#927); it may not
  import the collector, old Hub or another module. It checks static, re-export, type and
  literal dynamic imports, including `file:` URLs, and rejects non-literal
  dynamic imports. Paths resolve from the repository root, so the rule works
  from any directory. `createRequire` and `.cjs` files are not checked.
- **Safe errors:** production code keeps off the console and keeps exception
  text and hand-built error bodies out of what it builds. See
  [Safe-error rules](development.md#safe-error-rules).
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
  - It also catches `stdout` or `stderr` destructured from `process` or from
    the default `node:process` import (`const {stdout} = process`), and
    `globalThis.process.stdout` (#954).
  - It misses `process.emitWarning`, writes to file descriptors 1 and 2, an
    alias of `process` and `await import('node:console')`; see
    [the misses](development.md#lint-misses-and-their-reasons).
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
  - It also catches ``String.raw`${error}` ``, an exception in an array
    literal that is joined (`[label, error].join(' ')`), and one concatenated
    onto a string literal (`'failed: '.concat(error)`) (#954).
  - It misses an alias (`const failure = error`), a helper the exception is
    passed to, a custom type guard, an untyped callback parameter outside these
    shapes, a value typed `any`, a computed member or a call inside an
    `instanceof` test (`r[key] instanceof Error`), any other tag, a variable's
    `join` or `concat`, and a narrowed catch binding that is later reassigned;
    see [the misses](development.md#lint-misses-and-their-reasons).
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
| `bunny/safe-errors/stream-owners` | `streamOwners` in `eslint.config.mjs` | `no-console` | The runtime's journal sink (`log.ts`) and process entry (`process.ts`), the Pixoo library migration's entry point (`migrate-pixoo.ts`, #931), the Nanoleaf migration's entry point (`migrate-nanoleaf.ts`, #933), and the verification run's supervisor and network guard, own the process's standard streams. | Permanent. A new entry point is added by name. |
| `bunny/safe-errors/contracts` | `packages/event-contracts/` | `error-body-from-registry` | It defines `errorBody`. | Permanent |
| `bunny/safe-errors/runtime-usage` | `apps/runtime/src/process.ts` | `no-raw-error-text` | A malformed command line's usage error quotes `parseArgs`'s message, which repeats only the operator's own argument, in the usage output before the runtime starts. ADR 0012's surfaces do not include usage output. | Permanent ([#954](https://github.com/jimmie-potts/agent-device-hub/issues/954)) |

The verification run's harness, run adapter and scenario runner follow the
rules since #954. The supervisor's refusals come from `errorBody`: a malformed
body is `invalid-request`, an oversized one `too-large`, and any other failure
`internal` with fixed text. The adapter's reports and a failed step's detail,
which a capture's proof keeps, name a failure by its own text, a refusal's
registry code or the exception's type (`failureOf` in the scenario catalog).

### ADR 0012 rules and their checks

Each rule in ADR 0012's
[Errors, effects and outcomes](decisions/0012-bunny-event-platform.md#errors-effects-and-outcomes)
and [Observability](decisions/0012-bunny-event-platform.md#observability)
maps to the check that fails when code breaks it, or to the reason no
mechanical check can (#954). Reviewers check the last column under
[docs/sdlc.md](sdlc.md#review-and-merge) step 3. A module story adopts the
module test kit and these lint rules; it does not copy this table. A file name
is a test file in the named package's `tests/` directory.

| Rule | Checks that fail | Not checked mechanically |
| --- | --- | --- |
| One registry: codes and their `retryable` flags | Event contracts `v2.test.mjs` (registry parity, unregistered codes refused); SDK `registry.test.ts` (an unregistered code fails to compile), `remote.test.ts` and `request.test.ts` (refusals rebuilt from the registry); lint `bunny/error-body-from-registry` | |
| Typed refusals; an exception mapped once where the effect is known | Kit check `refuses a command with the shared error body`; SDK `request.test.ts` and `configuration.test.ts` | That an error is mapped once and then passed on unchanged: the Specification review |
| A rejection proves no effect | SDK `conformance.test.ts` on both transports (a responder that fails after it started is `uncertain-result` and nothing sends it again), `workers.test.ts`; catalog scenario `end-to-end` | |
| `accepted` after durable state; a full disk refuses; a restart reports and never reruns | Kit check `keeps the outcome in its outbox and sends it again after a restart`; runtime `core.test.ts`, `core-store.test.ts` and `full-disk.test.ts` (full disk); the LIFX, Pixoo, playback and Nanoleaf restart tests | A full disk in each module: the kit cannot fill a disk, so each module story tests its own store (LIFX does) |
| Retries: nothing resends a command; one owner and capped backoff per loop | SDK `expiry.test.ts`, `remote.test.ts` and `grants.test.ts` (`duplicate-conflict`, the responder runs once); runtime `core.test.ts` (capped backoff, one record and a summary) | That `retryable` never permits a resend and each loop has one owner: the Specification review. A module's write budget: its own tests |
| Each observation or sync attempt has a deadline | SDK `sync.test.ts` (a sync past its deadline is `unavailable`; `timeoutMs` is required); the kit check `starts while its device never answers, and reports it unavailable` (a module whose device never answers must report it within the kit's timeout) | A module whose kit description gives no `offline`: the core reaches no device, and every shipped device module gives one |
| Deadlines: queued is `expired`, held is `uncertain` | SDK `expiry.test.ts`; LIFX `queue.test.ts` | Partial effects kept in an outcome: each module's tests |
| Cancellation is not undo | SDK `workers.test.ts` (a call aborted after its worker started is `uncertain`, one aborted before is `cancelled`) and `diagnostics.test.ts` (a command cancelled while it waits is one cancellation) | That a module's own cancellation keeps the effects already made: each module story |
| Committed is not published | SDK `outbox.test.ts`; runtime `core-store.test.ts`; the kit's outbox check | |
| Acknowledging outcomes | SDK `outbox.test.ts` (an acknowledged outcome is forgotten); runtime `lamp.test.ts` (the stand-in refuses a reused `(source, id)`) | The core's acknowledgment, after its commit and only from the authenticated core: [#782](https://github.com/jimmie-potts/agent-device-hub/issues/782) |
| Late and conflicting outcomes | None yet | [#782](https://github.com/jimmie-potts/agent-device-hub/issues/782) and [#923](https://github.com/jimmie-potts/agent-device-hub/issues/923) build the tracker and inbox rules with their tests |
| Safe errors | The [safe-error rules](development.md#safe-error-rules); the kit's secret and record checks (`checkModuleRecord`); runtime `safe-errors.test.ts`, `log.test.ts` and the gateway tests' token scan; scenario `runner.test.ts`; verify `supervisor.test.ts` and `adapter.test.ts` | [The lint misses](development.md#lint-misses-and-their-reasons): the Standards review |
| Correlation: `traceparent` on every message and call, trace IDs on every record | The profile 2.0 validator in `v2.test.mjs`, the SDK tests and every kit check; the kit's `accepts` check (each record carries the command's trace); runtime `diagnostics.test.ts`, `context.test.ts` and `tracing.test.ts` | `traceparent` on HTTP calls other than the edge's: the Standards review |
| Recorded spans through the host adapter, with registered names | Runtime `tracing.test.ts` and `span-file.test.ts`; observability `host.test.mjs`; every kit check (no span loses its parent) | |
| Context stays inside B.U.N.N.Y. | SDK `trace.test.ts`; runtime `tracing.test.ts` (only authenticated context continues); the kit's outbox check (a replay is linked, never reparented); LIFX `module.test.ts` (no trace context to the bulb) | No trace context to other devices: each module story. No span open across downtime: the Standards review |
| Records at decision points, once | The kit's `accepts` and `refuses` checks (the bus's records); SDK `diagnostics.test.ts`; runtime `isolation.test.ts` and `lamp.test.ts` | Tracker steps: #782. A catch that only passes an error on logs nothing: the Standards review |
| Levels | SDK `diagnostics.test.ts` (each registry code's level); runtime `process.test.ts` and `core.test.ts` | A module record's level: the kit checks its event and attributes only, so the Standards review |
| Repetition: transitions, then bounded summaries | Runtime `isolation.test.ts` (a dropped delivery at once, then a count a minute); SDK `availability.test.ts`; each module's outage and polling tests | One degradation and one recovery per outage: each module polls its own way, so each module story tests it, as every shipped device module does |
| Logs are not history | `checkModuleRecord` (registered attributes only); the kit's outbox check (one publication record) | A payload in a registered attribute: the Standards review |
| Bounds | SDK `diagnostics.test.ts` (a throwing callback changes no result); runtime `log.test.ts`; the observability package's tests | Request and trace IDs as metric labels: there are no metrics before #813 |
| Telemetry is never acknowledged; loss is visible | Runtime `log.test.ts` and `tracing.test.ts` (`runtime.stopped` counts what was lost) | |
| Following one request | Verify `follow.test.ts` and `supervisor.test.ts`; capture steps `follow-one-request` and `control-follow-fails` | |

#### Lint misses and their reasons

The safe-error rules read syntax only, so they cannot follow a value through
code. #954 added checks for five misses at the coordinator's request, beyond
the owner's scope note on #954, which gave known misses a stated reason unless a
real finding needed a check. Each has an invalid case in
`tests/strict_profile.test.mjs` that fails without it. The rest stay unchecked
for these reasons:

| Miss | Status | Reason |
| --- | --- | --- |
| `stdout` or `stderr` destructured from `process`, and `globalThis.process` | Checked (`no-console`) | |
| ``String.raw`${error}` `` | Checked (`no-raw-error-text`) | |
| `[label, error].join()` and `'failed: '.concat(error)` | Checked on array literals and string literals | A variable's `join` or `concat` may be an array's, which keeps the value whole; a syntax rule cannot tell |
| Any other tag | Not checked | The tag decides what it does with each value |
| An own error class whose message carries input | Not checked | The rule cannot see what a caller passes to the constructor. Nanoleaf's `ValueError` quotes input in `compat.ts` and `transport.ts`; its message never goes into a record or body (#844) |
| `process.emitWarning` | Not checked | Its only use is the SDK's default `onError`, with fixed text and the error as `cause`. The runtime passes its own `onError`, and every module's outbox gets its `log`, so the default never runs in the runtime. A check would need an exception for exactly those two files |
| Writes to file descriptors 1 and 2, an alias of `process`, `await import('node:console')` | Not checked | No covered code does this, and a syntax rule cannot follow an alias or a computed descriptor |
| An alias, a helper, a custom type guard, an untyped callback parameter, `any`, a computed member in an `instanceof` test, a reassigned narrowed binding | Not checked | Each needs data flow or type information that a syntax rule does not have |

<a id="depot-diagnostic-access"></a>
