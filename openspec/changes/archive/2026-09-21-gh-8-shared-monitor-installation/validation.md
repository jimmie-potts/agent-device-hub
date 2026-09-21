# Source acceptance evidence

Node 24 local build/type checks, contract TypeScript/Python consumers,
lifecycle and agent-state consumers/packages, MCP transport/protocol/package,
hub and setup tests, reproducible offline hub package, workflow checks and
Linux isolated performance checks passed. The workflow coverage fixture was
updated to retain the new setup command alongside every previous suite.

Fourteen setup checks cover configuration conflicts, edited/duplicated/missing
ownership entries, bounded configurations, interrupted grant/revoke,
private-content dropping, silence/deadlines, consumer capability checks and
competing receipt claims. The duplicate-credential regression fails against
the previous authority implementation before passing with receipt binding.

The pinned Pixoo source check passes settings, source exit, fenced import,
facade/producer behavior, labels, notice acknowledgment, rollback after writes
and renderer continuity. The pinned combined Pixoo/Nanoleaf check passes
embedded credential revocation, setup across handoff, one identified event in
both projections, fenced writes, explicit legacy rollback and latest-state
rollback. Both use disposable state; physical participation is false.

The guide was regenerated with current issue scope and the candidate migration
sequence. Five maintenance tests and browser/print checks pass. Nine diagram
artifact deliveries pass. Standalone migration-viewer containment retains its
known vertical overflow limitation; the source guide records it explicitly.

This archive records completed source implementation, not hosted acceptance,
merge, personal installation, client-version qualification or physical results.
Those remain separate receipts. Final reviews and all five PR/main CI jobs
remain delivery gates recorded in the PR, outside this commit.
