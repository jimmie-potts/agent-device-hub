## Context

See proposal.md for the owning issue and outcome. At pickup, Hub source
`81433bc773dd449f614515bfb8aab18d2ce6b510` contains one closeout engine, full
runtime receipt validation, independent acceptance assessment, native graph
discovery, canonical recommendation updates and durable effect reconciliation.
Only the selected repository, runtime and portfolio assumptions are fixed to Hub.
The existing package and disposable fixtures cover those paths.

This change remains aligned with local ownership and the accepted one-host serial
supervisor. Complexity is medium, impact high because closeout writes acceptance,
and uncertainty is bounded to the owning proof interfaces coordinated with the
two tool-adapter writers. Design is required for the trust and receipt boundaries.

## Goals / Non-Goals

**Goals:** preserve one closeout implementation and make its supported owning
policies explicit. Keep runtime, installed files, client and physical proof distinct.

**Non-Goals:** a plugin loader, new installation engine, arbitrary repositories,
expanded Project membership, additional model rounds, or an activation pilot.

## Decisions

- A fixed policy table maps the configured repository to its runtime or tool
  proof validator, acceptance references and tracker effects. The request and
  receipt must match it; no model-selected policy or dynamically loaded code.
  Copying closeout into each repository would duplicate the existing guards.
- The planner reads fingerprinted shared reconciliation instructions and the
  selected repository's owning instructions. Current source and public issue
  acceptance remain the decision inputs. Private installation contents never
  enter a model prompt or public receipt comment.
- Runtime profiles reuse `install-receipt/1.0` without a schema change. Tool
  profiles use `installed-files/1.0`, a full owning plan/readback and trusted
  installation-configuration binding. Validate the original JSON with the pinned
  Python tool for the producer's canonical digest; JavaScript reserialization
  can lose float or Unicode representation. This adds no external dependency.
- Hub, Nano and Pixoo may project Done only onto existing B.U.N.N.Y. items under
  the current portfolio policy. Tool profiles preserve labels and omit portfolio
  access/effects. No profile adds memberships, Phase or Commitment.
- Keep Hub's existing journal identity compatible, namespace additional
  repositories and reject stored identity conflicts. Preserve guarded writes,
  original deadline, read-only reconciliation and ambiguous-effect behavior.

## Risks / Trade-offs

- A valid installation receipt alone cannot discharge client or physical
  acceptance → retain the current independent full-body assessment and tests.
- Tool proof could claim broader path authority → validate exact owning shapes,
  fixed protected paths and the trusted configured path/configuration bounds.
- Related work may change during closeout → retain fresh selected and affected
  record comparisons, retained intent and authoritative readback.
- Active installer, skill or supervisor changes could alter a running delivery
  → keep their existing stopped-boundary policy and refuse unsupported proof.

## Migration Plan

The coordinator installs the reviewed package at the existing supervisor tool
location after merge and main CI, verifies its complete manifest, and updates
only the selected trusted profile configuration. Existing Hub configuration and
source-only exceptions retain their meanings. A failed qualification leaves
the previous pinned package/configuration in place. Scheduling and the existing
real delivery remain separately owned; this implementation performs neither.
