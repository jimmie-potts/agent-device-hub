## Context

See proposal.md for the current #605 gate. BB-8 uses the existing module SQLite
connection and SDK outbox in WSL; the Windows helper separately owns its receipt
database, enrollment fingerprint and target-keyed mutex. Neither startup opens a
radio connection. Generic installed qualification currently excludes these
configured/retained owners. The existing bounded absent-ONN guard must remain
intact in the overlapping runtime profile files.

This design is required because recovery and ownership cross WSL and Windows,
while admission must remain read-only and preserve other installed modules.

## Goals / Non-Goals

**Goals:** qualify the existing durable formats, bind all storage-bearing helper
inputs, and admit the existing BB-8 owner only after complete compatibility proof.

**Non-Goals:** change public commands or wire schemas, add motion, change firmware
or persistent options, activate ONN, replace other writers, or install/operate a
device as part of synthetic qualification.

## Decisions

1. Use the production module database opener and actual BB-8 stores on private
   disposable files. Seed latest state and responsibility, reopen them through
   recovery/re-upgrade, and verify no adapter operations. In-memory fixtures alone
   do not cover WAL durability or latest-file recovery.
2. Keep Windows receipts independently owned. Native Windows runs reopen a
   synthetic receipt store with the production opener; WSL orchestrates the
   process but never opens that database. Retain enrollment and consumed/history
   rows and reconcile interrupted operations without executing them.
3. Extend conservative source classification to storage-bearing helper source
   and package inputs. This prevents a later helper storage change from bypassing
   the admission's format comparison. Do not add a separate manifest framework.
4. Extend existing configured/durable owner and health checks for BB-8 only.
   Existing seven-owner certificates retain their coverage shape for the original
   scope; each selected release still needs matching source and format bindings. The
   certificate accepts only the complete additional `bb8`/`bb8-windows` pair,
   each with all four phase receipts; verified covered names are included in
   its internal binding. Preflight requires that pair for configured or retained
   BB-8 before initial or post-start success. Unknown owners, unsafe files,
   incompatible evidence, and configured or retained ONN/Roborock retain their
   existing refusal behavior. Integrate against the accepted shared profile.
5. Keep physical qualification separate. A docked camera view supplies visual
   observations, not enrollment, containment, battery health or proof of stopping.

## Risks / Trade-offs

- Recovery evidence can omit pending outcomes: cover completed/unconsumed,
  consumed and interrupted rows and the real SDK outbox, retaining identifiers.
- Helper changes can escape runtime format evidence: include their source and
  dependencies and exercise a changed-input negative control.
- Cross-task profile edits can overwrite a bounded exception: preserve source
  ownership coordination and refresh against the accepted merged comparison.
- A broad release can include unrelated modules: select and qualify the entire
  actual bundle; do not identify main with the currently installed release.

## Migration Plan

Complete source checks, synchronize the affected OpenSpec and archive before
final review. Deliver qualification and admission through an isolated reviewed
PR, with independent Standards, Specification and disposable Acceptance, hosted
CI, a guarded merge and applicable merged-main CI. Prepare the actual
runtime plan with the accepted source, existing installed state and exact
configuration under the coordinated installation window. Retain the current
release and latest-state-compatible recovery. Separately prepare the dedicated
Windows helper and private enrollment before its owner-approved finite trial.
No source-test result authorizes a service restart or radio command.
