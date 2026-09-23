# Working on LIFX

These instructions apply to planning, edits and review in controllers/lifx.
Read this directory's [README.md](README.md) for current status and device
decisions. For planning or delivery, read the exact issue. Read
[architecture](../../docs/architecture.md) and linked contracts before changing
integration or ownership. All rules in the root [AGENTS.md](../../AGENTS.md)
remain in force, including delivery, privacy, unslop and physical authorization.

This directory contains documents only. Bootstrap completion grants no future
implementation, installation, LAN discovery or physical-testing authority.

Use direct LAN control with fake packets during source development. Home
Assistant and cloud accounts are not dependencies. Resolve the supplied "A16"
name before physical acceptance; do not assume an A19 model or unsupported
capabilities. Discovery and bulb traffic need explicit authorization and targets.

Consume the shared controller and agent-state contracts. Each configured bulb
has one designated writer and serialized queue. Preserve observation freshness,
partial/uncertain outcomes, cancellation and the approved manual-control/restore
policy. Do not create a second state reducer or infer visible success from an
acknowledgment.

Before adding executable behavior, define the issue-linked OpenSpec artifacts
and package build/type/test commands in [development](../../docs/development.md)
and CI. Run affected shared-consumer checks and the root workflow checks from
the assigned worktree on Node 24. Report source, installation, real-client,
transport and visible-device evidence separately.
