## Context

The current core already owns lighting/playback placement metadata. The dashboard has one authenticated participant and reusable device cards. The approved preview supplies presentation, not live storage.

## Goals / Non-Goals

One owner, one desktop and one phone arrangement. Preserve existing configured sources and controls, with no device effects from editing. No arbitrary pages, accounts, templates, free positioning, new integration or format switching.

## Decisions

- Add `home-layout` and `home-layout-set` profile 2.0 families. Core commits metadata, tracked result and outbox together. A bounded versioned record contains widget identities, supported size and hidden flags only. Default null layouts preserve the built-in arrangement until the first explicit save.
- Use the existing browser session, Origin, bunny-request header, command admission and trace continuity. Save once with expectedRevision. Invalid, unauthorized, expired and conflicting saves fail without metadata/device effects. Storage failure rolls back the transaction. No automatic replay or retry; a lost reply stays locked until authoritative outcome evidence resolves it.
- Existing lighting group/ungroup and room Home actions reconcile any saved Home arrangements in their original core transaction, so a saved grid cannot strand those already accepted controls. This adds no second device writer or command.
- Rendering uses the existing shell copies and module scopes. Unmounted hidden module cards release their private reads/subscriptions; core-wide status remains synced for alert visibility. Missing device instances are unavailable, not retired catalog definitions. Unknown widget definitions are omitted and reported once per saved revision; no automatic write follows.
- Desktop and phone use separate ordered arrays. Adding appends to the other arrangement if absent. Cancel discards the draft; Reset changes only its breakpoint draft; Done persists both with one revision guard. Concurrent browser edits require a fresh review, never silent overwrite.
- Keep Inbox visible while unresolved items exist and Agent status visible while sessions require attention. They remain ordinary cards in the grid; no top notices section. Their edit controls explain why hiding/removal is temporarily unavailable.

## Risks / Trade-offs

The saved layout is new additive private storage. Forward upgrade evidence must include its table and preserve all other owners; older-reader recovery remains separately assessed. Device commands retain their own shared attempt locks across layout moves. Editing disables card controls and reserves drag handles for layout, avoiding light-group drag effects.

## Migration Plan

Create one additive core table with a versioned default record. Preserve existing lighting groups, rooms, Home light selections and playback placements. Derive the initial Home arrangement from those records and current cards. Deliver through PR and CI, then the qualified runtime upgrade with backup and passive installed-browser readback. No physical device sequence is selected.

## Open Questions

None. Issue #366's legacy route/header and source-only wording are superseded by the current runtime and the owner's explicit live-delivery request. #287's wider inventory and optional epic children remain separate work.
