## Context

The core starts each run as `app-verify-<run id>.service` under the user manager, so the user manager already knows every live run on the host. The Hub's test suites start runs side by side on purpose, and some spawn a wrapper script directly. Nanoleaf and Pixoo vendor the core and own their wrappers.

## Goals / Non-Goals

**Goals:**
- A second `start` through any Hub wrapper is refused while a run is live, and the live run is untouched.
- Concurrent starts in the test suites keep working.
- A stale or failed unit never blocks a start.

**Non-Goals:**
- Guarding Nanoleaf's and Pixoo's wrappers; they opt in when they vendor this core.
- A new exit code, receipt field or registry code.

## Decisions

- **An environment variable, set by the package scripts and the host route.** `APP_VERIFY_SINGLE_RUN=1` opts a `start` in. A flag would have to be typed on every command, and an option in the wrapper's code would also guard the suites that spawn the wrapper directly. Rejected: both.
- **Units are the evidence.** The core lists `app-verify-*.service` and counts an `active (running)` or `activating` unit whose name is a run id. A failed or stopping unit, a lease or thaw timer or its service, and the host route's `app-verify-command-*` unit are not runs. A live unit with a stale receipt counts, because it holds memory; the refusal names it and `stop` ends it. Nothing blocks forever: a unit that is not live is ignored, and a live one has a lease.
- **Refuse before the try block.** `start` throws the refusal after the manager check and before it creates anything, so the line is a refusal with `errorBody`, not a failed start with a receipt. `restart` replaces a run and never passes the option.
- **`capacity`, retryable.** The registry defines it as the target being busy; a retry after the run stops succeeds.
- **A composition is one run.** `verify:compose` holds the slot for the whole composition with additive exports of the core (`holdSingleRun`, `SingleRunRefused`, with `liveRuns` and `runActiveDetail`) and removes the variable from the environment of the runs it starts, because the Hub's own wrapper would otherwise refuse for the consumers before it. Its refusal keeps the composition's 1.x line until #839.
- **A start claim closes the race.** A run has no unit until its build and seed steps finish, so two starts begun together would both see an empty host. A guarded start first takes `app-verify-start-claim.service`, a transient unit that lives while the starting process does; `systemd-run` refuses a name that exists, so the second start is refused. The unit watches its holder's PID, so a killed start leaves it for about a second, and `RuntimeMaxSec=1800s` ends it in any case. The claim is taken before the units are read, so no other guarded start is between its check and its unit. Rejected: a lock file, which needs a location every adapter agrees on and its own stale-holder logic, and a check after the unit exists, which loses the clean refusal.
- **Fail open when the claim or the list cannot be made.** A manager that answered `running` but cannot create the claim or list units is rare; the start goes ahead and says so on stderr.
- **Tests scope the guard.** Another session may have a run live or a start in flight while the suite runs, so each guarded test command runs with a `systemctl` and `systemd-run` on PATH that list only its own sandbox's runs and take a claim of their own; the real listing is exercised directly through `liveRuns`.

## Risks / Trade-offs

- [A claim outlives a killed start] → It names the starting process and goes within about a second of its death; `RuntimeMaxSec` bounds it at 30 minutes, longer than a build step's own 15-minute limit.
- [The claim is one more unit on the host] → It is named `app-verify-start-claim`, which is not a run id, so it never counts as a run and `doctor` ignores it.
- [A wrapper started with `node scripts/verify.mjs` directly is not guarded] → The documented entry points are the package scripts and the host route; the suites rely on the unguarded direct form.
- [A run another session holds blocks this one] → Intended: one run at a time per host. The refusal names the run, and the procedure says to wait or ask its owner.
