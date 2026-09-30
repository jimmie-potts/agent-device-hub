## Context

See proposal.md. #610 proved one transient host response through the session bus; live listener ownership is still unknown. Existing wrappers accept argv and emit one JSON line. App units and timers belong to app-verify, not the command dispatcher. Security and interruption behavior require this design artifact under the schema's cross-cutting/security criteria.

## Goals / Non-Goals

Goals: opt-in routing from exact worktrees, explicit tool environment, bounded command lifetime, preserved adapter output, honest interruption/cleanup results. Non-goals: a permission limiter, generic shell runner, background broker, personal activation, build isolation within one checkout, device access or new receipt version.

## Decisions

Use a source-only Node entrypoint `scripts/verify-host.mjs`, exposed as `verify:host`. Require `--host --app <hub|nanoleaf|pixoo|compose> --checkout <absolute>` before `-- <existing operation and arguments>`. All single-app wrappers are `scripts/verify.mjs`; composition is `apps/hub/verify/compose.mjs`. Check package identity and file existence. Select Node 24.5+ from the calling `fnm exec --using=.nvmrc` environment; explicit optional absolute Python and fnm paths support consumers. No shell string or arbitrary executable option.

Connect the systemd client through the current user's explicit session-bus address, omitting XDG_RUNTIME_DIR for that client. Run `/usr/bin/env -i` inside the transient command to clear the manager environment, then set only required host/tool/cache values. The dispatcher does not import caller tokens, APP_VERIFY root overrides or Node preload options. Underlying checkout code is trusted, so these are hygiene measures, not sandbox enforcement.

Use random command-unit names, `--wait --pipe --collect`, KillMode=control-group, a default 900-second command bound (explicit 30–1800 seconds), and bounded stop/readback. Announce the unit before starting. Capture bounded output and return one JSON envelope containing the adapter result, command identity, original exit and cleanup status. A malformed/missing result or transport interruption is uncertain, even if the unit later disappears. No automatic start retry. A signal stops the command unit, but app units keep their own lease; reconcile through doctor/receipts and stop only identified runs.

Create a short exclusive scratch directory in the launcher's canonical ignored `.local/scratch` through a host helper. Set TMPDIR explicitly. A matching full command UUID owns the short directory; a collision fails rather than reusing it. ExecStopPost invokes only that helper's ownership-checked cleanup, including after SIGKILL. It uses literal quoted systemd words with expansion disabled. Read back directory absence separately from unit absence; failed or unreadable cleanup stays uncertain. A manager crash may retain scratch and requires exact-token recovery. Finalized proof and preview runtime temporary directories are separate.

Direct sandbox bus fallback was rejected as the complete route because it leaves host listener ownership unproven. Whole-session full access and a permanent broker are outside the accepted decision.

## Risks / Trade-offs

- Host authority exceeds Codex filesystem restrictions → explicit opt-in, clear contract, synthetic adapters, no enforcement claim.
- Start may create a preview before output is received → preserve uncertainty, named command evidence and existing discovery/lease recovery; no blind retry.
- Host runtimes/browser dependencies may be missing → fail honestly, document preparation, qualify in #613.
- Parallel builds in one checkout can change an existing run's artifact → distinct worktrees including composition consumers; one controller per run.

## Migration Plan

No installed setting changes. Build from the reviewed checkout, select the explicit route and record its result. Roll back by stopping owned runs and ceasing to select this route. Source tests exercise refusal, literal argv, environment, cleanup and uncertainty with deterministic supervisor fixtures; host/client/browser qualification remains #613.
