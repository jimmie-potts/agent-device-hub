## MODIFIED Requirements

### Requirement: Control page
The control page SHALL show the simulated controller (15 slot keys, 10 black keys, Record, Play, Loop, knobs 1-4, the big wheel and volume, with every LED's color and profile name), the simulated windows with the foreground, selected task, composer focus and text, any card with its focused stop, and each client's model, effort level and open model menu, Effort slider, picker or model list with its focused entry, the Hub sessions with their slots, the synthetic system volume and mute state, the desktop key and press log including each system volume key and each picker change, and the bridge's log. Controls SHALL press, hold, release, turn and click through the simulator's protocol input, and SHALL script the desktop and the synthetic Hub. Every control SHALL be keyboard-operable and labelled, each light SHALL be named by what its role can show rather than by the first matching color (knob 4's LED by the visible task page, such as `page 2`, or `attention` while it alternates for a hidden page; knob 4's LED also as `error` after a refused Attention click; a black key mapped to `attention` as `attention`, `error` or `off`; the volume knob's LED as `error` or `off`; knob 1's and knob 2's LEDs as `active`, `applied`, `unknown`, `error` or `off`), and the page SHALL make no external request. Knob 4's turn SHALL start at one page step, the big wheel's at one card step, the volume knob's at one volume key and knobs 1 and 2 at one model or effort step, all from the run's profile. Names starting with `control-` SHALL be labelled as negative controls, not catalog scenarios. The harness API SHALL accept only JSON from the run's own origin and host.

#### Scenario: Keyboard hold
- **WHEN** a reviewer holds Space on the Record key
- **THEN** the simulator reports the key down, the desktop holds the dictation chord, and both release when Space is released

#### Scenario: Accessibility
- **WHEN** the page is checked with axe for WCAG 2.1 A and AA at 1440 px and at phone width
- **THEN** it reports no violations

#### Scenario: Paging from the page
- **WHEN** a reviewer turns knob 4 right by its default counts from the page
- **THEN** the bridge shows page 2, knob 4's light reads `page 2`, and no window comes to the front

#### Scenario: Volume from the page
- **WHEN** a reviewer turns the volume knob right and clicks it from the page
- **THEN** the desktop log shows a system volume key for each with no client input, the system volume reads 52% and muted, and no window comes to the front

#### Scenario: Effort from the page
- **WHEN** a reviewer brings Claude to the front, focuses its composer and turns knob 2 right by its default counts from the page
- **THEN** the Claude window shows effort Medium with the Effort slider open, knob 2's light reads `applied`, the desktop log shows the effort change, and knob 2's click closes the slider with nothing sent

### Requirement: Shared scenario catalog
The bridge SHALL keep one scenario catalog of seeds and named steps (actions, bounded expectations and held observations). An in-memory runner SHALL run it against the real CLI with `--simulate --desktop sim` on a manual clock in CI (Tier 1), and a run seeded with a catalog scenario SHALL run the same steps from its control page (Tier 2). Both tiers SHALL wait until the run is ready (controller connected, feed current, every seeded task on a slot, and every one on the visible task page on a lit slot key) before the first step; a Tier 2 run that is not ready within its bound SHALL record a failed readiness step with what it observed and act on nothing, and the page SHALL keep its run control disabled until the run is ready. A failed step SHALL name what was observed and stop the scenario. The catalog SHALL cover Send to the window in front and its refusal in another app with the red wheel flash, Record holding the dictation chord, a Claude question card answered with the wheel with a click without a turn refused, a Codex card with no focus answered by structure, reconnect with no replay, a profile reload, and task pages with more than 15 tasks: knob 4 pages only on a deliberate turn, a page-2 task opens with its slot key, a hidden page's attention shows on knob 4's LED without switching pages, the release gesture acts on the slot a key showed when it was pressed although the page changed during the hold, and paging sends no input and keeps the window in front; the Attention click on knob 4 across pages: refusal with nothing waiting and a red knob 4 LED that returns to the page color, the first-seen task on page 2 before a later one on page 1, a repeat click moving on, the earliest again after the repeat window, read-only Hub requests, attention kept and no black key lit; the volume knob: detents and mute changing the synthetic system volume with no client input, and the knob ignored during Record with the chord unchanged; and the model and effort knobs for both clients: a Claude model step and pick confirmed by the Model button and the session record, Claude effort steps confirmed and a slider closed by the timeout, unsupported effort on a model without an Effort button, a Codex model step and pick confirmed by the announcement with the picker closed afterwards, Codex effort steps through Power up to the top with nothing sent there, and refusals with a card open or another app in front, plus Play with the model menu open closing the menu before Send; none of them sends a prompt.

#### Scenario: Tier 1 in CI
- **WHEN** `npm run test:chompi-bridge:scenarios` runs
- **THEN** every catalog scenario passes in memory, and a reviewer can name scenarios to run or list them

#### Scenario: Tier 2 capture
- **WHEN** a capture step for a catalog scenario runs on a freshly seeded run
- **THEN** the page runs the scenario, every step passes, and the capture keeps a screenshot, video and the scenario result

#### Scenario: Run right after a reseed
- **WHEN** a reviewer runs a catalog scenario from the page immediately after the run is seeded, while the controller is still connecting
- **THEN** the run waits until it is ready, and the first press reaches the connected controller

#### Scenario: Regression caught
- **WHEN** the behavior a step observes breaks, such as a Codex card that cannot be established
- **THEN** the scenario fails at that step with what was observed

#### Scenario: Task pages in both tiers
- **WHEN** the `task-pages` scenario runs in memory and from the control page of a run seeded with it
- **THEN** every step passes in both tiers, from a seed of 18 tasks across two pages

#### Scenario: Attention click and volume knob in both tiers
- **WHEN** the `attention-key` and `volume-knob` scenarios run in memory and from the control page of runs seeded with them
- **THEN** every step passes in both tiers

#### Scenario: Knob scenarios in both tiers
- **WHEN** the `claude-model-knob`, `claude-effort-knob`, `claude-effort-unsupported`, `codex-model-knob`, `codex-effort-knob` and `knob-refusals` scenarios run in memory and from the control page of runs seeded with them
- **THEN** every step passes in both tiers
