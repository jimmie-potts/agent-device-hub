## Context

Automation engines validate and save settings in the core's private SQLite database. The core transaction owns history and outbox publication. The engines also keep in-memory evaluator and scheduler state.

## Decisions

- Read current definitions from the automation owners. A bounded table records each current entity's latest published revision. Earlier definitions and defaults without a revision start at zero. Opening the store writes no definition facts. The legacy power-window split still completes before routines are served.
- Save the owner data and each effective edit's fact in the same transaction. Compare projected definition content before publishing so repeated saves cannot add confirmation spans. Install evaluator changes after the core verifies the commit and before the outbox sends. The outbox retains refused publications with their original identity and trace. A failed commit rolls back the owner write, revision, history and outbox together.
- Use the existing profile removal and each definition's stable ID. Allowlist owner definition members. Keep scheduling and execution bookkeeping private.

## Late secret registration

The owner checks definition values with the runtime's live registry before
commit and before exposing a current snapshot. A module can register a
value after a definition commits but before its first successful publication.
The core checks the four automation state schemas again before each outbox
send, including restart. The opt-in SDK policy settles a protected state as
discarded and reports a fixed refusal. An ordinary send refusal would keep
retrying the protected envelope and hold up later messages. A success return
would count it as delivered. The discard preserves owner rows and history
and lets admissible rows continue in order. The HTTP and MCP history readers
check the selected automation rows against the same registry before serving a
page. Private history remains available to its owner.

## Migration and recovery

The new revision table is additive. Current definition rows and occurrence guards keep their existing format. The source check opens populated legacy fixtures, forces a transaction failure and reopens an edited store. Return to an older release still requires the runtime upgrade procedure's recovery assessment.
