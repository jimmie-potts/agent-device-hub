## Why

[Hub #277](https://github.com/jimmie-potts/agent-device-hub/issues/277): once signed in, the owner sees long single-column pages. The wall component page stacks a ten-row fact list and about twelve forms, each with its own heading, guidance and status line, so it is 3,624 px tall at 1,280 px wide (Hub `ba08043`) and its selects stop at half the column. The Activity page spends its first screen on a hero and a stats strip before any session appears. [ADR 0007](../../../docs/decisions/0007-bunny-shell.md) makes this dashboard the B.U.N.N.Y. shell whose starting page is a home of widgets, so the layout has to become a dense control surface now, before the widget stories build on it.

## What Changes

- The home is a widget grid. Every widget comes from a catalog that declares its ID, name, description, sizes, source kind (a controller alias, a hub route or a read-only external source), the reads it needs and whether it has command actions. One component widget per registered component shows health, mode, power, brightness and the everyday mode and power actions, rendered by the same controls as the component page, with a link to that page. Attention, collector and sessions are widgets in the same grid; sessions are compact rows with an inline label field and their retained notices under the row.
- Every page has a hash address (`#/`, `#/component/<alias>`, `#/music/<source>`, `#/connections`) and the back button walks the history. Built-in pages and components are distinct navigation kinds, so a component alias of `activity` or `connections` opens only that component ([Hub #247](https://github.com/jimmie-potts/agent-device-hub/issues/247)'s outcome, delivered here because the routes need it).
- A component page shows a one-line status strip, keeps the rare facts behind a Details disclosure, and renders every control as a card in a grid that fills the width: Mode with Reapply or Start Monitor, Power, Brightness, Media with the Media switch, Scenes with the Free switch, and the LIFX color cards. Each card keeps one short visible line; longer guidance sits behind a Help disclosure. Nanoleaf's settings and mappings sit in one Assignments panel and the Pixoo view form in one Monitor panel.
- **No Apply buttons** (owner decision on the design candidate, 2026-09-25): a select or toggle sends when changed, a slider sends once when released or after a keyboard pause, a text field sends when left or submitted, and Power is a button that names the one action left (Turn on / Turn off; both when power is unknown). Choosing a playlist starts it and choosing a scene activates it. Every send is still one guarded command from a fresh read; an uncertain result still locks until an explicit reload; a rejected change shows the current value again with its status. The draft-and-conflict rule for device controls is retired.
- Connections is a two-card page. The login is one line and the token disclosure.
- The application skin defines the spacing and type scale (`--space-*`, `--type-*`) and the layout reads only tokens.
- What a control sends does not change: one guarded controller v1 or integration command per gesture, the shared command lifecycle, the exact status sentences, capability and permission gating, keyboard order, the skip link, focus restoration, reduced motion and the served asset set are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `unified-dashboard`: adds page addresses with distinct built-in and component kinds, the home widget grid and catalog, the dense component page, and the skin-owned scale; modifies the general device controls, content controls, integration commands, reconnect, shared lifecycle, power control and LIFX requirements for sending without an Apply button. The approval requirement is unchanged.

## Impact

`apps/dashboard/src/main.tsx`, `controls.tsx` (new, the control cards moved out of `main.tsx`), `routes.ts` (new), `widgets.ts` (new), `style.css`, `skins/neon-geometry-wars.css`; the browser, matrix, retirement and local-controllers checks whose selectors and texts changed, plus new route, widget and density checks; the dashboard README, `docs/development.md` and style guide sections 4, 7 and 12. No hub route, controller contract, fixture, credential or device behavior changes. Source-only: no installation or device operation. The owner's UI approval of the candidate is required before merge.
