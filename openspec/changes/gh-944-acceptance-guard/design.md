## Context

The core starts each run as `app-verify-<run id>.service` under the user manager, so the user manager already knows every live run on the host. The Hub's test suites start runs side by side on purpose, and some spawn a wrapper script directly. Nanoleaf and Pixoo vendor the core and own their wrappers.

## Goals / Non-Goals

**Goals:**
- A second `start` through any Hub wrapper is refused while a run is live, and the live run is untouched.
- Concurrent starts in the test suites keep working.
- A stale or failed unit never blocks a start.

**Non-Goals:**
- A lock between two starts begun at the same moment.
- Guarding Nanoleaf's and Pixoo's wrappers; they opt in when they vendor this core.
- A new exit code, receipt field or registry code.

## Decisions

- **An environment variable, set by the package scripts and the host route.** `APP_VERIFY_SINGLE_RUN=1` opts a `start` in. A flag would have to be typed on every command, and an option in the wrapper's code would also guard the suites that spawn the wrapper directly. Rejected: both.
- **Units are the evidence.** The core lists `app-verify-*.service` and counts an `active (running)` or `activating` unit whose name is a run id. A failed or stopping unit, a lease or thaw timer or its service, and the host route's `app-verify-command-*` unit are not runs. A live unit with a stale receipt counts, because it holds memory; the refusal names it and `stop` ends it. Nothing blocks forever: a unit that is not live is ignored, and a live one has a lease.
- **Refuse before the try block.** `start` throws the refusal after the manager check and before it creates anything, so the line is a refusal with `errorBody`, not a failed start with a receipt. `restart` replaces a run and never passes the option.
- **`capacity`, retryable.** The registry defines it as the target being busy; a retry after the run stops succeeds.
- **A composition is one run.** `verify:compose` checks once with two additive exports of the core (`liveRuns`, `runActiveDetail`) and removes the variable from the environment of the runs it starts, because the Hub's own wrapper would otherwise refuse for the consumers before it. Its refusal keeps the composition's 1.x line until #839.
- **Fail open when the list cannot be read.** A manager that answered `running` but cannot list units is rare; the start goes ahead and says so on stderr.
- **Tests scope the listing.** Another session may have a run live while the suite runs, so each guarded test command runs with a `systemctl` on PATH that lists only its own sandbox's runs; the real listing is exercised directly through `liveRuns`.

## Risks / Trade-offs

- [Two starts begun within the same build, seed and lease steps both pass] → The check reads units, which exist only after those steps. The guard stops a second start beside a serving run; it is not a lock. Documented in the README.
- [A wrapper started with `node scripts/verify.mjs` directly is not guarded] → The documented entry points are the package scripts and the host route; the suites rely on the unguarded direct form.
- [A run another session holds blocks this one] → Intended: one run at a time per host. The refusal names the run, and the procedure says to wait or ask its owner.
