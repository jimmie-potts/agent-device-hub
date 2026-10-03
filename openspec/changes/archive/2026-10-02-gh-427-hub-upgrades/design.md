## Context

See [proposal.md](proposal.md) and Hub #427. Design is required by the schema because this work changes installation layout and recovery across process and filesystem boundaries. The existing Hub uses one SQLite owner lease, keeps agent state and automation in `state.sqlite`, and serves authenticated health plus dashboard assets. Packaging already stamps source identity and ships its source, tests and dependency closure.

The installed monitor's stable entrypoint is a real `runtime/hub-gh30` directory. Its manifest has version 0.4.1 without a source revision. Read-only comparison found the current storage, automation and agent-state source files identical to the installed copies; this narrows the compatibility investigation but does not establish running identity or recovery. Personal state is never opened in source tests.

## Goals / Non-Goals

**Goals:** one Hub-specific command, explicit owner approval, bounded outage, inspectable failures, and recovery that preserves the latest durable records. Both adoption orders preserve Nanoleaf paths and the shared Node executable.

**Non-Goals:** a common installer framework, device control, boot configuration, credential changes, automatic deployment, incompatible-state migration or historical-backup cleanup.

## Decisions

### Command and dependency boundary

Use Node 24 modules within the Hub package and a source-checkout command entrypoint. Keep planning, filesystem verification, service inspection and operation sequencing separable for isolated tests. Production service control is fixed to `codex-nanoleaf-monitor.service`; tests inject fake control without exposing a production arbitrary-command option. Reuse the contracts 1.2.0 receipt validator and pin its verified published archive in Hub packaging. Existing Hub and extracted-package test globs cover the new modules, so no new service or CI framework is needed.

### Approval and read-only inspection

`plan` and `status` inspect installation metadata, protected paths, service/process identity and remote main without creating durable installation records or changing a service. Resolve moving source names to full merged revisions. List the complete comparison, or explicitly report it unavailable. Canonical plan bytes bind target, source bundle, installed program inventory, configuration, protected paths, named unit, backup scope, compatibility requirements and recovery route. Mutable event revisions remain observations rather than approval hashes, since normal ingestion continues before the outage.

Mutating commands require the reviewed plan digest and exact target. Recompute the bound inputs under the installation lock. A changed source, baseline, configuration, protected path or unresolved operation refuses execution; there is no force or implicit retry option. An inactive service has no running-build claim.

### Provenance and compatibility before outage

Build only a clean merged revision in an owned disk-backed checkout using Node 24 and the required package checks. Verify trusted archive and manifest hashes, every shipped file and dependency, complete inventories, safe paths and links. Stage an immutable release; conflicting bytes at an existing SHA refuse.

Compatibility is conservative: known durable format support plus an isolated target-write/previous-reopen probe must establish recovery for every supported record kind. Include owner/source identities, revisions, labels, notices, acknowledgments, retirement and deduplication history, automation rules, settings, budgets and consumed events. A format or implementation not covered by that evidence is unknown and refuses before service stop. The probe uses synthetic state outside Git, no live database and a fake sender; it also verifies that reopening does not repeat consumed effects. Equal package versions are not compatibility evidence. Initial qualification can use verified identical durable implementations, with the same executable probe; future format changes need separately reviewed qualification.

### Lock, intent and state preservation

Hold an exclusive Hub installation lock from the baseline recheck through durable finalization and eligible pruning. A retained lock or unresolved intent requires inspection, even if its original process exited. Persist and fsync a schema-valid in-progress receipt before stopping the service. Verify the named process exited, then copy all explicitly inventoried durable state/configuration without sockets or transient runtime objects. Backups are evidence and never the automatic rollback source.

Switch only the Hub current link with atomic rename and parent fsync. Restart the same service and require bounded health: target identity, expected owner, running collector, open admission, launch socket, served assets and existing browser security behavior. Controller-offline observations remain separate. Failed candidate health triggers one bounded recovery to the already-qualified previous program, against the latest state. Verify state after the failed process exits and after recovery; do not overwrite it with an earlier backup. Read post-start state only while systemd has frozen the full service cgroup. Run the read in an isolated process with a five-second kill timeout, always attempt thaw, and repeat health after thaw. The plan binds this additional monitoring pause and requires freeze support before any service effects. Freeze/thaw commands and property reads each have a five-second timeout; interrupted control leaves an inspection barrier. Compare exact state across stopped program switches, then accept documented owner mutations and retention under monotonic commit/revision evidence. A rollback-journal SQLite change counter orders mutable automation settings/rules that have no agent-state revision; it is not an authorization receipt. Preserve unexpired records, acknowledgments and bounded dedup history, and reject unexplained loss or backward evidence. Failed stop, backup, switch, recovery and final receipt write have distinct outcomes.

### First adoption and legacy proof

Copy and verify the existing program/dependency closure before outage. A trustworthy source receipt can establish a release identity; otherwise retain a legacy identity with a deterministic inventory of sorted relative names, file bytes, modes and link targets. Preserve the original component at a unique history path. Under the stopped-owner boundary, introduce `runtime/hub-gh30 -> H/current`; never rename the enclosing runtime or shared Node. Persist the migration boundaries so interruption refuses another automatic adoption.

Legacy rollback proves a new process start, executable and entrypoint resolution, and served asset hashes with operational health. It does not require the new build field and never substitutes a file hash for process evidence. Verify both Hub-first and Nanoleaf-first layouts with other-owner marker files and resolution/hash assertions.

### Receipts, retention and agent discovery

Validate every receipt with the shared full validator before atomic durable writes. A final-write failure returns failure, retains unresolved intent and emits the attempted diagnostic receipt through a named private channel; it never prunes or reports success. Keep current plus three prior successful owned releases. Protect unresolved/approved recovery references, legacy copies, receipts, backups and unrelated histories.

Keep operational steps only in `apps/hub/SETUP.md`. Root `AGENTS.md` carries the contract's completion condition, source-only exception, authority boundary and triggered pointer; `CLAUDE.md` remains unchanged. Static branches and fresh read-only agent sessions verify plan-before-mutation behavior.

## Risks / Trade-offs

- Conservative compatibility can reject a harmless code change → report unknown and require reviewed qualification; never guess from versions.
- Process, filesystem and service operations are not one transaction → durable phase evidence, verified exits, bounded recovery and refusal after interruption.
- State can advance during candidate operation → compare the latest stopped state at recovery and preserve the existing database throughout.
- A source declaration cannot prove runtime behavior → retain real installed process, health and state evidence at the separate owner checkpoint.
- Shared paths can change independently → bind and recheck their bytes and link resolution; neither updater owns the shared parent.

## Migration Plan

Deliver source through independent reviews, guarded merge and merged-main CI. Prepare the exact target archive, baseline inventory, compatibility/recovery evidence and complete bundle, then present the real sequence to the named installation owner. After approval, migrate and upgrade, verify the receipt and running state, roll back with newer-state preservation evidence, and re-upgrade. Refresh approval if its bound inputs change. Keep Hub #427 open until that sequence passes. Source archival records implementation acceptance; installed acceptance remains in the issue and private receipts, since it necessarily follows the merged candidate.
