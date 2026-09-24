## Context

A no-ID approval marker records that Codex asked for permission during a turn. Nothing can later match it to an answer. Explicit recovery (#185) handles one marker on the current turn of an uncertain session. When a session moves on, the owner retires the earlier turn, but attention on that turn stayed indefinitely.

## Decision

Codex cannot start a newer turn while a permission request blocks the current one, so a retired turn's no-ID approval was answered. `forgetRetiredApprovals` removes approvals whose ID is unknown and whose known turn is in `retiredTurns`. The reducer runs it after every reduction, which covers retirement during turn selection and late markers for retired turns. Owner startup and maintenance settle stored markers with the same `replace` commit that expiry uses. That commit advances the revision once and writes no journal row.

The rule deliberately uses only retirement evidence. A marker on a never-selected turn stays: with unordered hooks, that turn could be newer than the current one. Approvals with a request ID still wait for their matched resolution.

## Failure and recovery

A storage failure during settlement follows the owner's existing fault semantics. The attention-ambiguity marker that the approval set remains, keeping earlier uncertainty visible. A retired turn is remembered for the most recent 256 retirements; a marker on an evicted turn is no longer provably old and remains.
