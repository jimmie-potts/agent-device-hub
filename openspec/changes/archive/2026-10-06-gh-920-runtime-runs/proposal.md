## Why

[Hub #920](https://github.com/jimmie-potts/agent-device-hub/issues/920) gives the new runtime tier 2 of the verification tiers (docs/sdlc.md "Acceptance review"): a disposable run that an independent Acceptance reviewer starts from any commit, with synthetic data and simulated devices, and uses as a person would. It is the tier 2 half of #846, whose scenario catalog and harness contract it reuses unchanged. Every later runtime story's Acceptance review depends on it. The runtime had no way to serve remote parts or to build its modules with simulated transports.

## What Changes

- **Launch options.** `--edge` mounts #883's `RemoteEdge` on the runtime's health listener once every module has started, with grants from a private `edge-grants.json` in the state directory. A grant may not act as the core or a module. `--simulate` builds every module from its factory with its simulated transport. `src/modules.ts` becomes the shipped factory list (empty today), and `runMain` takes the factories and the families the edge accepts beyond the modules' own.
- **The runtime adapter** (`apps/runtime/verify`, `npm run -s verify:runtime --`), on `@jimmie-potts/app-verify` unchanged:
  - a supervisor process that holds the simulated devices and runs the runtime as a forked child through its own entry, restarting a child that dies on its own;
  - a runtime child with the fixture modules, whose simulated transports reach the supervisor's devices over IPC;
  - a loopback harness API for the devices, the run's controls and the run's state;
  - a run adapter that implements the catalog's harness contract over that API and the SDK edge, with one capture step per catalog scenario;
  - three boundary checks, each with a start-only negative control.
- **Checks and docs.** `test:runtime:verify:built` runs in the App verification CI job; its lifecycle tests skip without a user manager (#873). docs/development.md, docs/app-verification.md, docs/sdlc.md step 2 and the runtime and adapter READMEs name the command.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `bunny-runtime`: health's routes leave room for the SDK edge; new requirements cover simulated modules and the SDK edge, and disposable verification runs.

## Impact

- **Source:** `apps/runtime/src` (`modules.ts`, `process.ts`, `runtime.ts`, `state.ts`, `launch.ts`, `index.ts`) and the new `apps/runtime/verify`.
- **Tests:** `apps/runtime/tests/edge.test.ts`, the process tests, and `apps/runtime/verify/tests`; the in-memory harness shares the reader and validator in `tests/scenarios/parts.ts`.
- **Commands and CI:** `package.json` (three scripts), `scripts/verify-runtime.mjs`, `.github/workflows/checks.yml` (one App verification step) and `tests/workflow_checks.cjs`.
- **Behavior:** a runtime started without `--edge` or `--simulate` behaves as before. Nothing is installed; delivery target: source-only.
