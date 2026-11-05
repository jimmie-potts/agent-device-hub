## ADDED Requirements

### Requirement: One owner-controlled daily art policy
The runtime SHALL keep one private, revision-checked art policy under its existing automation owner. The policy SHALL select configured surfaces, host-local waking hours, six, seven or eight appearance opportunities, ambient updates, generation, weather use and explicit permission to cover status. New policy SHALL be disabled until explicitly enabled. Existing event rules, routines, quiet hours and budget settings SHALL retain their shapes and behavior; writing them SHALL NOT reset art settings. Art scheduling SHALL work without an open browser.

#### Scenario: Owner saves and enables a policy
- **WHEN** an authenticated control user saves a valid waking interval and seven appearances, then enables the policy
- **THEN** the saved revision survives restart, configured targets read back, and future opportunities are planned independently of the browser
- **AND** a stale revision, read-only caller or authority revoked while the request body is read causes a typed refusal without a partial write

#### Scenario: A legacy settings client edits quiet hours
- **WHEN** a client writes the existing automation settings without any art policy fields
- **THEN** quiet hours change while the saved art policy and its enabled state remain intact

### Requirement: A varied waking-day rhythm without catch-up
The runtime SHALL plan bounded morning, daytime and evening appearance opportunities within the selected waking interval when space permits, with at least 45 elapsed minutes between appearances. Choice and clock inputs SHALL be controllable in tests. Quiet hours, insufficient waking time and missed windows SHALL reduce delivered opportunities rather than compress spacing or create catch-up work. Restart, re-enabling, forward clock jumps and repeated local hours SHALL schedule only future unclaimed opportunities. Crossing midnight SHALL NOT reset spacing or allow a repeated claim.

#### Scenario: An ordinary waking day
- **WHEN** a fixed clock and choice input exercise a waking interval that can fit the selected count
- **THEN** planned opportunities include early, middle and late parts of that interval, are not less than 45 minutes apart, and use only waking times outside quiet hours

#### Scenario: Short intervals and local-clock changes
- **WHEN** the interval cannot fit the count, daylight-saving time skips or repeats an hour, or a restart occurs after several opportunities
- **THEN** the runtime explains skipped opportunities and plans only eligible future ones, with no repeated slot or compressed spacing

### Requirement: Durable claims precede art effects
The runtime SHALL durably identify each art opportunity, generation request and per-target attempt before sending it. One appearance SHALL count once across its surfaces, and uncertain or lost answers SHALL remain counted. The daily count, 45-minute spacing, existing moment budgets and provider dollar limits SHALL be independent protections. Concurrent triggers, duplicate occurrences, crashes and late outcomes SHALL NOT resend an automatic generation request or a presentation attempt. Storage failure before a claim SHALL cause no effect.

#### Scenario: A crash follows a durable claim
- **WHEN** the runtime claims an appearance and crashes before learning whether its first target accepted it
- **THEN** restart retains the reservation, sends no replacement and keeps the unresolved result distinct from success

#### Scenario: Concurrent triggers share a budget
- **WHEN** an hourly tick, a new weather observation and a scheduled appearance arrive together
- **THEN** bounded arbitration coalesces related work, reserves at most the allowed appearance and does not multiply the paid request or target attempt

### Requirement: Current art policy gates each surface independently
Before each browser, moment or ambient presentation dispatch, the runtime SHALL recheck the current enabled policy, opportunity validity, quiet hours, budgets and attention/owner protections. Configured target identity, current owner membership, availability, holds, capability, generation and successful preparation SHALL be checked through the existing presentation path. Each target SHALL have its own duration and result under a fixed common start and cutoff. A slow, missing or unsupported target SHALL NOT delay another or move the start. No schedule SHALL change a device mode or restore an old base snapshot.

#### Scenario: Policy changes during preparation
- **WHEN** quiet hours start, attention arrives, the owner disables the policy or the opportunity expires while preparation waits
- **THEN** the affected unsent presentation is refused with its reason even if preparation later succeeds
- **AND** ready permitted surfaces retain independent outcomes without a retry

#### Scenario: Mixed display capabilities
- **WHEN** one configured display can play exact art, another lacks art or required notice support, and the browser is enabled
- **THEN** only supported permitted dispatches occur, each uses its configured ID and allowed duration, and the unsupported target is explicitly skipped

#### Scenario: Owner presentation takes precedence
- **WHEN** a device has attention, an owner pin, an explicit pause or a Now Playing takeover, or the owner is browsing a saved Gallery choice
- **THEN** art cannot displace the protected presentation and no mode command is sent to make it eligible
- **AND** an admitted device moment yields and returns through that device's current-base behavior

