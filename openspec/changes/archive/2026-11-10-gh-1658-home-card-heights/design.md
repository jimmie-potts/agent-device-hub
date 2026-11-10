## Context

`WidgetSize` set a flex basis only (`src/home-layout.css`), and the Home grid aligned cards to the top of each row with no height rule. Inbox rendered every open item, Agent status every session tile and Timeline 20 entries at a time with **Show more**.

## Goals / Non-Goals

**Goals:** cards in a wide-layout row line up at one height; list cards page instead of growing; expanded entries keep their controls inside the card; focus never falls to the page body.

**Non-Goals:** standard sizes on pages other than Home; reducing how many Inbox items open (#1657); accessibility criteria (owner decision 2026-11-10); changes to which items exist or how they are handled.

## Decisions

- **Height.** One token, `--home-card-height`, on the Home grid. Its value, 820 px, is the tallest card without a list rendered on 2026-11-10 (the Pixoo card, 811 px at Standard width, with synthetic records) plus a small margin; the lighting, Tidbyt, Reachy and MicroDuck cards measured 675 to 740 px. Each card's content area takes it as a minimum and the grid stretches each row, so a card that outgrows the token makes its row taller rather than clipping its controls. The edit bar sits above the content area, so editing does not change the content's height. Wrappers between the Home slot and the bordered card (lighting, Music, Wemo and companion wrappers) pass the height down, and the Reachy page wrapper's card margin is removed on Home so its border lines up. The browser journey asserts that a row of standard cards is exactly the token, so a card that starts to exceed it fails the check.
- **Opt-out.** `tall: true` on a widget catalog entry (art, music visualizer) drops the minimum for that card; `home-catalog.ts` carries it to the Home card definition and `home-layout.tsx` adds a class. No card is opted out by ad hoc CSS.
- **Art.** The art row keeps block layout, because art sizes its own reservation. Art and the scheduled-art notice react only while the art is visible, so with taller rows the art journeys use a taller viewport to keep the art row in view.
- **Narrow screens.** At `max-width: 600px` and in the Phone arrangement, cards drop the minimum and the grid aligns to the top.
- **Paging.** `PagedList` owns the page index, the pager and focus repair; `paging.ts` holds the arithmetic and the rows per page: Inbox 7, Timeline 5 on Home and 20 on its page, and Agent status two rows of tiles at the grid's current column count, read with a `ResizeObserver`. Fixed counts were chosen from measured full pages (Inbox 7 rows about 710 px at Small width, Timeline 5 entries 716 to 746 px, Agent status two rows 638 to 698 px) so each fits the token.
- **Mounted rows.** Every row stays mounted and the caller hides off-page rows, so open evidence and unsent label drafts survive a page change, as the session filter already did.
- **Expansion.** In Inbox and Timeline, opening a row's first disclosure gives that row the page and hides the pager; closing it restores the page. Agent status opts out (`expandAlone={false}`): hiding the other tiles would hide another session's attention, so an opened tile stays beside the others and may make its row taller. The Hub mode card's Check Inbox first moves the list to the item's page during render, so the existing focus effect finds it visible.
- **Focus.** The pager moves focus to the other button when one becomes disabled. After a render in which the last focused element in the list was removed or hidden, focus moves to the first visible control in the list, or the list itself when it is empty.

## Risks / Trade-offs

- A card whose content grows past the token (long names, many controls, an opened Inbox evidence section) makes its whole row taller. This is preferred to clipping controls or scrolling inside a card.
- Fixed rows per page leave space unused in some cards; deriving counts from measured row heights was rejected as fragile.
- 820 px rows leave short cards such as Hub mode with empty space; the owner approves the height from screenshots before merge.
- Taller rows push later cards and art further down Home. The art theme and the scheduled rain notice follow art only while it is on screen, so on a short screen they wait until the owner scrolls to the art.

## Migration Plan

None. The change is browser-only and saved layouts are read unchanged. Reverting it restores content-height cards and unpaged lists.
