## Context

See proposal.md for the outcome. This design is required because the change crosses art frontend, shell layout and core metadata boundaries and adds durable layout options.

Home uses balanced wrapping rows in `home-layout.css`; inserting a card into a row can resize its neighbours. `HomePlacement` currently stores only widget, size and hidden. `HomeLayout` already owns desktop/phone drafts, revision guards, tracked saves, reset and attention protection. The art module supplies `art/2.0`, paginated catalog content, immutable rich WebP renditions and owner commands. A successful request operation proves job admission; later art state proves the generation result.

## Goals / Non-Goals

Goals are safe art geometry, truthful browser controls and reuse of the existing state/authentication owners. The implementation includes a small presentation context for the actual widget/gallery and their theme consumer.

General freeform layout, theme application, wallpaper export, physical moments and new generation/provider behavior are outside this change. Source and synthetic evidence do not establish installed acceptance.

## Decisions

1. **Keep feature rendering in the art package.** Add a browser-only `./frontend` entry exporting `ArtWidget`, the Gallery contribution and its presentation context. The shell mounts these with `ModuleFrontend`; `context.api` supplies sync, authenticated reads/images and tracked commands. No new connection, route authority or catalog store is needed. Importing the Pixoo gallery would bind rich UI art to its 64px media protocol; reuse its decoded-image cleanup and visibility rules instead.

2. **Keep layout metadata in the core.** Add optional art-only `{format: 'auto' | 'banner' | 'square' | 'tall', pinned: boolean}` to `HomePlacement`. Register additive home-layout/2.1 state while keeping unchanged 2.0 records valid. Extend the existing home-layout-set/2.0 command with the optional placement fields, following the repository's additive optional-command precedent. Keep the private record version and legacy rows readable; preserve options during lighting reconciliation. The metadata contains no artwork, prompt or palette. A separate local-storage layout would compete with the core and lose cross-browser revision protection.

3. **Reserve geometry explicitly.** The art card occupies its own bounded row when the owner adds or pins it. Format changes are explicit metadata edits. Default automatic art appears only in measured trailing free viewport space, outside the functional row-balancing calculation. It disappears below the minimum fitting rectangle. Changes to this automatic geometry wait during pointer activity, focused controls and Home editing. Images cannot determine the container's height. Automatic format choices remain transient; only an explicit owner action saves them.

4. **Separate layout and catalog actions.** Pin/dismiss/restore belong to Home's guarded metadata save and do not signal artistic preference. Favorite and explicit more/less/dismiss feedback use `art-catalog-edit`. Gallery revisit selects an existing UI rendition in page memory. A new request or variation uses `art-request`, explicitly lists selected targets and defaults to all three. Its copy explains that this creates compositions and does not start a physical moment. No read, resize, reconnect or reload repeats either command.

5. **Distinguish admission from work.** Existing `Command` retains request identities and uncertainty locks. Match its request ID to `ArtJobSummary` for background progress and outcome. Keep provider amounts in integer micro-dollars until formatting; show remaining, reserved and uncertain amounts per provider. Preserve the module's reason codes and fixed safe descriptions. Read failures show an explicit retry for reads only. Diagnostics keep the existing ADR 0012 path and never capture prompts, image bytes or DOM text.

6. **Commit visible presentation after decode.** Read and validate the chosen artwork/rendition, fetch through the module image API, and decode before swapping. Cancel obsolete results using effect lifetime/selection identity and release decoded resources. The small React presentation context holds `{presented, status}`; `presented` contains artwork/composition/rendition identities and validated palette, while status distinguishes loading, ready, stale and unavailable. Loading B retains A's presented metadata until B is visible. This context is not an authoritative catalog or durable preference store. The first UI rendition is a rich still; reduced motion keeps it still and disables decorative transitions.

## Risks / Trade-offs

- Automatic art may be omitted on a full Home. The owner can explicitly reserve a card or open Gallery; functional controls retain priority.
- An explicit art row consumes more vertical space than a packed tile. Bounded formats and independent phone placement avoid arbitrary overlap and a new layout engine.
- Sync and image completion can race navigation or newer selection. Selection identity, stale flags and resource cleanup prevent obsolete display and palette changes.
- Metadata saves can conflict or lose replies. Reuse the existing operation lock, revision guard and readback instead of optimistic persistence or retries.
- Catalog content is private. Browser acquisition remains authenticated and disposable evidence uses synthetic fixtures; no provider keys or installed files are accessed.

## Migration Plan

Old Home records remain readable with no art options and retain their arrangements. Current output uses the additive state version, while the existing save family accepts old requests and new optional art metadata. Reconciliation preserves extra art fields. No data deletion, bulk migration or installed action occurs here. Forward deployment and its recovery assessment belong to the selected installation task.

## Validation

Add failing-before contract and model tests for bounded art metadata and fit/interaction decisions, then core persistence/revision tests. Add an integrated browser journey using the real art owner with `SimulatedArt`; count commands and provider calls. Cover 1440, 390 and 320px, light/dark, reduced motion, delayed image replacement, focus/pointer preservation, full-screen omission, saved layout reload/restart/conflict, read-only access and truthful job/spend results. Extend a disposable art scenario with actual Gallery interactions and keep its final UI for independent acceptance. Existing build, type, lint, event, runtime, dashboard, package and workflow checks remain required.
