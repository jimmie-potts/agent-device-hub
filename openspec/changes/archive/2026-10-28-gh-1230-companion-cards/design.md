## Context

See proposal.md and Hub #1230. Reachy currently owns its module-scoped copy and browser speech lifetime in a long page. MicroDuck already has a Home widget over explicit private latest/history reads; selection lives in the same companion store. The runtime shell provides core copies, scoped module acquisition, authority and tracked command controls.

## Goals / Non-Goals

Use shared presentation within the existing owners. Keep Home placement opt-in, private reads current, and speech explicit and connection-bound. This change adds no model, audio route, room assignment, naming schema, store or device action.

## Decisions

- Export module-owned cards and a small local card frame with persistent artwork and tab panels. Reuse the shell's skin tokens. Keep all tab faces mounted, hidden and inert when inactive, so tab switches do not withdraw a speech endpoint. Size the control plane from its content rather than clipping actual long messages.
- Reuse Reachy's existing state acquisition and immediate speech ref. Render its advanced evidence, fixtures and coding suggestions on the owning page instead of duplicating owners or filling Home with them.
- Keep the qualified speech session implementation and add concise presentation. Preserve essential manual-availability guidance, truthful playback/operation states and access to the longer explanation.
- Keep duck-latest and its private latest/history owner. Read conversation choices only after an explicit Choose action, paginate through the existing history endpoint, and use the existing revision-checked selection upload. Conversation records have participants and opaque identifiers, not titles; preserve those labels rather than manufacturing topic names.
- Fence replacement-sync and obsolete list/private reads. Read-only or stale contexts cannot save a selection. Selection does not generate dialogue or activate output. Retain the full history and evidence surface.
- No new protocol or diagnostic contract: existing ADR 0012 command and refusal semantics apply at every handoff. Automatic retries remain absent.

## Risks / Trade-offs

- Private text could survive a stale copy or late promise: invalidate on restart/failure and key private reads to their current API/revision/generation; exercise delayed reads and access refusal.
- Hiding a Voice tab could unmount speech: retain its mounted panel and test endpoint identity and lack of unsolicited enablement.
- Quiet presentation could conceal meaningful evidence: retain timestamps/provenance and playback uncertainty; keep the existing detailed pages accessible.
- Very long messages can make a card tall: preserve readable text and stable tab geometry rather than truncate an accepted latest meaning.

## Migration Plan

No state or wire migration. Existing saved placements keep their IDs; Reachy is absent until selected. After reviewed source and CI, use the selected established installation's owning procedure, preserve current settings/selection and verify running identity and passive cards. Installation ownership and target are confirmed before runtime effects; physical speech/robot checks remain separately scoped.
