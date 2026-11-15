## Context

The Conversation page owns selected profile, private content reads, and tracked commands. The recent reader returns chronological windows with opaque older cursors. Current question metadata comes from the latest read.

## Goals / Non-Goals

Keep transcript reading and replying usable while task decisions remain explicit. Preserve the single unfinished task, command effects, speech lifetime and existing profiles. The layout adds no storage, endpoint, event family or migration.

## Decisions

- Keep one mounted page and command owner. Place pane changes below that owner, and keep the speech controls mounted across those changes.
- Fence each bounded history read against the profile, request and page lifetime. Present disjoint windows with explicit Load earlier actions. Match the current question to current task and question IDs before allowing a decision.
- Preserve the current saved row's relative offset when prepending. Show New messages if the view was above the latest exchange. Keep drafts in page memory by profile and start or question ID.
- Preserve diagnostics, refusal codes, private content staging, and no-resend behavior through the existing command owner. A failed history read may leave previously loaded text visible.

## Risks / Trade-offs

Concurrent reads can return obsolete windows or questions. A replacement request invalidates the prior result, including its failure. Failed commands keep the current draft and the original receipt. The browser journey covers these boundaries with synthetic content.
