## Context

Conversation already renders private Artwork attachments, and the Art owner already stages display renditions through the core and designated device writers.

## Decisions

- The Art owner validates a bounded binary upload and retains the original and prepared renditions in memory for ten minutes. The composer uses the same private preview renderer as companion replies. A separate save command commits the original, rendition rows and one favorite in a transaction. Staging a file directly into the catalog would make cancellation and display-only observable as saves.
- Display uses the same art-show plan for temporary and saved artwork. The Art owner reads temporary and saved compositions by reference. The core checks the live configured target before preparing a display. Device writers validate the delivered rendition and return their own evidence.
- Upload, save and Show have distinct tracked request IDs. The neutral upload reference identifies the same artwork across all three operations. Client actions use explicit confirmation, current control authority and the shared error registry. A rejected action leaves no effect. Uncertain writes retain their status and are never replayed. An explicit retry can address a definitively failed action without repeating a successful one.

## Risks and rollout

Keep originals and renditions out of model inputs and diagnostics. Bound decoding and temporary memory. A restart releases temporary attachments. The saved item uses the current Art store format. The disposable journey uses synthetic media and simulated devices. Mac installation uses a qualified batch and preserves the existing configuration and writer ownership.
