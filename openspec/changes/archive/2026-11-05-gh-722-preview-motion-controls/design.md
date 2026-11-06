## Context

See proposal.md for the requested outcome. The browser already loads full V1 recipes and sends a closed full-recipe synthetic preview request. The owner validates and saves immutable recipes. Current local edits cover palette/intensity only; all motion values are displayed as read-only.

## Goals / Non-Goals

Make existing effect-specific motion values editable without changing their interpretation. Preserve generated-input labels, explicit reads, immutable save semantics and readonly access. Source-response tuning, V2 recipes, actual input, admission and playback are outside this change.

## Decisions

Use one full-recipe draft override for loaded or motion-edited recipes. Apply a discriminated motion edit only to the matching current effect and validate the resulting complete recipe with the unchanged canonical V1 freezer. This avoids parallel defaults or a relaxed parser. Effect switches retain their existing reset-to-built-in behavior.

Expose bounded pulse half-life and wave-cycle sliders plus the existing direction list in the current preview. Keep sensitivity/smoothing visible and read-only so these controls do not duplicate microphone response settings. Use the existing full-recipe read and explicit new-preset save. New controls invalidate pending preview generations exactly like palette edits. No new message or error shape is introduced; existing ADR 0012 read/save refusals and no-resend behavior continue unchanged.

A local invalid edit leaves the last valid draft intact. Read failures retain the draft and require explicit retry. Saves keep existing authority, revision and uncertainty guards. No schema, defaults, storage migration or device writer changes are needed.

## Risks / Trade-offs

The bounded example spans only 1.9 seconds, so a long wave cycle or decay is a partial generated example rather than a full-cycle demonstration. Existing virtual-time labels remain explicit. A full recipe must preserve loaded sensitivity/smoothing and unrelated variant values; unit round trips and real disposable save/reload assertions cover this.

Browser checks extend the existing full Nanoleaf entry, including read-only keyboard, reduced-motion, light/dark phone/desktop Axe and applied-Art coverage. No live or installed acceptance follows.
