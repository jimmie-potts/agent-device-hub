## Context

See proposal.md for the requested outcome. Quiet glass owns the shared semantic tokens and follows browser light/dark appearance. The shell owns Settings and styling; Habitat already keeps presentation preferences in browser storage. The art module's transient context reports only decoded artwork that is visibly drawn and distinguishes ready, loading, stale and unavailable states.

This design is required because the change crosses the art presentation and shell styling boundary, adds an explicit persistent preference and must preserve accessibility across arbitrary supplied palettes.

## Goals / Non-Goals

Apply bounded palette-derived decoration without acquiring another catalog copy. Keep owner choices across browser/runtime restart and make storage failures visible. Theme application does not request images, change layout, call a backend or dispatch a device command. Arbitrary palette extraction, external texture assets, typography, a skin marketplace and cross-browser account preferences are outside this change.

## Decisions

1. **The shell owns derived styling.** A small ArtThemeProvider inside ArtPresentationProvider consumes fresh ready presentation. Loading, stale, hidden and failed art keep the last valid theme; navigating away does not invent new presentation evidence. The provider retains only derived palette state for this page lifetime, not another art catalog or durable art identity. Placing this in the art module would give a feature module authority over shared semantic CSS.

2. **Use a closed token layer.** A pure palette function accepts one to eight six-digit hex colors and produces bounded light/dark decorative values. A skin file maps only those values to page/panel/inset/raised backgrounds, quiet borders, primary action and link colors, and static gradient washes behind content. Fixed text, focus, warning, pending, error, success and physical task/device tokens remain unchanged, as do all geometry and typography tokens. No CSS text, selectors, URLs, asset paths or texture programs are accepted. A controlled wash is sufficient decoration for this release; unavailable image content cannot produce a new ready palette.

3. **Persist explicit browser presentation choices.** One versioned key stores follow/default, or locked with a bounded palette snapshot or null for locked default. Initial mode follows artwork. Restore default persists until Follow artwork is explicitly selected. Lock stores the currently applied palette rather than an artwork ID, so deletion and catalog availability cannot undo the choice. This matches existing browser-local Habitat preferences and needs no new core owner or Home metadata. A storage event applies another tab's valid explicit choice; invalid input keeps current/default state with a clear notice. Failed writes may affect the current page but are labelled unsaved and never claim persistence or retry automatically.

4. **Keep ordinary controls available.** Settings hosts Follow artwork, Lock current colors and Restore default, with current mode and save status. These local presentation controls do not require device authority. They neither reset Home nor alter focus/active geometry when new art arrives. Browser light/dark changes recalculate the same locked palette through the appropriate bounded values.

5. **Verify the actual consumers.** Pure tests cover extreme/malformed palettes, closed preference variants and contrast bounds. Browser tests drive actual saved synthetic art, capture computed fixed/variable tokens, check real text contrast and axe across desktop/phone and both schemes, preserve control bounds/focus, and count zero commands/provider calls from theme controls or automatic application. A disposable scenario records the real controls and final theme. Source checks do not establish installed optical acceptance.

## Risks / Trade-offs

- Browser-local preferences do not synchronize across different browser profiles. The Settings copy identifies this scope; no second shared state owner is introduced.
- Storage can be blocked or full. Keep a usable valid theme, report unsaved state, and offer explicit controls without a background retry.
- Palette extremes can reduce contrast. Bound light/dark surfaces and action colors, then verify them against actual fixed text/focus/status colors and rendered representative states.
- A late image or stale copy can arrive after selection changes. Only the existing presentation context's ready visible result changes the theme; invalid or missing values preserve the prior/default.

## Migration Plan

The new browser key is absent on existing installations and defaults to following artwork with Quiet glass until valid art is presented. No backend format, device state or old preference is changed. Invalid or unknown versions do not get rewritten automatically. The selected installed deployment remains with #687; source rollback ignores the additive browser key.
