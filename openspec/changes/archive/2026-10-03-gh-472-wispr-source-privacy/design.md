## Context

See proposal.md for the installation blocker and approved decision. Config loading currently qualifies the source, SQLite sidecars and retained state with one exclusive-ACL rule. Later writable-state qualification already inspects every existing state file and backup and rejects hard-link aliases. Design is required because this changes a privacy boundary.

## Goals / Non-Goals

**Goals:** Separate vendor-source ACL grants from the private collector-owned boundary while preserving current path, ownership, source binding and write protections.

**Non-Goals:** No new user-selectable privacy mode, principal registry, automatic ACL repair, shared contract change, broader privacy audit implementation or live-data acceptance in this source change.

## Decisions

- Keep the public private-path qualifier strict. A module-local source qualification path relaxes only additional ACL grants for the selected source and existing sidecars. Retain shared geometry, fixed-drive, reparse, cloud/Git and owner checks. This avoids a generic bypass in config or CLI arguments.
- Keep state/config/backups/exports on the strict path. Run source qualification separately during config loading. No writable target can acquire the source exception through containment, aliases or sidecar spelling.
- Use native Windows synthetic fixtures with an additional read grant, held WAL/SHM and source/ACL comparisons. Add negative controls for config, state child, backup and export permissions; retain existing unsafe-path, hard-link and recovery tests.
- Publish collector 1.1.1 with matching package metadata, lockfile entry, archive name and manifest. The aggregate schema remains 1.0 and needs no migration.

Alternatives considered: removing the extra Wispr grant would modify vendor data permissions; an explicit trusted-principal list or unsafe mode adds configuration without improving this single-owner boundary. The owner selected the localized relaxation.

## Risks / Trade-offs

- Existing source readers remain able to read Wispr data → document that the collector does not guarantee exclusive source access or change those readers' access.
- Accidentally relaxing collector-owned paths → keep their qualifier strict and test each output class with the same extra reader.
- A source redirect or replacement could target unexpected data → preserve local-path and owner qualification, namespace binding and read-only SQLite.

## Migration Plan

Native-qualify the distinct offline package before installing through #472's documented owner checkpoints. No ACL or state migration is needed. Reverting to 1.1.0 restores its stricter source gate and may block collection again; retained compatible numeric state is preserved. Language recovery keeps the existing opt-out/clear-text procedure. Live collection and separate language/Hub sharing decisions remain pending after source merge.
