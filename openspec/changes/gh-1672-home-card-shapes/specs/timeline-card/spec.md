## MODIFIED Requirements

### Requirement: Reusable placeable Timeline

The dashboard SHALL offer Timeline in the existing Home picker and reuse the
same card on the Timeline page. Existing saved layouts SHALL remain unchanged
until explicitly edited. On the Home unit grid Timeline SHALL offer all four
shapes: one row shows its latest entries and Open Timeline, Tall adds the period,
refresh and paging, and Large square adds the category filters; every control a
shape leaves out SHALL remain on the Timeline page. Phone and narrow layouts and
the Timeline page SHALL show the full card.

#### Scenario: Add and retain the card

- **WHEN** the owner adds, moves, changes the shape of or hides Timeline and saves Home
- **THEN** reload retains the arrangement through the existing Home layout owner
- **AND** Timeline renders the same evidence on either surface, with the controls its shape shows

#### Scenario: Timeline in one unit

- **WHEN** Timeline is a Small square on Home
- **THEN** it shows its latest two entries and Open Timeline, with no pager, and Open Timeline leads to the full card
