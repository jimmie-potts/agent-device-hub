## ADDED Requirements

### Requirement: A card's rendering error stays in its card

The runtime dashboard SHALL contain an error thrown while a part renders, or from one of its effects, to that part: each Home card, including the work that picks its content, each device card on a component page, including the work that picks its card, a module page on its route, the Settings, Companions, Habitat, Timeline, Automation and Connections pages, the device directory, the rail's conversations and the art backdrop source. A failed card or page SHALL keep its place, SHALL say "<name> failed to show. Retry draws it again and sends nothing.", SHALL show no stale content and no control except one Retry, and the Retry SHALL draw the part again without sending a command; a failed page SHALL keep its heading. The device directory SHALL show its failure on its own route and draw nothing elsewhere, and the backdrop source SHALL draw nothing. Every other part, the rail, the feed indicator and navigation SHALL keep working. A change of the part's identity SHALL reset its failed state without mounting the new part twice, and a part that fails again after a Retry SHALL be contained again without retrying by itself. Each failure SHALL form one record through the SDK's `recordLog` at the level its code table gives, with the part's identity and the error's type and never the error's message, stack or cause; the record stays in a bounded in-page log and is not delivered until a browser relay is adopted. The page SHALL also report the error as a page error where the browser offers `reportError`, and SHALL NOT throw where it does not. The browser journeys SHALL fail on a failed part they did not expect, naming it, whether it is seen at a health check or fails after the journey's last one. A fault in the shell itself, and an error thrown from an effect's cleanup as its part leaves the page, are not contained.

#### Scenario: A Home card throws while it renders or from an effect

- **WHEN** one Home card throws on its first render, or from an effect
- **THEN** the page stays mounted and that card shows its name, that it failed and a Retry in its own place, at 1440 and 390 px in light and dark
- **AND** another card updates and opens, Settings opens and Home returns
- **AND** one `dashboard.card.failed` record names the card, the code `internal` and the error's type

#### Scenario: Retry

- **WHEN** the owner chooses Retry on a failed card
- **THEN** the card draws again and shows its content, or, if it throws again, its failure with one more record
- **AND** no command was sent by the failure or the Retry

#### Scenario: A component or module page throws

- **WHEN** a device card on its component page or a module page on its route throws
- **THEN** its heading, tabs, the rail and navigation stay, and another module page shows when the route changes, mounted once

#### Scenario: A route page or an always-mounted part throws

- **WHEN** the Automation page throws on its route, or the device directory throws while Home is shown
- **THEN** the page stays mounted; the Automation page shows its failure under its heading, and the directory draws nothing on Home and shows its failure on the Devices page
- **AND** Retry draws each again once it no longer throws

#### Scenario: A journey meets a failed card

- **WHEN** a browser journey checks the feed while a card it did not expect to fail is in the failed state, or a card fails after the journey's last check
- **THEN** the journey fails with the card's identity and the error's type, at the check or when its world closes
