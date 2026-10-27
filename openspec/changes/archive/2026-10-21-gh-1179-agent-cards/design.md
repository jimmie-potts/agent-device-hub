## Context

Home currently owns the session JSX and repeats attention in a second panel. The existing session adapter derives names, unread policy and freshness. The approved Cards variant supplies the visual direction.

## Goals / Non-Goals

Export independently composable card, summary and collection components. Keep transport and command ownership outside the presentation card. No dashboard editor, persisted view choice or provider integration.

## Decisions

- A card takes a SessionRow, live evidence, time and an optional action slot. The collection supplies the existing LabelEditor in that slot. This keeps the card reusable without acquiring a connection or sending commands.
- Native details/summary provides whole-face pointer and keyboard disclosure. Content stays mounted, preserving label drafts through collapse and filtering. Key identity includes generation to retire replaced sessions.
- Summary counts use the full collection rather than filtered results. Only current, connected working rows count as working. Attention and unread remain separate retained evidence.
- Keep existing chip vocabulary and fixed semantic chip colors; add amber card surface/border for all attention kinds with written labels. Stale evidence remains explicit, including last-known attention.
- Remove the duplicate attention placement and catalog entry; no persisted layout migration exists in this code-wired catalog.

## Risks / Trade-offs

- Hidden detail actions can break existing journeys → update journeys to open the real disclosure and retain label/no-write assertions.
- Dense facts can overflow phone cards → wrap names/facts and use one column at phone widths; check both themes with axe.
- Stale activity could read as current → stale face label plus last-known state inside, and exclude it from current working counts.

## Migration Plan

Deliver through the normal PR and qualified established-runtime upgrade. No stored format changes. Roll back with the owning runtime procedure if necessary. Synthetic/browser and installed passive readback remain separate.
