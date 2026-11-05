## ADDED Requirements

### Requirement: Runtime art plans keep each surface independent
The current runtime's automation owner SHALL support one saved artwork with a separate composition and bounded duration for each participating display, plus an optional browser selection. Eligible displays SHALL receive the same best-effort start instant. Each display SHALL have its own tracked result. Missing, slow, rejected or uncertain targets SHALL NOT prevent other ready targets from being handed off at that instant. Preparation SHALL be free of provider calls and display effects. A target that misses preparation or dispatch deadlines SHALL be recorded truthfully and SHALL NOT be resent.

#### Scenario: Different display shapes and durations
- **WHEN** one artwork has a Pixoo composition, a Tidbyt composition and a browser composition
- **THEN** each selected surface receives its own composition, the two displays receive the same start instant with their own qualified durations, and each operation remains independently observable

#### Scenario: One display cannot prepare
- **WHEN** one target refuses, is absent or remains pending past the selected deadline
- **THEN** other ready targets can still proceed and the failed target is not retried or allowed to change their start time

#### Scenario: Changed timing cannot revive an expired intent
- **WHEN** preparation succeeds after its cutoff and the same plan ID is submitted with changed timing, including after restart
- **THEN** the core refuses the conflicting complete plan before any preparation or presentation command, and retains that identity without eviction

#### Scenario: Identity storage fails before dispatch
- **WHEN** the core cannot commit the complete plan's identity receipt
- **THEN** no preparation, display moment or browser selection is sent and no executable plan is recovered later

#### Scenario: Policy evaluation crosses a deadline
- **WHEN** the final synchronous policy check finishes after the target's dispatch deadline
- **THEN** the core refuses that handoff without moving its original start or sending a late browser selection

### Requirement: Runtime art dispatch requires current owner capability
Runtime art dispatch SHALL resolve actual configured identities from current owner state and require affirmative current `moments.art` support. It SHALL send art-bearing 2.1 moments only through the core's tracked dispatcher and each display's existing writer. Stale, missing, held or unsupported evidence SHALL prevent that target's dispatch. Ordinary moments SHALL retain their existing behavior. Art dispatch SHALL preserve explicit pauses, attention, pins, mode selection and each device's own precedence.

#### Scenario: A display has a noncanonical identifier
- **WHEN** a qualified Pixoo is configured as `desk-display` rather than `pixoo`
- **THEN** its exact-art command targets `desk-display` under its recorded owner and no guessed identity is contacted

#### Scenario: A client attempts an art-bearing moment
- **WHEN** a requester other than the core submits an art-bearing moment through tracked dispatch
- **THEN** it is refused before any device command or receipt implying dispatch

#### Scenario: Capability becomes stale
- **WHEN** the device owner's copy becomes stale or no longer declares art support before hand-off
- **THEN** that target receives no art command while other independently qualified targets remain eligible

