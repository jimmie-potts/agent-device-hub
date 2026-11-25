## ADDED Requirements

### Requirement: A card's rendering error stays in its card

The runtime dashboard SHALL contain an error thrown while a card renders, or from one of its effects, to that card: each Home card, each device card on a component page and a module page on its route. The failed card SHALL keep its place and size, SHALL say plainly that it failed, SHALL show no stale content and no control except one Retry, and the Retry SHALL mount the card again without sending a command. Every other card, the rail, the feed indicator and navigation SHALL keep working. A change of the card's identity SHALL reset its failed state, and a card that fails again after a Retry SHALL be contained again without retrying by itself. Each failure SHALL be recorded once through the SDK's `recordLog` at the level its code table gives, with the card's identity and the error's type and never the error's message, stack or cause. The page SHALL also report the error as a page error, and the browser journeys SHALL fail on a failed card they did not expect, naming it.

#### Scenario: A Home card throws while it renders or from an effect

- **WHEN** one Home card throws on its first render, or from an effect
- **THEN** the page stays mounted and that card shows its name, that it failed and a Retry in its own place, at 1440 and 390 px in light and dark
- **AND** another card updates and opens, Settings opens and Home returns
- **AND** one `dashboard.card.failed` record names the card and the error's type

#### Scenario: Retry

- **WHEN** the owner chooses Retry on a failed card
- **THEN** the card mounts again and shows its content, or, if it throws again, its failure with one more record
- **AND** no command was sent by the failure or the Retry

#### Scenario: A component or module page throws

- **WHEN** a device card on its component page or a module page on its route throws
- **THEN** its heading, tabs, the rail and navigation stay, and another module page shows when the route changes

#### Scenario: A journey meets a failed card

- **WHEN** a browser journey checks the feed while a card it did not expect to fail is in the failed state
- **THEN** the journey fails with the card's identity and the error's type
