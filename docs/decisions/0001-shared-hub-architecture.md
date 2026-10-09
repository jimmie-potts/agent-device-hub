# ADR 0001: Shared agent status with existing device controllers

Current applicability: this is the original bootstrap decision. ADR 0003 revised
repository ownership, and [ADR 0012](0012-bunny-event-platform.md) superseded
Pixoo-first hosting and the separate-process target with one TypeScript runtime.
The accepted [#840 cutover](https://github.com/jimmie-potts/agent-device-hub/issues/840)
records deployment. The text below preserves the original rationale and scope;
its "pending" and Windows-worker statements are historical, not current setup.

Status: Accepted direction; implementation pending.

The repository-boundary decision below is superseded by
[ADR 0003](0003-device-controller-monorepo.md). New controllers start in the hub
monorepo; existing source moves remain deferred. Pixoo-first state hosting,
runtime ownership and physical migration boundaries remain in force.

The user approved documenting and planning the shared hub and initializing this
repository. Adopt [architecture.md](../architecture.md) as the canonical
cross-repository ownership and migration decision.

Implement one reusable agent-state core and versioned provider/controller
contracts. Initially embed the core in Pixoo; introduce standalone hosting only
through an explicit state-owner migration. Retain Nanoleaf's Windows worker and
both device repositories. Keep provider interpretation, device rendering and
MCP/UI commands behind their documented boundaries.

A shared overview is an early client of those contracts. Exact rendering,
advanced-editor migration, Home Assistant adoption and any repository
consolidation remain separately qualified or deferred.

The initial bootstrap and issue publication establish plans only. They neither
change installed behavior nor satisfy the future integration acceptance criteria.
