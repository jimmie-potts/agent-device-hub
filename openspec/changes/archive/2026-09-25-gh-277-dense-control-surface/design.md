## Context

See proposal.md for motivation. The dashboard is one React file: every view, form and hint is inline JSX in `main.tsx`, navigation is one `view` string that mixes built-in page names with component aliases, and `style.css` sizes everything in raw pixels. The shared command lifecycle (`lifecycle.ts`, Hub #245) and the availability rules (`client.ts`) are settled and must not change. The browser checks address controls by accessible name and exact status text, and the layout check fails on overlapping text.

## Goals / Non-Goals

**Goals:** a widget interface any page can place; one card per control, rendered identically on the home and the component page; hash routes with a discriminated navigation value; a skin-owned scale; the existing lifecycle, wording, gating and focus behavior untouched.

**Non-Goals:** owner-editable placement (Hub #366), graph widgets (#283), the wall miniature (#286), the widget inventory (#287), device art and the group page (#271), a light scheme, glossary labels in UI copy.

## Decisions

1. **Widgets are declared in a catalog and rendered by ID (`widgets.ts`).** `widgetCatalog` lists ID, name, description, sizes, source kind, the reads needed and `commands`; `homeLayout` is the developer-chosen placement and `invalidPlacements` checks it against the catalog. Device widgets are one source kind, as the owner asked on 2026-09-25, so hub-route and external widgets register the same way. *Alternative:* React components as the registry. Rejected because #366 needs data it can list and store without rendering.
2. **Control cards are components over one device read (`controls.tsx`).** `deviceControls(component, device, context, api, refresh)` computes availability, the reread and the supported modes once; `ModeCard`, `PowerCard`, `BrightnessCard`, `MediaCard`, `SceneCard`, `LightingCards`, `NanoAssignments` and `PixooMonitor` take that object. The home widget and the component page render the same components, so moving a control is a placement change. Reapply, Start Monitor and the two switches live inside their cards as before.
3. **Routes are a discriminated value (`routes.ts`).** `parseRoute` and `routeHash` map hashes to `{kind:'home'|'component'|'playback'|'connections'|'missing'}`. A link click applies its route in the click event, ahead of the browser's deferred `hashchange`, so two pages are never shown together; modifier clicks keep native behavior. The launcher's `#launch=` fragment is stripped before the dashboard mounts and would parse as `missing` otherwise. *Alternative:* a router library. Rejected: four routes and no dependency budget.
4. **The home mounts only while it is the current route; component pages stay mounted hidden.** Component sections keep drafts and focus across navigation as before. Home widgets are summaries with quick actions, so unmounting them on navigation loses nothing the specification protects and keeps one visible Device mode control per page for the checks.
5. **Rare facts and long guidance go behind disclosures.** `<details>` keeps them keyboard-reachable without a title tooltip. State readouts that a check or a user needs at a glance (override, last read, participation, current assignment) stay visible.
6. **Scale tokens follow the documentation skin's names.** `--space-xs` to `--space-xl` and `--type-body`, `--type-small`, `--type-label`, with dashboard values, plus private `--type-title`, `--type-heading` and `--type-value`. `style.test.mjs` already rejects raw colors and undefined tokens.

## Risks / Trade-offs

- [A card grid could overlap text at narrow widths] → the existing overlap check runs on every captured view at 1440, 1280 and 390 px; closed disclosures are excluded because their content is not rendered.
- [Nav clicks racing the deferred hashchange] → the click handler applies the route synchronously; the checks click a link and immediately look for the new page.
- [Selectors in four browser suites change] → the suites were updated mechanically (buttons became links) and where facts moved behind Details; every scenario still passes.
- [The owner may want a different page split] → the split is settled from this candidate on the PR; the widget interface makes moving a control a placement change.
