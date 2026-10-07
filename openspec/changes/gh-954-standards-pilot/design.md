## Context

Each fix sits in development tooling: the module test kit, the runtime's verification adapter, the app-verify core's one-run guard, lint rules and packaging scripts. None changes the runtime, a module or a message. ADR 0012's "Errors, effects and outcomes" and "Observability" set the rules the checks enforce.

## Goals / Non-Goals

**Goals:** catch the single-family sync fault in every module suite; make a run's health honest; bring the verification harness under the safe-error rules; make a claim release safe when it cannot identify its claim.

**Non-Goals:** fix modules (each module story owns its behavior); let a `shipped` run drive its modules' simulated devices; change the app-verify contract.

## Decisions

- **The kit check runs only for more than one served family.** With one family, the existing serves check already syncs it alone. Each module keeps its description, so the concurrent module stories' suites change only by gaining the check.
- **Health is judged in the plug-in, not the core.** The core reports the probe as `doctor`'s health and requires it for `start`. Judging the document in the runtime adapter's probe fixes `doctor` without a contract change. The cost is that `start` now waits for every module to run, as the in-memory harness already requires; the seed's expected refusals keep `misconfigured-module` and the two shipped controls starting, and the controls still fail at their own boundary check.
- **The run adapter converts, not excepts.** Its failure reports reach a capture's proof, one of ADR 0012's surfaces, and the conversion is small: an own error class for its fixed text, the SDK's `errorType` and an `SdkError`'s registry code.
- **The release stops nothing when unsure.** The claim's own loop ends it about a second after its holder exits, so the cost of not stopping is a short wait for the next start; stopping by name could end another start's claim.
- **The shipped run's harness limits are documented rather than removed.** Its modules create their simulated devices inside the runtime, and driving them would need a new channel from the supervisor into each module.

## Risks / Trade-offs

- A `start` whose runtime has an unexpectedly failed module now fails with `readiness-timeout` after the readiness deadline, naming the module, instead of starting a degraded run. That is the intended behavior: the in-memory harness refuses the same scenario.
- The lint checks stay syntax-only; the misses they cannot see are listed with reasons in `docs/development.md`.

## Migration Plan

None: development tooling only, and nothing is installed.

## Open Questions

None.