### Requirement: Ambient reuse and generation have separate authority
Ambient updates SHALL be noninterrupting, at most hourly from the timer and additionally on eligible live weather changes. The runtime SHALL keep a bounded coalesced opportunity rather than an event backlog. Automatic generation SHALL NOT itself grant presentation permission. Generation-disabled, unavailable-provider, exhausted-budget or late-job conditions SHALL permit one bounded saved-art fallback, with no model call for reuse and no new presentation when no usable saved art exists. An ambient authorization SHALL be limited to its exact live opportunity, target, composition and one attempt, and SHALL be revoked on stop, expiry or policy change.

#### Scenario: Generation finishes after the window
- **WHEN** a job is admitted but finishes after its scheduled appearance has selected a saved fallback or expired
- **THEN** its new catalog entry causes no late appearance or ambient selection for that opportunity

#### Scenario: Old weather occurrences return after restart
- **WHEN** a synced snapshot or replayed weather occurrence describes a previously observed change
- **THEN** it causes no catch-up ambient update, while fresh state can inform a later future opportunity

### Requirement: Fresh forecast evidence remains separate from decorative art
The runtime SHALL derive a factual rain notice only from an enabled, qualified, fresh weather record covering the selected future forecast hour within the next two hours. A notice SHALL distinguish likely rain from a chance and carry its forecast interval, observation/stale times and source revision. The source's current-hour forecast SHALL NOT be described as an observed measurement. Each required factual presentation SHALL carry its deterministic label; unsupported targets SHALL skip. Missing, disabled, stale, unrelated or superseded evidence SHALL authorize no factual notice. Generated artwork SHALL remain decorative with factual provenance false.

#### Scenario: Fresh approaching rain
- **WHEN** an enabled weather owner publishes a fresh forecast with a chance of rain in the next two hours and an eligible appearance is selected
- **THEN** the notice names that forecast interval and chance, each admitted target receives the same source meaning, and generated image prompts contain no notice payload or private source facts

#### Scenario: Source is disabled or becomes stale
- **WHEN** schedule weather use is disabled, or its record becomes stale while a factual opportunity waits
- **THEN** disabled scheduling opens no source subscription or read, stale evidence is not dispatched as fact, and no invented rain or meeting substitutes for it

#### Scenario: There is no qualified meeting source
- **WHEN** no enabled qualified calendar owner exists, or the only event is an agent turn ending
- **THEN** the runtime performs no calendar read and makes no meeting, milestone or successful-task claim

### Requirement: Art results report the evidence actually held
The existing Automation workspace SHALL expose current policy, upcoming opportunity, suppression reason and separate generation, preparation, browser-selection and display operation references. A tracked dispatch SHALL NOT be presented as completion. A browser selection completion SHALL NOT establish decoding or visibility, and transport evidence SHALL NOT establish a physical observation. Failed, expired, uncertain, conflicting and unsupported results SHALL remain distinguishable without automatic resend.

#### Scenario: Only some surfaces complete
- **WHEN** the browser selection commits, one display reports transmission and another loses its reply
- **THEN** the workspace identifies those separate facts, shows uncertainty for the lost reply and claims neither all-surface delivery nor physical visibility

## MODIFIED Requirements

### Requirement: Automation controls

The dashboard SHALL provide one Automation page for event rules, weekly routines, interrupt set, budgets, quiet hours, art policy and logs through the authenticated gateway. Read calls SHALL require read scope; mutations SHALL require control scope and bunny-request:1. Rules created without explicit owner enabling SHALL remain disabled. Weekly routines SHALL use the Hub-owned scheduling path and operating limits in bunny-power-schedules; event rules SHALL retain their existing behavior. The browser and generic event-rule paths SHALL make no model call. Optional art generation SHALL use only the Art owner's existing automatic admission and spending protections. No device-specific browser scheduler or personal-content publication SHALL be introduced.

#### Scenario: Owner creates a rule
- **WHEN** the owner creates and enables a valid event rule through the authenticated page
- **THEN** its targets and shape are checked before storage and the core can evaluate it independently of the page

#### Scenario: A pending write loses authority
- **WHEN** an Automation mutation lacks control scope or bunny-request:1, or its original credential is revoked or rotated while its body is being read
- **THEN** the gateway returns the shared refusal code without changing rules or settings, records the refusal without request data, and leaves the core running

#### Scenario: Rule and log controls
- **WHEN** the owner reads or edits rules, the interrupt set or settings and inspects the Automation log
- **THEN** bounded authenticated routes preserve the existing shapes under automation/2.0, rules remain disabled unless explicitly enabled, and log entries identify admission separately from any tracked terminal outcome
