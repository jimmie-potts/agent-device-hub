## MODIFIED Requirements

### Requirement: General device controls
The dashboard SHALL offer power, brightness, saved-playlist selection, the declared playback actions and saved-scene activation inside a component's existing view when the controller v1 snapshot declares that capability and the credential has control scope. Each control MUST submit exactly one valid controller v1 command through the existing hub route. The command MUST carry the request ticket, configuration revision and generation from a controller read taken immediately before sending, and it MUST be sent only when that read still allows the control. The control MUST show the receipt or typed failure with pending, conflict and uncertain states in plain wording that says whether anything changed and never presents transport success as a physical result. A power or brightness draft MUST conflict only when the controller's configuration revision changed after the draft began, not when only the generation advanced. After an accepted result that is not uncertain, the draft MUST clear and the control MUST unlock once the refreshed snapshot arrives, with no further action. A disabled control MUST name the missing capability, scope or mode. The dashboard MUST NOT change a mode as a side effect of another command, submit compound writes, restore a previous state automatically, resubmit a rejected command or retry an uncertain command. For a controller whose brightness command is a persisting override, the view MUST present the desired brightness as an override that lasts until the next explicit mode command and MUST show no override as unknown rather than as a value.

#### Scenario: Declared capability with control scope
- **WHEN** the Pixoo snapshot declares power, brightness and media and the credential has control scope
- **THEN** the power, brightness, playlist and playback controls are enabled and each submits one guarded controller v1 command whose outcome is shown

#### Scenario: Nanoleaf power and brightness in every mode
- **WHEN** the Nanoleaf snapshot declares power and brightness and the wall is in Work, Quiet or Free
- **THEN** the power and brightness controls are enabled, each submits one guarded controller v1 command without a mode command, and an accepted brightness is shown as an override that persists until the next explicit mode command

#### Scenario: One-step settings
- **WHEN** a brightness or power change is accepted with an outcome that is not uncertain
- **THEN** once the refreshed snapshot arrives the form shows current values, is unlocked and accepts the next change without another action, and the status says the change was queued, sent or saved without claiming a physical result

#### Scenario: Generation advance between read and send
- **WHEN** the controller generation advances after the view rendered its snapshot but before the user activates a control, while the configuration revision is unchanged
- **THEN** the dashboard reads the controller again, sends exactly one command with the current ticket, configuration revision and generation, and shows no conflict for an open draft

#### Scenario: Generation advance after the fresh read
- **WHEN** the controller rejects a command as `stale-generation` because the generation advanced after the dashboard's fresh read
- **THEN** the status says nothing changed, no command is resubmitted, and the action stays available for another explicit activation

#### Scenario: Missing capability or read-only credential
- **WHEN** a component does not declare a capability or the credential lacks control scope
- **THEN** the corresponding control is disabled with the missing capability or scope named, and the view remains usable with no observed sessions

#### Scenario: Stale revision and uncertain result
- **WHEN** another client changes the controller's configuration after a draft begins, or a submitted command loses its response
- **THEN** the draft is retained, the conflict or uncertainty is shown, the control stays locked after an uncertain result until the user explicitly reloads current values, and reconnect or resync replays no command

#### Scenario: Screen power semantics
- **WHEN** the user turns the Pixoo screen off or on
- **THEN** the command is submitted in Monitor or Media without changing the mode, and the view explains that screen-off pauses playback and screen-on does not resume it

## ADDED Requirements

### Requirement: Explicit same-mode reapply
The dashboard SHALL offer one explicit action to send the active mode again through the existing mode command. For a controller that declares controller v1 modes, including Nanoleaf, **Reapply <mode>** SHALL be available when the observed mode is known and no mode change is pending. It MUST submit exactly one controller v1 `mode.set` for that mode, which ends power and brightness overrides and reapplies that mode's policy. For Pixoo, **Start Monitor** SHALL be available when the integration snapshot shows Monitor configured, presentation not participating and no pending mode change. It MUST submit exactly one Pixoo integration mode operation for Monitor with that extension's guards. It MUST be disabled with the reason while desired screen power is known to be off. Each action MUST read fresh guards before sending, MUST NOT send any other command and MUST NOT be sent automatically. A result reporting that nothing needed reapplying MUST be shown as already in effect.

#### Scenario: Reapply the active Nanoleaf mode
- **WHEN** the wall is in Work with a brightness override and the user activates Reapply Work
- **THEN** exactly one controller v1 mode command for Work is submitted, no other command is sent, and the refreshed view shows no brightness override

#### Scenario: Nothing to reapply
- **WHEN** the controller reports the same-mode command as cancelled with no effects and no failure
- **THEN** the status says the mode is already in effect and nothing was sent, and the action stays available

#### Scenario: Start an inactive Pixoo Monitor
- **WHEN** Pixoo is configured for Monitor but not participating and its screen is not known to be off
- **THEN** Start Monitor submits exactly one integration mode command for Monitor, sends no media command, and disappears once participation is observed

#### Scenario: Screen off
- **WHEN** Pixoo is configured for Monitor, not participating and its desired screen power is known to be off
- **THEN** Start Monitor is disabled and names the screen-off reason
