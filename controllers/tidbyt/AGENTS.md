# Working on Tidbyt

These instructions apply to planning, edits and review in controllers/tidbyt.
Read the root [AGENTS.md](../../AGENTS.md), this directory's [README.md](README.md)
and the exact issue before work. Read [architecture](../../docs/architecture.md)
and linked contracts before changing integration or ownership. Root delivery,
privacy, unslop and physical authorization rules remain in force.

This directory contains documents only. Bootstrap completion grants no future
implementation, installation, account access or physical-testing authority.

Use the official Tidbyt cloud first. Keep 64×32 rendering independent of backend
authentication, capabilities and transport. Consume shared state and controller
contracts; do not copy a provider reducer or create another common API. Every
write uses the same designated controller queue.

Qualify cloud behavior with fakes and record unsupported/unknown evidence.
Tronbyt connection work requires its own issue. Firmware flashing, server
installation and physical transition require separate explicit authorization,
confirmed device generation and an identified target. Never infer that changing
a URL switches stock firmware, or enable automatic backend failover.

Before adding executable behavior, define the issue-linked OpenSpec artifacts
and package build/type/test commands in [development](../../docs/development.md)
and CI. Run affected shared-consumer checks and the root workflow checks from
the assigned worktree on Node 24. Report source, installation, real-client,
transport and visible-device evidence separately.
