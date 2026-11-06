## ADDED Requirements

### Requirement: One owner-controlled daily art policy
The runtime SHALL keep one private, revision-checked art policy under its existing automation owner. The policy SHALL select configured surfaces, host-local waking hours, six, seven or eight appearance opportunities, ambient updates, generation, weather use and explicit permission to cover status. New policy SHALL be disabled until explicitly enabled, with generation off until explicitly selected. Existing event rules, routines, quiet hours and budget settings SHALL retain their shapes and behavior; writing them SHALL NOT reset art settings. Art scheduling SHALL work without an open browser.

#### Scenario: Owner saves and enables a policy
- **WHEN** an authenticated control user saves a valid waking interval and seven appearances, then enables the policy
- **THEN** the saved revision survives restart, configured targets read back, and future opportunities are planned independently of the browser
- **AND** a stale revision, read-only caller or authority revoked while the request body is read causes a typed refusal without a partial write

#### Scenario: A legacy settings client edits quiet hours
- **WHEN** a client writes the existing automation settings without any art policy fields
- **THEN** quiet hours change while the saved art policy and its enabled state remain intact

### Requirement: A varied waking-day rhythm without catch-up
The runtime SHALL plan bounded morning, daytime and evening appearance opportunities within the selected waking interval when space permits, with at least 45 elapsed minutes between appearances. One owning admission/planning rule SHALL require a new appearance's earliest start to be at least 45 minutes after the preceding claim's latest permitted start, startAtMs plus toleranceMs. This conservative bound SHALL persist across targets, restart and day boundaries without claiming an observed physical start. The final permit SHALL exclude its matching reservation's own bound when checking other claims. Choice and clock inputs SHALL be controllable in tests. Quiet hours, insufficient waking time and missed windows SHALL reduce delivered opportunities rather than compress spacing or create catch-up work. Restart, re-enabling, forward clock jumps and repeated local hours SHALL schedule only future unclaimed opportunities. Crossing midnight SHALL NOT reset spacing or allow a repeated claim. Policy edits and disable/re-enable SHALL retain already claimed counts for that waking day; a clock rollback SHALL NOT reopen an older admitted interval.

#### Scenario: An ordinary waking day
- **WHEN** a fixed clock and choice input exercise a waking interval that can fit the selected count
- **THEN** planned opportunities include early, middle and late parts of that interval, are not less than 45 minutes apart, and use only waking times outside quiet hours

#### Scenario: Short intervals and local-clock changes
- **WHEN** the interval cannot fit the count, daylight-saving time skips or repeats an hour, or a restart occurs after several opportunities
- **THEN** the runtime explains skipped opportunities and plans only eligible future ones, with no repeated slot or compressed spacing

#### Scenario: A late start cannot shorten the next gap
- **WHEN** A permits a start at 09:00 with 60 seconds of tolerance and B would otherwise start at 09:45
- **THEN** B's earliest permitted start is at least 09:46, preserving 45 minutes after A's latest permitted start
- **AND** restart retains this bound, A's own reserved targets do not block one another, and no physical-start observation is inferred

#### Scenario: Policy edits cannot refill the day
- **WHEN** some opportunities are already claimed and the owner changes waking hours/count or disables and re-enables the policy
- **THEN** only eligible future opportunities are replanned within the remaining allowance, and the original claims and cross-midnight spacing remain effective
- **AND** setting the clock back into an older admitted interval authorizes no replacement appearance

### Requirement: Durable claims precede art effects
The runtime SHALL durably identify each art opportunity, generation request and per-target attempt before sending it. One appearance SHALL count once across its surfaces, and uncertain or lost answers SHALL remain counted. A committed budget reservation SHALL bind its opportunity, immutable plan, policy revision, budget window and selected target attempts. Shared admission for ordinary flourishes and scheduled art SHALL include pending reservations, and only the matching reserved attempt may use one. Scheduled art SHALL honor shared global/device limits even when event priority permits status coverage; decorative appearances SHALL also honor noFlourishes. Per-agent/task limits SHALL retain their existing meaning without a fabricated scheduled-art identity. Final checks SHALL NOT charge the same appearance again or reject it solely because its own reservation filled the count or spacing allowance. Other claims and current restrictions SHALL still apply. The daily count, 45-minute spacing, existing moment budgets and provider dollar limits SHALL be independent protections. Concurrent triggers, duplicate occurrences, crashes and late outcomes SHALL NOT resend an automatic generation request or a presentation attempt. Storage failure before a claim SHALL cause no effect.

#### Scenario: A crash follows a durable claim
- **WHEN** the runtime claims an appearance and crashes before learning whether its first target accepted it
- **THEN** restart retains the reservation, sends no replacement and keeps the unresolved result distinct from success

#### Scenario: Concurrent triggers share a budget
- **WHEN** an hourly tick, a new weather observation and a scheduled appearance arrive together
- **THEN** bounded arbitration coalesces related work, reserves at most the allowed appearance and does not multiply the paid request or target attempt

#### Scenario: A reserved appearance uses the last budget unit
- **WHEN** an appearance reserves the last allowed unit and its preparations finish while other policy conditions remain valid
- **THEN** its matching per-target attempts pass the final budget check once without a second charge or rejection caused by their own count or spacing markers
- **AND** concurrent unrelated automation or art cannot use that reservation, exceed the shared limit or resend an already handed attempt

