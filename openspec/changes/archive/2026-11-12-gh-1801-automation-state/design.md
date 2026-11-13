## Context

Automation engines validate and save settings in the core's private SQLite database. The core transaction owns history and outbox publication. The engines also keep in-memory evaluator and scheduler state.

## Decisions

- Read current definitions from the automation owners. A bounded table records each current entity's latest published revision. Earlier definitions and defaults without a revision start at zero. Opening the store writes no definition facts. The legacy power-window split still completes before routines are served.
- Save the owner data and each effective edit's fact in the same transaction. Compare projected definition content before publishing so repeated saves cannot add confirmation spans. Install evaluator changes after the core verifies the commit and before the outbox sends. The outbox retains refused publications with their original identity and trace. The transaction requires the outbox insert, exact retained fact and matching history metadata before commit. A failed commit rolls back the owner write, revision, history and outbox together.
- Use the existing profile removal and each definition's stable ID. Allowlist owner definition members. Keep scheduling and execution bookkeeping private.

## Late secret registration

The owner checks the identity and protected values of the outgoing fact before
staging it. A removal sends only the entity identity and deletion metadata. A
module can register a value after the fact commits. Before each send, the core
checks the four automation state families and standard rule and routine
removals against the live registry.

A discard skips transport and is settled in an outbox-owned transaction. A
transport refusal would keep the protected envelope pending ahead of later
messages. A success return would count it as delivered. A discard leaves
committed owner rows and private history intact. The gateway refuses protected
values in a kept family copy, and a fresh sync reflects committed deletions.
Public HTTP and MCP history reads check the selected automation rows against
the same registry. The optional discard diagnostic follows commit and can be
lost if the process stops between commit and notification.

## Migration and recovery

The new revision table is additive. Current definition rows and occurrence guards keep their existing format. The source check opens populated legacy fixtures, forces a transaction failure and reopens an edited store. Return to an older release still requires the runtime upgrade procedure's recovery assessment.
