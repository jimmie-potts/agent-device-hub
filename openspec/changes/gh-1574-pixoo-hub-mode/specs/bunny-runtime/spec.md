## ADDED Requirements

### Requirement: Current art policy gates each surface independently of device mode
Before each scheduled browser, moment or initial ambient selection dispatch, the runtime SHALL recheck the current enabled policy, opportunity validity, quiet hours, its exact reservation under current budgets and spacing, and attention/owner protections. Configured target identity, current owner membership, availability, holds, capability, generation and successful preparation SHALL be checked through the existing presentation path. Each target SHALL have its own duration and result under a fixed common start and cutoff. Default appearances SHALL request 30 seconds on Tidbyt and 10 seconds on Pixoo, within current declared capabilities. Tidbyt appearances SHALL stay within the owner's 30-to-60-second range; a target unable to accept its selected duration SHALL be skipped rather than sent an unsupported request. A slow, missing or unsupported target SHALL NOT delay another or move the start. No schedule SHALL change a device mode or restore an old base snapshot.

#### Scenario: Policy changes during preparation
- **WHEN** quiet hours start, attention arrives, the owner disables the policy or the opportunity expires while preparation waits
- **THEN** the affected unsent presentation is refused with its reason even if preparation later succeeds
- **AND** ready permitted surfaces retain independent outcomes without a retry

#### Scenario: Mixed display capabilities
- **WHEN** one configured display can play exact art, another lacks art or required notice support, and the browser is enabled
- **THEN** only supported permitted dispatches occur, each uses its configured ID and allowed duration, and the unsupported target is explicitly skipped

#### Scenario: Each display receives its supported default duration
- **WHEN** both configured displays declare support for their default appearance and the opportunity is permitted
- **THEN** the Tidbyt request has durationMs 30000, the Pixoo request has durationMs 10000, and both retain the fixed common start with independent outcomes
- **AND** if either target cannot accept its selected duration, it is skipped without shortening Tidbyt below 30 seconds or delaying the other target

#### Scenario: Owner presentation takes precedence
- **WHEN** a device has attention, an owner pin, a paused item or a Now Playing takeover, or the owner is browsing a saved Gallery choice
- **THEN** art cannot displace the protected presentation and no mode command is sent to make it eligible
- **AND** an admitted device moment yields and returns through that device's current-base behavior

#### Scenario: The status base remains eligible without a mode write
- **WHEN** the configured Pixoo shows its status base with the player holding no item and its owner declares the exact-art request eligible
- **THEN** an otherwise permitted appearance may be requested without a mode write
- **AND** attention, an owner pin, uncertain writer state, a stale playback generation, a Now Playing takeover, or Work without permission to cover status still blocks replacement

## REMOVED Requirements

### Requirement: Current art policy gates each surface independently
**Reason**: Its "Empty Media remains eligible" scenario described a Pixoo state that no longer exists once the Pixoo takes the Hub mode as policy and rests on the status base whenever the player holds no item (ADR 0014).
**Migration**: The requirement continues as "Current art policy gates each surface independently of device mode" with the status-base scenario in place of the empty-Media one; the scheduler's dispatch and duration rules are unchanged.
