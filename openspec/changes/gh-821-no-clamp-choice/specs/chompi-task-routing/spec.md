## REMOVED Requirements

### Requirement: Card answers with the big wheel
**Reason**: Owner decision on #821 (issuecomment-6003766052): a step clamped at the first or last stop no longer chooses the stop that keeps focus. The requirement is replaced as a whole, because its "One turn chooses a focused last button" scenario now describes forbidden behavior and a modified requirement cannot drop a scenario.
**Migration**: "Big-wheel card answers" below carries every other rule and scenario unchanged, replaces the clamp rule with "a clamped step chooses nothing" and replaces that scenario with "A clamped step chooses nothing".

## ADDED Requirements

### Requirement: Big-wheel card answers
While the adapter reports a card in the foreground Codex or Claude window at a qualified version, big-wheel turns SHALL move keyboard focus between the card's stops, as the adapter reports them: for a Claude question card, the answer rows and the "Other" row; for other cards, every actionable button. One step SHALL take `cards.stepCounts` encoder counts, counted in a single accumulator that restarts at zero on a direction reversal, so a small reversal never steps back. Clockwise steps SHALL move to later stops and steps SHALL stop at the first and last stop. With no stop focused, the first clockwise step SHALL focus the first stop and the first counter-clockwise step the last. A big-wheel click SHALL press the focused stop only when the wheel's own step chose that stop on that same card, as the adapter identifies the card; a step SHALL choose a stop only when it moved focus onto it, as the adapter's read-back confirms the requested stop, and a step clamped at the first or last stop, which cannot move focus, SHALL choose nothing, call no adapter and leave any earlier choice from a real move, so a stop the client focused itself, such as a Codex card's approve button, is pressed only after the wheel moves away and back onto it, never by a turn or a click alone; and only when the wheel has not turned for `cards.clickStillMs` before the press, no step is in flight, the repeat window has passed and Record is not held. Otherwise the click SHALL press nothing. Rotation while the click is held SHALL be discarded, and the press SHALL clear partial rotation and steps not yet sent. The press SHALL go through the adapter, which presses the stop only if it still has keyboard focus, in the same card with the same number of stops. An uncertain press MUST NOT be retried. When the card state or the Codex card container is unknown, turns and clicks SHALL do nothing: they neither scroll nor send. Partial rotation SHALL be cleared whenever the wheel acts outside a card, so earlier scroll counts never shorten the first card step. Play MUST NOT press a card button. This deliberately relaxes the rule that a PROMPTI action never approves anything, for this one gesture only: a still big-wheel click on a stop the wheel's step chose may approve a permission request. It is a client UI action and never a Hub acknowledgement, and slot keys, Play and Record still approve nothing.

#### Scenario: Step through a question card's answers
- **WHEN** a Claude question card with three options is open and the owner turns the wheel clockwise step by step
- **THEN** focus moves through the three options and the "Other" row only, and a still click presses the one the wheel reached

#### Scenario: Step through a card
- **WHEN** a Claude permission card is open with the composer focused and the owner turns the wheel clockwise by one step's counts, then by fewer counts than a step
- **THEN** the first card button gets keyboard focus, and the smaller turn moves nothing

#### Scenario: Small reversal
- **WHEN** the owner steps forward and then turns back by fewer counts than a step
- **THEN** focus stays on the button it reached

#### Scenario: Still click presses the focused button
- **WHEN** the wheel has been still for the stillness time and the owner clicks it while the card button the wheel's step chose has focus
- **THEN** the adapter presses that button once and no Enter is typed

#### Scenario: Codex card without focus
- **WHEN** a Codex card opens and Codex gives none of its stops keyboard focus
- **THEN** one clockwise step focuses Deny, the first stop, and a still click presses Deny, while one counter-clockwise step focuses approve, the last stop

#### Scenario: A clamped step chooses nothing
- **WHEN** a Codex card opens with its approve button, the last stop, focused and the owner turns the wheel clockwise by one step's counts and then clicks it while still
- **THEN** the clamped step moves nothing and chooses nothing, and the click presses nothing (`card-nothing-chosen`); after one counter-clockwise step to Deny and one clockwise step back, a still click presses approve once

#### Scenario: Click without a step
- **WHEN** a Codex card opens with its approve button focused, or focus moved to another button or card since the wheel's last step, and the owner clicks the wheel without turning it
- **THEN** no button is pressed, nothing is typed and the big-wheel LEDs flash the error color

#### Scenario: Click while turning
- **WHEN** the wheel click arrives within the stillness time after a turn, or while a step is in flight
- **THEN** no button is pressed and nothing is typed

#### Scenario: Play on a card
- **WHEN** Play is pressed while a card is open
- **THEN** no button is pressed and Send is refused, as `approval-visible` for a Claude card and as `composer-unfocused` for a Codex card, whose focus is on a card button

#### Scenario: Card closes
- **WHEN** the card closes after a press or with the mouse
- **THEN** within the observation reuse time the wheel scrolls again and its click is Send

#### Scenario: Codex card container unknown
- **WHEN** Codex shows no composer and its card container cannot be established, as in a view without exactly one selected sidebar row
- **THEN** wheel turns and clicks do nothing: nothing scrolls, nothing is focused or pressed and no Enter is typed

#### Scenario: Scroll before a card
- **WHEN** the owner scrolls by fewer counts than a step and a card then opens
- **THEN** the first card step still needs a full step of turns made on the card
