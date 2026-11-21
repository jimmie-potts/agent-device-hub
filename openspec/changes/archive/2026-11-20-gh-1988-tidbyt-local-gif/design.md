## Context

Art currently stages generated GIFs through the core. Tidbyt checks their framing, decodes them in a bounded worker and stores the native WebP privately. Show now requests a tracked preparation and a later exact-art moment.

## Decisions

The existing control-scoped binary upload supplies transient bytes to Art. A tracked upload command contains only the digest. The Art owner binds it to the pending upload request, selects the configured Tidbyt through its live device copy and forwards one existing art-stage command. The upload parent completes from the child's result. The Art owner keeps its existing preparation and stage receipts. A temporary reference identifies one upload and content digest and expires with the staged copy.

An explicit Show now for the temporary reference verifies the stage receipt, expiry and target before issuing a moment. The device checks its copy at moment admission. No reference becomes a gallery item, ambient selection or automatic candidate. No bytes or filename enter the core's tracker. Direct clients retain their existing restrictions on internal art commands.

## Risks and recovery

Uploads contend for bounded preparation capacity. A restart discards uncommitted input and reconciles pending commands without replay. A missing or conflicting receipt prevents a moment. A failed return to rotation retains the writer's existing uncertain outcome. The schema change is additive and existing catalog items use their original path.
