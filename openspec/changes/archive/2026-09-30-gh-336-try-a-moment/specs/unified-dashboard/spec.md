## ADDED Requirements

### Requirement: Moments card
A component page SHALL show a Moments card, after the Mode, Power, Brightness, Media and Scenes cards, only when the device's snapshot read through the negotiated 1.1 read is a 1.1 snapshot that declares `moments` supported. The card SHALL target only that device and SHALL NOT appear in the home widget. It SHALL offer one button each for `celebrate`, `setback` and `reminder`, labelled with the title-cased ID, and a "More moods" menu listing the other declared moods only when the device declares more than the core three. It SHALL offer duration presets of 5, 10 and 30 s, defaulting to 10 s, showing only presets within the device's `maxDurationMs`. It SHALL show a "Play over agent status" switch, on by default, only when the device declares `coversStatus` supported, and otherwise SHALL send `coversStatus: false`. It SHALL send no palette.

Each press of a mood button or menu choice SHALL go through the shared command lifecycle: it SHALL read the device again, send nothing when that read no longer allows the chosen mood and duration, and otherwise send exactly one `POST /api/controllers/v1/<alias>/moment` with the chosen mood, duration and `coversStatus`. Reads, polls, the faster refresh, reloads and reconnects SHALL send nothing. The card SHALL show the result in words that keep receipts' transmission-only meaning: "<Mood>: Scheduled on <device>." for a queued receipt; "Not played: <device> is in <mode>." for `moment-blocked`; "Not played: it missed its start window." for `moment-missed`; "Not sent: this controller serves API 1.0." and the other not-sent reasons; and "Result unknown", with "Reload current values", for an uncertain result. An uncertain result SHALL lock the card until the user reloads current values and SHALL never be resent. Only an accepted ticket SHALL be watched, and a later terminal receipt for it SHALL replace the result line. A press while a moment is scheduled or playing SHALL send a new moment, which the device's own precedence handles.

The card SHALL show one live line from the snapshot's `state.moment`: "Scheduled: <Mood>", "Playing <Mood>, <n> s left", and the last ending as completed, pre-empted by an alert, superseded or interrupted with how long ago it ended. The last ending SHALL name the mood only for a moment ID this page sent, and otherwise read "Last moment: …". Times SHALL be computed in the controller's clock from the snapshot's sample, and SHALL be omitted when the clock epochs differ. While the card is visible and a moment is scheduled or playing, the page SHALL re-read that device every second, stopping 5 s after the moment ends; otherwise the normal 5 s poll applies, and a hidden card SHALL make no extra reads.

#### Scenario: Card presence
- **WHEN** a component's 1.1 snapshot declares `moments` supported
- **THEN** its page shows the Moments card and its home widget is unchanged

#### Scenario: 1.0 controller
- **WHEN** a component's controller serves only 1.0 or declares `moments` unsupported
- **THEN** the page shows no Moments card and its undeclared-capabilities line names moments

#### Scenario: Moods, presets and switch
- **WHEN** a device declares the core moods plus two extras, `maxDurationMs: 20000` and `coversStatus` supported
- **THEN** the card shows three mood buttons, a two-item "More moods" menu, the 5 s and 10 s presets and a switch that is on, and a core-only device shows no menu

#### Scenario: One send per press
- **WHEN** the owner presses a mood button or chooses a menu mood
- **THEN** exactly one moment request reaches the controller with the chosen mood, duration and `coversStatus` and no palette, and browsing, polling, the faster refresh and a reload send nothing

#### Scenario: Blocked and missed
- **WHEN** the device is in Quiet, or shows status with the switch off, or the moment reaches the device after its start window
- **THEN** the card says the moment was not played and why, and nothing is resent

#### Scenario: Uncertain result
- **WHEN** the moment request loses its answer
- **THEN** the card shows "Result unknown", stays locked until "Reload current values" is pressed, and the controller receives the moment once

#### Scenario: Live line and refresh
- **WHEN** a moment this page sent is scheduled, plays and ends, or a second press supersedes it
- **THEN** the live line moves from Scheduled to Playing to the named ending, the device is re-read every second only while the moment is current and for up to 5 s after, and a card on a hidden page makes no extra reads

## MODIFIED Requirements

### Requirement: No dead controls and distinct disabled buttons

The general controls SHALL show a form only for each of power, brightness, media and scenes that the controller v1 snapshot declares, and one line naming the undeclared ones. That line SHALL also name moments when the snapshot does not declare `moments` supported, without changing whether the general cards show. A component that declares none of the general capabilities SHALL show only one line saying it has no general controls, and that line SHALL also name moments when they are not declared. Every disabled button in the dashboard SHALL use a distinct disabled style from skin tokens, not transparency alone, and the view SHALL keep passing the automated accessibility scan.

#### Scenario: Status-only component
- **WHEN** the Tidbyt or another component declares no general capability
- **THEN** its view shows one line and no Power, Brightness, Media or Scenes form

#### Scenario: Partly declared component
- **WHEN** a LIFX bulb declares power and brightness only, or the Pixoo declares everything except scenes and serves controller contract 1.0
- **THEN** only the declared forms appear, followed by one line such as "Not declared by this controller: scenes and moments."

#### Scenario: Moments declared
- **WHEN** a 1.1 wall declares power, brightness, scenes and moments
- **THEN** its line reads "Not declared by this controller: media." and the general cards show as before

#### Scenario: Disabled button
- **WHEN** a control is unavailable
- **THEN** its button's computed background and text colors differ from an enabled button's, and it is not clickable
