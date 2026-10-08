## Context

Every runtime module story edits the same shared files: the shipped list, the scenario catalog, the in-memory harness, the disposable-run supervisor, its child and protocol, the run adapter, the seeds and the plug-in, then the root scripts, CI, `docs/development.md` and the shared `bunny-runtime` spec. Module PRs therefore merge one at a time and rebase repeatedly ([#999](https://github.com/jimmie-potts/agent-device-hub/issues/999)). ADR 0012 keeps the module list fixed and shipped with the runtime, and a module imports only the SDK and the contracts packages; the `bunny/module-boundary` lint rule enforces that for every file under `modules/<name>/`, tests included.

This change is a refactor. The shipped order, every scenario, every message format and every module's behavior stay as they are. It is delivered in two slices: runtime and harness registration (this branch), then build, CI, docs and specs (`codex/gh-999-module-build`).

## Goals / Non-Goals

**Goals:** a module declares how it is built, ordered, configured for simulated runs and simulated in the harnesses; the runtime and both harnesses collect those declarations instead of naming modules; the core stays first by an explicit, tested rule; one schema list serves both harnesses; a check fails when a shared file names a device module.

**Non-Goals:** loading modules at run time; changing which modules ship or their order; changing a scenario's steps; converting the fixture modules (lamp, chime, sign) or the core, which the shared files may keep naming.

## Decisions

### A module's registration

`@jimmie-potts/sdk` gains `ModuleRegistration`, which a module exports as `registration` from its package entry (`src/registration.ts`). It needs only the SDK, so the module boundary holds:

- the factory the runtime already used: `name`, `create`, `simulate`, `schemas` and `simulatedSection`;
- `shipped`, and its place: `order`, a number (lower starts first), and `after`, the modules that must start before it;
- `registerFamilies`, optional, which registers the module's families on a validator with any checks beyond their schemas (LIFX's envelope checks); without it a harness registers `schemas` as they are;
- `simulation`, optional: how the harnesses simulate its devices (below).

`ModuleFactory` moves to the SDK as the factory part, and the runtime re-exports it.

### The runtime collects registrations at build time

`apps/runtime/build/registry.ts` lists `modules/*/package.json`, in folder order, and writes `dist/src/registry.js`: one static import of each package's `registration` and the array of them. `src/registry.d.ts` types that file, so typechecking and linting need no generated source, and the generated file is build output under `dist/`. The runtime still imports every module statically and loads nothing at run time; the shipped set is whatever `modules/` held at build time, as ADR 0012 requires. The root build runs the writer right after the runtime's `tsc`. Alternatives rejected: a hand-kept list of imports, one line per module, which every module story still edits; a generated source file, which an editor or `tsc` on a fresh checkout cannot resolve until something generates it.

### The shipped order, with the core first

`shippedModules` is the core's factory followed by every shipped registration, ordered by `after` first and then by `order` and name (a topological sort that always takes the lowest ready `order`). The core is not a registration: it comes first by construction, because a queued action ends `cancelled` at a clean stop only when the core closes first, and device modules that sync from it at their start must find it listening. A registration named `core`, two with one name, an `after` that names no shipped module, and a cycle each throw when the list is assembled, which every runtime test does at import. The current order maps to `playback` 100, `lifx` 200, `tidbyt` 300, `pixoo` 400, `nanoleaf` 500 and `codex-desktop` 600. Tidbyt and Pixoo also declare `after: ['playback']`, whose record they follow from their start. A new module picks a free number; a tie is broken by name, so it is never ambiguous.

### Harnesses drive simulated devices through the registration

`simulation` names the device's `actions`, an optional `admits` check for an action's other fields (the playback speaker kinds, a LIFX address, the Codex Desktop thread list), and two halves:

- `memory`: in the in-memory harness, `create` the simulated device on the harness's clock and scheduler, read its `state`, `act` on a simulation and `build` the module on it.
- `run`: in a disposable run, the supervisor holds what outlives a runtime (`create`, `state`, `act`, `serve`), and the runtime's process builds the module with `remote(link)`, whose transport reaches the supervisor over the child's IPC channel. `link.call(method, args, signal)` answers `answered`, `failed` or `abandoned`; an aborted call tells the supervisor, which aborts its own signal; a runtime that ends aborts its calls. `push` hands a simulation to the runtime's process, and `handover` gives the next runtime what the last one left, so the Pixoo, whose simulated device lives beside its module, keeps its picture across a restart as it does now.

The in-memory harness, the supervisor, the child, the protocol and the run adapter keep code only for the core and the fixture modules, and treat every registered module through these members. A simulation request is checked by its device's `actions` and `admits` in both tiers. The supervisor's state document keys each device by its module's name, so the Codex Desktop marker's key becomes `codex-desktop` (it was `codexDesktop`).

### One schema list

`SCENARIO_SCHEMAS` is the fixture families' schemas plus every registration's `schemas`, and both the in-memory harness and the disposable run's child take it (PR #1004's note: the child's copy drifting made `stand-in-history` answer 404). The scenario validator registers the core and device families, the fixture schemas and each registration's families through `registerFamilies` or its `schemas`.

### Scenarios in a per-module file the catalog collects

The scenario framework (the harness interface, steps, the runner and the helpers scenarios share) moves to `tests/scenarios/framework.ts`. The core's and the fixture modules' scenarios stay in `catalog.ts`. Each device module's scenarios, and any disposable run of its own such as `pixoo-migrated`, move to `tests/scenarios/modules/<module>.ts`, and the catalog imports every file in that folder when it loads. They stay in the runtime's tests rather than the module's folder: the module boundary covers every file under `modules/<name>/`, while scenarios need the runtime's harness and sometimes another module (the Tidbyt follows the playback record). Adding a module adds its file without editing the catalog. The catalog lists the core's scenarios first, then each module file's, in file-name order: the same scenarios by name in a new order.

### Checks

- `scripts/check-module-names.cjs` lists the shared files and fails when one names a device module, by any spelling of a folder name under `modules/` (a hyphen, a space or none, in any letter case). The core and fixture modules live elsewhere, so they are not names. `tests/workflow_checks.cjs` runs it on the repository and on a scratch copy with one name added, which must fail.
- A throwaway fixture module, written under its own folder in a scratch directory, shows that the registry writer imports it, that the shipped list places it when it declares itself shipped and leaves it out otherwise, that its scenario runs in the in-memory harness on both transports, and that the disposable run's link machinery drives its device with no per-module code.

### Slice 2 (build, CI, docs and specs)

Each workspace declares its own `build`, `typecheck` and `test` scripts; the root runs them through one script that orders workspaces by their declared workspace dependencies, so `modules/*` can be a glob. CI runs every module's suite through one aggregate step, so `checks.yml` and `tests/workflow_checks.cjs` name no module, and each suite still runs once. Per-module check notes move to each module's README, `docs/development.md` keeps one "Module checks" section, and the shared `bunny-runtime` requirements describe the mechanism while each module's spec keeps its behavior. The shared-file check then covers those files too.

## Risks / Trade-offs

- The generated registry exists only after a build: running the runtime from `dist/` without `npm run build` fails at import, naming `registry.js`. Every runtime command already requires a build.
- Moving the module scenarios makes slice 1 large, mostly moved lines; `git diff --color-moved` shows them as moves.
- The catalog's order changes, so a capture step list reads differently; each scenario runs in a fresh harness, so no result depends on the order.
- The supervisor's device-state key for Codex Desktop changes, as above; only the run adapter and its tests read it.
- The scenario validator now also lets the in-memory harness's gateway read the LIFX families, as the shipped runtime's gateway always did.

## Migration Plan

None: source only. The shipped runtime is built from the same modules in the same order.

## Open Questions

None.
