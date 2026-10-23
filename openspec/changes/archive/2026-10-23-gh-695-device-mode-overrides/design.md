## Context

See proposal.md. The core already stores `core_mode`, completes selection in the same transaction, and uses the tracker for independent device commands. The existing minor-version pattern registers later schemas beside earlier schemas. Shared card presentation is already separate from its state adapters.

## Goals / Non-Goals

One existing state owner and one shared revision cover global and individual choices. Keep native commands and results independent of saved intent. No service, table of duplicate mode state, device discovery, generic policy engine or installed-system change.

## Decisions

- Publish `mode/2.1` with the existing global fields plus an array of unique target/mode/time overrides. Retain `mode/2.0` registration. Earlier private records acquire an empty override array in memory, without resetting choice/revision; subsequent selections save the new shape. This follows existing device/playback minor versions instead of creating a second state family. Validate stored records before use, including unique targets and no redundant same-as-Hub override.
- Keep `mode-set/2.0` for global selection; add `mode-override-set/2.0`, addressed to one participant, with the same mode/requestId/expectedRevision payload. Both use tracker admission and ordinary control authority. Unknown targets refuse before saving. Global selection with no participants still saves.
- Use one process-local selection guard plus the existing tracked child identities/deadlines. A new selection refuses while a prior selection is preparing or its children are pending. No new polling loop or queue. Save state and completion before dispatch. Each device remains independently dispatched, even after another refuses. Late results update tracker evidence only.
- Global selections clear all overrides; individual selections replace/remove only their target. State revisions advance for both, while the global selected time changes only for global requests. Keep missing-participant saved exceptions as inactive evidence, never auto-apply them when a participant returns.
- Reuse the shell's synced mode record and retained command attempts for device controls. Add a small optional shared frontend UI contribution for the Pixoo card rather than importing shell implementation into a module. LightCard and advanced device controls use that same presentation. No second connection, local mode store or guessed reverse native mapping.
- The Hub card's neutral disclosure lists explicit exceptions and their available device/request evidence. Existing Check Inbox remains the failure route. Native Work/Quiet ambiguity on Pixoo is displayed honestly; changing a native Monitor/Media control never invents a Hub choice.

## Risks / Trade-offs

- Old schema consumers need the updated registered minor version → retain earlier payload registration, test existing global consumers and the shared contract corpus, and ship the matched source release. No claim of independently deployed old clients accepting a new schema.
- A failure after persistence can leave a saved choice unapplied → existing tracked failed/uncertain evidence and explicit manual reapply; never rollback or replay.
- A corrupted private record cannot be interpreted safely → refuse startup/use without overwriting bytes; recovery uses the existing private backup/manual procedure, not a new repair tool.
- A saved exception need not equal native state → label intent, desired mode, observation freshness and request outcome separately. Source/browser evidence never proves physical output.

## Migration Plan

Source-only. Tests open legacy and new disposable stores, preserve unrelated rows and reopen without commands. Existing private format is extended additively; installation and any rollback qualification remain with the separate runtime procedure and #1050. Archive only after the changed scenarios and applicable checks pass.
