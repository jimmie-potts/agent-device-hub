## Context

See `proposal.md`. The manual shell bounds the entire read-only post-start checker, including repeated release inventories, protected-input checks and HTTP reads. The parser currently caps that process at sixty seconds.

## Goals / Non-Goals

Permit a finite attempt long enough for the actual release while retaining the exact plan, lock, validation and failure rules. Automatic service retries, weaker release checks and a new installation procedure are outside this correction.

## Decisions

Raise only the allowed per-attempt maximum to 180 seconds. The measured source pass alone consumes about eighty seconds over four calls; this permits a request with margin for the remaining observations. Stop limits, attempt count and intervals stay unchanged. The operator still chooses the actual bounds before effects; changing them invalidates the old approved plan.

Increasing this finite observation limit keeps the existing validation intact. Caching or removing repeated checks would require new drift guarantees and is unnecessary for this correction. An unbounded checker would lose the existing failure limit.

## Risks / Trade-offs

A larger selected timeout can delay a failure result. The request explicitly binds the timeout and finite attempt count; the operator sizes them before execution and retains unsuccessful attempts. Exhaustion still invokes only the named qualified recovery. No credential, retention, migration, module or service behavior changes.

## Migration Plan

Review and merge the operator correction, verify merged-revision CI, then prepare a fresh first-adoption plan with the revised bound. Retain the original approval as historical evidence. Obtain approval for the revised initial trial before effects; routine upgrades continue under their applicable standing authority after installed qualification.
