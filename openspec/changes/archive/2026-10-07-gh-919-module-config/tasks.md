## 1. SDK: module API 1.1

- [x] 1.1 Assert, red before the implementation, that worker calls resolve, end at their deadline on a manual scheduler, are cancelled by the module's stop and by their own signal, keep a worker's failure to the call, cap concurrent calls and refuse a malformed deadline (`packages/sdk/tests/workers.test.ts`).
- [x] 1.2 Assert that `checkConfiguration` accepts a module's own section with its devices and secrets, and refuses a missing section, a non-object, malformed secrets, a refusing or throwing `configure` and invalid devices (`configuration.test.ts`).
- [x] 1.3 Add `configure` to the manifest, `config`, `secrets`, `files()` and `workers.call` to the context, `checkConfiguration`, `WorkerCalls`, and `MODULE_API_VERSION` `1.1`.

## 2. Module test kit

- [x] 2.1 Assert, red before the implementation, that the kit fails a module whose start waits on its device (only the offline check), a configuration the module refuses or lacks (every check), and a secret in a record, a message or a reply (the checks that see it, never quoting it), and that the harness serves named secrets from memory and a private folder (`kit.test.ts`).
- [x] 2.2 Add `config`, `secrets` and `offline` to the spec, the offline check, the configuration check in the manifest check, the secret scan, and the harness's section, secrets, folder and worker calls.

## 3. Runtime

- [x] 3.1 Assert, red before the implementation, each module's own section, secrets and folder; refusals in health for a missing or invalid section, a throwing `configure`, a duplicate device and an unsafe secret file; secret re-checks; an untrusted configuration file refused before serving; private folders; worker calls on the runtime's scheduler; `NODE_OPTIONS` kept; and no secret in a record, health or an error body (`apps/runtime/tests/config.test.ts`).
- [x] 3.2 Read the private configuration file (`--config`), admit modules in list order, read secrets with #880's rules, create private folders, merge `NODE_OPTIONS`, and drop records holding a secret a module read.
- [x] 3.3 Assert the shipped entry point's `config-*` codes and a valid file, and move the API version test to `1.1` (`process.test.ts`, `manifest.test.ts`).
- [x] 3.4 Reword the isolation test's header and start-timeout title under policy A (#948, PR #955).

## 4. Fixture sign and scenario tiers

- [x] 4.1 Add the configured fixture sign with its render worker; it passes the kit with the offline check, and under the runtime starts while offline, reports `unavailable`, then `available` (`sign.test.ts`).
- [x] 4.2 Add `configured-module` and `misconfigured-module` to the catalog with a seed `config`, written by `writeConfiguration`, and play them in the in-memory harness on both transports.
- [x] 4.3 Seed configured runs under `<data>/config`, pass `--config` from the supervisor, reach the simulated signs over IPC, and scan every capture step's proof and runtime records for the synthetic token (`verify/tests/steps.test.ts`).

## 5. Documentation and qualification

- [x] 5.1 Document the module API, secrets, worker calls and policy A check in the SDK README, configuration in the runtime README, and configured runs in the verify README.
- [x] 5.2 Run build, typecheck, lint, the SDK, runtime, scenario, verify, event and workflow checks, and OpenSpec validation.
- [x] 5.3 Show negative controls fail named tests: another module's section or secret readable, a linked or world-readable configuration file, a secret in a log, the policy A check removed, and a worker call not cancelled on stop.
- [x] 5.4 Synchronize the affected specifications and archive the change.
