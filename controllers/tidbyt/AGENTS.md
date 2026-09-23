# Working on Tidbyt

These instructions apply to planning, edits and review in controllers/tidbyt.
Read this directory's [README.md](README.md) for current status and device
decisions. For planning or delivery, read the exact issue. Read
[architecture](../../docs/architecture.md) and linked contracts before changing
integration or ownership. All rules in the root [AGENTS.md](../../AGENTS.md)
remain in force, including delivery, privacy, unslop and physical authorization.

This directory holds the in-process cloud controller package from #16; the
README describes its boundaries. Bootstrap or source delivery grants no status
integration, installation, account access or physical-testing authority.

Use the official Tidbyt cloud first. Keep 64×32 rendering independent of backend
authentication, capabilities and transport. Consume shared state and controller
contracts; do not copy a provider reducer or create another common API. Every
write uses the same designated controller queue.

Build and test cloud behavior with fakes, and record unsupported or unknown
behavior. Contact the real account only with the user's explicit go-ahead and
where an issue allows it: one test push in #16, then installation in #21.
Tronbyt connection work requires its own issue. Firmware flashing, server
installation and physical transition require separate explicit authorization,
confirmed device generation and an identified target. Never infer that changing
a URL switches stock firmware, or enable automatic backend failover.

Before adding executable behavior, define the issue-linked OpenSpec artifacts
and package build/type/test commands in [development](../../docs/development.md)
and CI. Run affected shared-consumer checks and the root workflow checks from
the assigned worktree on Node 24. Report fake-backed source checks separately
from what was seen on the real device.
