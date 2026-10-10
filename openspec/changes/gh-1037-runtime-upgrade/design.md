## Context

See proposal.md for motivation. The established service directly names a retained
release checkout; mutable state and configuration already live outside that
checkout. Current build identity is available through /api/v2/build. The shared
install contract predates apps/runtime and specifies immutable releases, atomic
selection, trusted provenance, compatible latest-state recovery and private
receipts. Pure file/atomic-write helpers can be reused; its retained Hub service,
artifact verifier and orchestrator cannot operate this installation.

## Goals / Non-Goals

**Goals:** One manual operator path for the established installation, with
enforced pre-effect refusals and evidence sufficient to distinguish completed,
refused, interrupted and recovered operations.

**Non-Goals:** A deployment platform, new service owner, data conversion or device
command path. The installer neither activates unselected modules nor replaces
the existing configuration, hook, Node executable or state directories.

## Decisions

Use one private installation root with releases/<merged-sha>, current,
provenance, receipts, backups and install.lock. The current link is the single
routine publication boundary. First adoption installs one owned service override
through that anchor after stopping the named owner. Repeated unit rewriting was
considered but adds configuration mutation to every upgrade. The contract delta
explicitly maps receipt runtime=hub to the successor installation with a distinct
installationId; no receipt schema extension is needed.

Keep service control and recovery manual, with exact commands in the owning
procedure. Add a small preflight/evidence helper and durable receipt writer only
where executable enforcement is necessary. The same exclusive operation lock
must cover preflight, intent, manual stop/backup/selection/start, verification and
final receipt. Reuse checked inventory, hashing, atomic writes and the shared
receipt validator. No automatic health-triggered rollback, updater service or
operation framework is selected. The legacy installation remains untouched.

Retain owned releases for this initial procedure; no pruning tool is needed.
The current-runtime contract mapping must state this conservative retention and
its manual recovery semantics explicitly. Required latest-state preservation,
input guards and truthful results remain unchanged. The stable anchor is selected
because routine unit paths must remain unchanged; its one-time adoption remains
an explicitly named installed effect, not an existing qualified prerequisite.

Build reviewed merged revisions in clean isolated checkouts with pinned Node
and lockfiles. Use explicit existing archive and hashing commands plus the small
inventory verifier to retain trusted source/build/archive evidence and the shipped
payload/dependency manifest. Do not introduce a generalized packaging or staging
service. The installed baseline's known SHA
does not alone prove its archive. Establish its actual provenance and dependency
closure before adoption; refuse if that cannot be verified. Do not relabel the
known-SHA baseline as unknown legacy or substitute rebuilt bytes silently.

Bind canonical plan bytes to target, installed/running baseline, configuration,
protected paths, all state owners, compatibility evidence and recovery sequence.
Recheck under the exclusive installation lock, refusing drift and unresolved
intent before stopping the service. Persist and fsync in-progress evidence first.
Verify owner/children exit, then back up named durable state consistently. Switch
the owned current anchor atomically; verify a new process and its exact build,
configured module/core health and existing scoped health exceptions. Bounded
timeouts produce truthful failure receipts rather than inferred success.

Recovery reopens latest durable state using a qualified prior release. Never
restore an older snapshot automatically. Compare format-producing/consuming inputs
conservatively and execute cross-revision tests through production adapters with
synthetic devices/media. Core, playback, Nanoleaf, Pixoo, Tidbyt, LIFX and SDK
outboxes participate; file originals/references remain intact. Startup may mark
unfinished operations uncertain or pause playback, but cannot replay commands.
Use semantic post-start assertions, not whole-database byte equality.

Finalize a schema-valid private receipt and read it back before success. Retain
all owned recovery releases; no pruning runs in this procedure. Publication uses synthetic receipts only. Credentials never enter
receipts or logs; consistent private backup handling follows the existing
configuration/state protection rules. Independent reviews and active CI remain
required before installed execution.

## Risks / Trade-offs

- Missing baseline provenance → refuse adoption and retain the running release.
- Unknown durable formats → refuse before service effects; expand only the named
  format proof, not arbitrary compatibility claims.
- Interrupted selection or failed receipt finalization → retain intent and all
  recovery references; require inspection, never automatic effect retries.
- Existing module startup effects → name them in the concrete installed plan and
  obtain authority for any effect beyond established installation authority.
- Shared source changes → keep manifest/CI/instruction edits small, coordinate
  owners and refresh the frozen comparison before review and merge.

## Migration Plan

This is release-path adoption for the same service, with existing state in place.
Complete the implementation checklist and disposable qualification first, then
synchronize/archive the source change under repository policy before committed
independent review, active CI and protected merge. Those delivery actions and the
post-merge installed acceptance remain mandatory under #1037; they are not
prerequisites for their own source archival. Source completion never marks the
procedure qualified for routine installed use or closes the issue. After reviewed
merged source and CI, present the exact first-adoption plan, one-time override, restart effects and
recovery for owner approval. Preserve the original unit and running checkout.
Verify baseline through the anchor before candidate upgrade. Demonstrate candidate
upgrade, recovery on latest state and re-upgrade in the selected installed window.
Later routine upgrades use the qualified procedure under standing authority.

## Conditional module participation

An ONN-unconfigured release can be considered only under a configuration-bound
proof that no ONN state exists and its factory/refusal path creates no database,
folder, timer, socket or device effects. This interpretation is proposed in the
current-runtime contract addendum and requires independent Specification review.
Configuration absence alone is insufficient if any ONN records exist. Activation
invalidates that recovery qualification; subsequent recovery must use a qualified
ONN-capable release. Ignoring existing ONN files is not recovery proof.
