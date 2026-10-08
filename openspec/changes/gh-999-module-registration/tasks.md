## 1. Registration

- [x] 1.1 Assert the shipped list's rules with synthetic registrations: the core first, `after` before `order` before name, an unshipped module left out, and a `core` name, a duplicate, an unknown or unshipped `after` and a cycle refused (`apps/runtime/tests/registration.test.ts`).
- [x] 1.2 Add `ModuleRegistration` and the simulation types to the SDK, and a registration to each device module.
- [x] 1.3 Write the registry at build time from `modules/*/package.json`, and build the shipped list from it; show the shipped order unchanged.

## 2. Harnesses

- [x] 2.1 Add the generic device link for disposable runs and drive every registered module through its registration in the in-memory harness, the supervisor, the child, the protocol, the adapter, the seeds and the plug-in; one schema list for both harnesses.
- [x] 2.2 Move the scenario framework to `framework.ts` and each module's scenarios and runs to `tests/scenarios/modules/<module>.ts`, which the catalog collects; show the same scenarios by name.
- [x] 2.3 Assert, with a throwaway module written only under its own folder, that the registry imports it, the shipped list places it, its scenario runs on both transports, and the link drives its device, refusing what it does not admit (`apps/runtime/tests/module-probe.test.ts`).

## 3. Checks and documentation

- [x] 3.1 Add the shared-file check with its negative control (`scripts/check-module-names.cjs`, `tests/workflow_checks.cjs`).
- [x] 3.2 Say how to add a module in the runtime README; update the verify README.
- [ ] 3.3 Run the gate, show the negative controls fail, and synchronize and archive the change.
