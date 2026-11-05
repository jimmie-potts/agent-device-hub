## Context

The current Nanoleaf module owns five deterministic V1 Music renderers. Its browser entry owns the existing Wall page, and Audio already links to module pages. The renderer imports Node-side geometry validation, Python-compatible serialization and capture-family validation. Moving it into the browser would widen this change across those established paths. See proposal.md for motivation.

This design meets the schema's security/performance and decision-ambiguity criteria. The new interface is one bounded authenticated content read, whose implementation has no dependency on configured devices or their state.

## Goals / Non-Goals

Preserve one canonical renderer and provide an explicit synthetic comparison within the existing Wall page. Keep the browser entry free of Node implementations. Custom reactive-preset persistence, live/calibrated features and configured-layout preparation retain their separate requirements.

## Decisions

Use existing `FrontendApi.read` and Nanoleaf module content for explicit preparation. The closed query contains one JSON request with version 1, one of five preset IDs, 1–8 hex colors, intensity 0–1 and either `lines-demo-v1` or `nl22-demo-v1`. Reject a decoded request above 2 KiB before parsing, unknown fields or versions, and invalid values. Read authority is sufficient; no new grant, command, event family or message envelope is introduced. The returned versioned JSON is an ordinary module-content document.

Keep built-ins as explicit immutable V1 recipes in browser-safe data. Extract only semantic recipe types into a browser-safe data file and retain their existing server export; a type import from the renderer otherwise pulls its Node dependency graph into the dashboard typecheck. Renderer executable code stays unchanged. The server copies the selected recipe, applies palette/intensity through `freezeMusicRecipe`, and invokes `MusicRenderer` on fixed synthetic geometry and twenty fixed 100 ms stimulus windows. Both models have six example elements; Lines have twelve logical zones and NL22 six. Project the canonical static output into RGB samples. Never duplicate an effect formula. Return the canonical recipe, explicit model/stimulus identity, offsets, synthetic levels and RGB zones, with a 16 KiB encoded response bound. All timing is virtual example time, independent of clocks or audible playback.

Embed a compact expandable preview in the existing Wall page and add a contextual Audio link. No separate editing application or new route page is needed. The UI labels the example geometry, generated input and unsaved draft, and offers no fake live meter. Only Preview performs a read. Palette, intensity, effect and model edits clear prior output. One read at a time and draft/connection generations fence late replies. Sample scrubbing is local, with no animation or automatic rerun. Disconnect and unmount invalidate the result; reconnect needs another explicit Preview. The browser validates the bounded content document against the requested draft before rendering colors.

Reuse registered `invalid-request`, `cancelled` and `unavailable` errors with fixed text. The content boundary checks cancellation and translates unexpected preparation failure without publishing raw exceptions or request values. Preparation reads no file, configuration, layout, database, capture stream or clock, and creates no operation or ticket. The existing module host retains authentication, request lifetime and diagnostics under ADR 0012.

## Risks / Trade-offs

- A synthetic example can be mistaken for live output. Keep generated-input and example-layout labels visible with the result, and make no calibration or physical accuracy claim.
- Delayed results can describe an old draft. Retain one in-flight read, invalidate its generation on any edit/disconnect and require explicit retry after settlement.
- Canonical encoding changes could break RGB projection. Test projection against the unchanged renderer for every effect/model and retain the existing V1 tests.
- A new HTTP preparation path adds processing. Bound request bytes, samples, zones and response bytes; use fixed fixtures and perform no external work.

## Migration Plan

There is no stored-data or configuration migration. Existing Wall/editor and measurement behavior remain compatible. Source rollout follows the normal reviewed PR process. Installation and physical checks are separate; removing this UI/content feature changes no saved preset or device state.
