## Context

The engine persists calls before effect dispatch. Run settlement, startup reconciliation and the private message store share a database transaction. A task may be resumed explicitly after an uncertain call settles.

## Decisions

Save an optional approved-action description with the private tool receipt inside the existing reservation. Derive the outcome from the matching dispatch result and any later correlated evidence. Existing receipts missing new fields retain a conservative fallback.

Write the closing reply at settlement, within the same transaction as the status and shared-session publication. Give the reply a stable identity scoped to the turn's settlement so startup and late results cannot duplicate it. Preserve explicit refusals and limit explanations, and keep success replies on their existing path. The fallback performs no external work.

## Risks

A tracked acceptance can precede device transmission or observation. Report acceptance alone unless a correlated record establishes a stronger outcome. Private message text stays out of shared state and diagnostics.
