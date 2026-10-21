## Context

See proposal.md for motivation and [#1173](https://github.com/jimmie-potts/agent-device-hub/issues/1173) for scope and evidence. Main `59e8c39f` mounts the existing cards in one React shell but places every brand, non-light device, Audio and declared module page in main navigation. Hash routing and guarded command adapters already provide the required behavior.

This design is included because the shell is consumed by multiple module frontends and a route/token change affects their navigation and accessibility together. The runtime owns this UI. Core metadata and module writers do not move.

## Goals / Non-Goals

**Goals:** make the accepted four-destination hierarchy real while keeping every existing page, card guard and saved placement usable. Keep Places and sign-out reachable without the growing primary rail.

**Non-Goals:** new card controls, a second connection, state polling, device discovery, saved theme selection, Home layout editing, guessed room assignments or Wemo redesign.

## Decisions

- Add explicit `devices` and `settings` route kinds and derive the containing navigation destination from the route. Keep existing routes rather than redirecting bookmarks or merging component aliases into built-ins. Extract plain anchor navigation into a small reusable component; retain modified-click behavior and the existing synchronous navigation notification.
- Build a read-only directory from the current module catalog and device/playback records. Category selection stays local to Devices, with existing page links inside each group. Unrecognized modules use Other; absent and failed evidence stays explicit. Do not maintain a second device catalog or fetch from the directory.
- Reuse Connections/operator content under Settings, with a direct Connections link for its retained address. Move the existing Places and Disconnect UI into Settings; retain a compact feed indication and ended-session recovery globally. This moves Places without changing its allowlist, target URLs or window/origin behavior, so its existing capability receives a scoped delta.
- Keep the existing Home widgets and card placements. Add the Home Timeline link and shared shell treatment without introducing a new selection policy or hiding inbox handling.
- Add a runtime Quiet glass skin layered over the existing semantic token vocabulary. Put raw colors in skin files, keep fixed task-color meanings and artwork material, and update layout only through tokens. Use light/dark browser appearance and reduced-motion rules. The retained legacy dashboard and documentation keep their own Neon presentation. A general theme picker adds no value to this selected default.
- Reuse all current card and module adapters. This introduces no new request, reply, error, outcome, diagnostic record, retry or trace boundary. Existing ADR 0012 admission, effect truth and retained uncertain locks remain unchanged. Unknown routes, failed catalog reads and revoked authority must be visible without sending commands.

## Risks / Trade-offs

- Moving links can strand pages or hide recovery → preserve every hash, unit-test grouping and aliases, and drive the new navigation in browser and independent disposable Acceptance.
- A light palette can reduce contrast or blur state meanings → validate both appearances, keep fixed attention tokens and explicit labels, inspect desktop/phone screenshots and run axe on affected pages.
- Existing browser journeys expect the growing rail → update their navigation actions to traverse Devices or Settings, keeping their outcome/no-replay assertions intact and running the full owning browser suite.
- More compact navigation adds a step to less frequent pages → retain bookmarks and group links locally; avoid a second navigation framework or persistent directory state.

## Migration Plan

No stored data, room membership, authentication or API migration is required. Validate and review the committed candidate, synchronize both affected specs and archive before final review, then pass exact-head and merged-main CI. Install only through the qualified established runtime procedure after refreshing its current ownership and release plan. Passive installed Home/Rooms/Devices/Automation/Settings and legacy-link readback makes no device command. A source revert is a normal new release through that procedure; do not imply that reverting CSS restores private runtime state. Keep source, installed browser, actual-phone and physical evidence separate.
