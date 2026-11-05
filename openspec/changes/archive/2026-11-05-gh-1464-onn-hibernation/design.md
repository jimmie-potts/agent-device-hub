## Context

See proposal.md and #1464. BB-8 already has a manifest hibernation flag consumed by generated runtime/frontend registration.

## Goals / Non-Goals

Stop active ONN participation while retaining a reversible source record and private compatibility. No replacement device, data deletion, migration or physical qualification is selected.

## Decisions

Use the existing manifest flag and exclude the package from workspaces/build/lint. Hiding cards alone would leave the writer and polling active. Retain dedicated checks with dormant suffixes, and remove their active catalog/CI entries. Remove explicit shell imports before excluding the package. Preserve core omitted-payload handling and backup/upgrade readers because historical state outlives a device. Keep the frozen ONN configuration reader in the active runtime compatibility code so backup verification and restoration do not depend on dormant module build output. Keep generic television-size keyboard checks because they validate shared shell behavior.

## Risks / Trade-offs

Stale generated output could reintroduce dormant scenarios. Clean known ONN build residue before builds, as BB-8 does. Saved bookmarks must render the shell's ordinary unavailable-module state. Historical active requirements remain documented but the hibernation requirement governs availability. ONN source receives no default qualification while dormant; resumption requires restoring it.

## Migration Plan

Merge reviewed source and disposable absence/preservation evidence. #1465 owns the qualified installed batch, exact private plan, lock, configuration removal, retained-store evidence, identity/health receipt and writer release. No old WSL writer starts. Recovery remains independently qualified; preserve failed latest state and prefer fixing forward.