#### Scenario: Current restrictions revoke a reserved attempt
- **WHEN** the policy is disabled or its revision changes while a reserved target is preparing, even though its budget unit remains counted
- **THEN** that target's final permit refuses the unsent handoff, the reservation remains counted, and no replacement attempt borrows it

#### Scenario: Changed timing cannot reuse a plan identity
- **WHEN** late preparation completes and a caller tries to move the start or cutoff under the same admitted plan ID, including after restart
- **THEN** the shared presentation path reports duplicate-conflict before any new phase, and the scheduler neither resends that opportunity nor treats its receipt as permission for another one

### Requirement: Current art policy gates each surface independently
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
- **WHEN** a device has attention, an owner pin, an explicit pause or a Now Playing takeover, or the owner is browsing a saved Gallery choice
- **THEN** art cannot displace the protected presentation and no mode command is sent to make it eligible
- **AND** an admitted device moment yields and returns through that device's current-base behavior

#### Scenario: Empty Media remains eligible without changing its mode
- **WHEN** configured Pixoo Media is empty, stopped or finished and its owner declares the exact-art request eligible
- **THEN** an otherwise permitted appearance may be requested without a mode write
- **AND** explicit pause, uncertain writer state, attention, owner pin, stale playback generation or Now Playing takeover still blocks replacement

### Requirement: Ambient reuse and generation have separate authority
Ambient updates SHALL be noninterrupting, at most hourly from the timer and additionally on eligible live weather changes. The runtime SHALL keep a bounded coalesced opportunity rather than an event backlog. Automatic generation SHALL NOT itself grant presentation permission. Generation-disabled, unavailable-provider, exhausted-budget or late-job conditions SHALL permit one bounded saved-art fallback, with no model call for reuse and no new presentation when no usable saved art exists. An ambient authorization SHALL be limited to its exact live opportunity, target, composition and one initial selection attempt, and SHALL be revoked on stop, expiry or policy change. That revocation SHALL NOT clear or revoke Art's existing maintenance of an already-issued accepted or uncertain intent; maintenance SHALL retain its exact composition and configured target without replaying the grant or treating a pending or refused replacement as issued.

#### Scenario: Generation finishes after the window
- **WHEN** a job is admitted but finishes after its scheduled appearance has selected a saved fallback or expired
- **THEN** its new catalog entry causes no late appearance or ambient selection for that opportunity

#### Scenario: Old weather occurrences return after restart
- **WHEN** a synced snapshot or replayed weather occurrence describes a previously observed change
- **THEN** it causes no catch-up ambient update, while fresh state can inform a later future opportunity

### Requirement: Fresh forecast evidence remains separate from decorative art
The runtime SHALL derive a factual rain notice only from an enabled, qualified, fresh weather record covering the selected future forecast hour within the next two hours. A notice SHALL distinguish likely rain from a chance and carry its forecast interval, provider forecast-update time, observation/stale times and source revision, using bounded typed values. The notice SHALL remain valid through the latest permitted start and each target's intended hold, with time checks at admission and before a delayed first write. The source's current-hour forecast SHALL NOT be described as an observed measurement. Each required factual presentation SHALL carry its deterministic label; unsupported targets SHALL skip. Missing, disabled, stale, unrelated or superseded evidence SHALL authorize no factual notice. Generated artwork SHALL remain decorative with factual provenance false.

#### Scenario: Fresh approaching rain
- **WHEN** an enabled weather owner publishes a fresh forecast with a chance of rain in the next two hours and an eligible appearance is selected
- **THEN** the notice names that forecast interval and chance, each admitted target receives the same source meaning, and generated image prompts contain no notice payload or private source facts

#### Scenario: Source is disabled or becomes stale
- **WHEN** schedule weather use is disabled, or its record becomes stale while a factual opportunity waits
- **THEN** disabled scheduling opens no source subscription or read, stale evidence is not dispatched as fact, and no invented rain or meeting substitutes for it

#### Scenario: Meeting presentation is deferred
- **WHEN** this release starts or an agent turn ends
- **THEN** no calendar reader, subscription or meeting control is composed and no meeting, milestone or successful-task claim is inferred

#### Scenario: A notice would expire during its hold
- **WHEN** staging or the device queue delays a factual appearance until its evidence cannot cover the latest start and full target duration
- **THEN** that target refuses the notice without silently dropping its factual label or showing expired facts
- **AND** another target with sufficient remaining validity keeps its independent result

### Requirement: Art results report the evidence actually held
The core SHALL publish a bounded art-schedule record through existing transaction/outbox and SDK sync/live paths, carrying policy, upcoming opportunity, suppression reason, current notice and separate generation, preparation, browser-selection and display operation references. The existing Automation workspace SHALL consume that record without polling or creating another catalog owner. A tracked dispatch SHALL NOT be presented as completion. A browser selection completion SHALL NOT establish decoding or visibility, and transport evidence SHALL NOT establish a physical observation. Failed, expired, uncertain, conflicting and unsupported results SHALL remain distinguishable without automatic resend.

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
