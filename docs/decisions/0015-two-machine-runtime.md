# ADR 0015: Run B.U.N.N.Y. on the Mac and the PC with a Mac-preferred lead

Status: Proposed for
[Hub #1723](https://github.com/jimmie-potts/agent-device-hub/issues/1723),
awaiting the owner's acceptance. It would amend
[ADR 0008](0008-runtime-hosting.md) and parts of
[ADR 0012](0012-bunny-event-platform.md). Until the owner accepts it, nothing in
ADR 0008, ADR 0012, `docs/architecture.md`, `docs/bunny-container.md` or
`AGENTS.md` changes, and the rules there stay in force: one designated writer
per device and no automatic failover. The owner may accept it whole or one
stage at a time ([Stages](#stages)). It installs nothing, authorizes no new
host and sends no device command. Items marked *proposed* are the author's, and
the owner can change them.

## Context

The owner wants either machine to run B.U.N.N.Y. with full function. If one
goes down, the other continues with the same sessions, inbox, preferences and
device behavior (#1723, 2026-11-11 15:22:19Z).

The accepted rules say otherwise. ADR 0008 makes the Mac the primary,
self-sufficient host and the PC "an optional activity producer, client and host
for explicitly PC-attached hardware". `docs/architecture.md` "Hosting and
access" states that "Local leases do not fence other computers. There is no
automatic failover or snapshot rollback." ADR 0012 and `AGENTS.md` keep one
designated writer per physical device. The only supported move of state is a
stopped backup restored into an empty instance.

Two read-only studies on #1723 set out the facts: the
[store audit](https://github.com/jimmie-potts/agent-device-hub/issues/1723#issuecomment-6801028960)
and the
[PC host qualification plan](https://github.com/jimmie-potts/agent-device-hub/issues/1723#issuecomment-6800998613).
In short:

- **There is no replayable event log.** ADR 0012 says "This is not event
  sourcing", rules out replay and never stores commands. Each owner keeps its
  own SQLite state. The core's history is append-only but stores state changes
  as diffs, omits hook observations and acknowledgments, and orders rows with a
  counter local to one installation (audit, answer 1).
- **Identity is not scoped to a machine.** Both cores would publish as
  `bunny/core`, and each module as `bunny/modules/<name>`, with independent
  revision counters. Consumers would drop the other machine's records as stale
  (audit, answers 1 and 3).
- **Many stores need one writer.** Automation budgets, routine watermarks, the
  art ledger and daily claims, the tracker's "one request ID, one action" rule,
  companion allowances and the coding-worker selection are counters, budgets,
  claims and watermarks. Two machines updating them independently would double
  the actions and the spending (audit, answer 3).
- **Every writer fence is local.** The core lease, exclusive SQLite locking and
  the module device leases are all local files. A copy is possible only inside
  the process, never at the file level (audit, answer 3).
- **Some inputs attach to one runtime.** The Mac Music producers, the coding
  worker and the CHOMPI bridge connect to one runtime by design. Agent hooks
  send to one endpoint, with no retry and no spool (audit, answer 2).
- **Devices take a second writer differently.** Nanoleaf and Pixoo yield to
  outside control. Two copies would yield to each other or alternate, so the
  likely result is stand-off and flicker, not a loop (inferred). The Pixoo also
  paces its commands. Tidbyt and LIFX would fight: the last write wins without
  either copy noticing, and one copy's Tidbyt release can clear the other's
  pin. Wemo, Reachy Mini and MicroDuck hold holds and requests that two writers
  would contend over (inferred for Reachy Mini and MicroDuck). Roborock and
  Volcano each have one data source that may not accept a second client
  (audit, answer 4).
- **The release is ARM64 only.** Release qualification builds and verifies only
  ARM64, and the operator refuses other architectures. The PC would need an
  AMD64 image (plan, B4).
- **A worker on the PC cannot reach the Mac core today.** The private entry
  refuses any credential with a role, and the core accepts one worker endpoint
  (plan, "The network path"). This matters to #1722, which shares the PC worker.
- **Container reach from the PC is unproven.** Whether Docker Desktop on WSL 2
  reaches the devices has not been measured. The probe in the plan's section 6
  waits for the owner's confirmation.

## Owner decisions

These are the owner's own decisions, recorded on #1723 from chat on 2026-11-11.
They are stated here as decisions. They take effect only as part of this record
once it is accepted.

1. **Shared state is held locally on both machines with eventual consistency,
   not in a cloud service.** At 15:45:13Z the owner asked whether "a cloud
   session [should] hold the state of Bunny that both local machines would
   reference, or ... both of them share a state locally? Using eventual
   consistency?" At 15:59:02Z the owner answered: "For the orchestration and
   the eventual consistency, I think a Mac preferred rule with no cloud is a
   good first solution."
2. **The lead is chosen by a Mac-preferred rule with no cloud tie-breaker, as a
   first solution** (same statement, 15:59:02Z). The Mac leads whenever it is
   up. The PC takes the lead only when it cannot reach the Mac but can still
   reach the home router. The weakness is accepted: if only the link between
   the two machines fails, both may lead for a while.
3. **A physical device may have more than one writer in this design.** At
   15:33:54Z the owner asked the question on that assumption: "Assuming the
   current rules don't apply and that each physical device could have multiple
   writers, how does that impact this decision?" #1723 records the outcome as
   "multiple writers considered acceptable for this design".

## Proposal

Everything in this section is *proposed* and open to the owner's change.

### Two classes of behavior

- **Either copy may write** to a device only after that device has been shown
  to tolerate a second writer. On today's evidence Nanoleaf and Pixoo are the
  candidates. The Pixoo's command pacing still needs measuring with two
  senders. LIFX, Tidbyt, Wemo, Roborock, Reachy Mini, MicroDuck and every
  device not named here stay with the lead until each is changed or qualified.
- **Lead only:** actions that are not safe to repeat (the Wemo switch, the
  vacuum, notifications, playback controls, starting agents), schedules and
  routines, spending and delivery job claims. A machine that becomes the lead
  waits the takeover interval before acting. *Proposed* length: at least the
  longest tracked-command deadline plus two failed reachability checks of the
  Mac. Stage 3 fixes the number.

### Replicate records, not commands or a log

ADR 0012's rules stay as they are: commands are live-only, and there is no
replay. Replication copies stored records between the two copies.

- Each replicated record gains an **origin**: a configured machine label such
  as `mac` or `pc`, never a host name. Its source and identity are then
  qualified by machine, so revisions from the two machines never collide.
- **Settings** (mode, layouts, rules and routine definitions, the art schedule
  policy, power limit definitions, device preferences, scenes and playlists)
  merge last-writer-wins. The comparison uses a timestamp that is comparable
  across machines: a hybrid logical clock, or wall time with the origin as a
  tie-break.
- **Append-only records** (history, art feedback, the Volcano and Roborock
  archives, assistant conversations) merge as a union keyed by origin.
- **Acknowledgements and inbox handling** merge monotonically: once handled,
  always handled.
- **Immutable media** (Pixoo originals and renditions, generated art) are copied
  and never rewritten. Art bytes live in SQLite today, so deletion and pruning
  must stay in step with the catalog.
- **Counters, budgets, claims and watermarks are never merged.** They stay with
  the lead or stay per machine.
- **Sessions are not replicated.** Each machine reduces them from the same hook
  observations once producers report to both machines or are forwarded. The
  agent-state block stays local to each core.

### Spending, delivery claims and secrets

- **Spending is split.** Each machine has its own share of each ceiling (art,
  companions, assistant). Together the shares never exceed the owner's ceiling,
  even when both lead.
- **A delivery job is claimed on GitHub** (the issue's assignment), not in
  either copy. This keeps #1722's orchestrator safe from a split lead.
- **Credentials and secrets are placed on the second machine only by the owner,
  one by one.** Nothing replicates a secret. Each producer that reports to both
  machines needs its own grant on each.

## Stages

Each stage is smallest first. It lists what a takeover would have and lack at
that stage, which accepted rule it needs amended, and the audit's effort mark.
The owner can accept stages one at a time. Each amendment is quoted under
[Amendments on acceptance](#amendments-on-acceptance).

### Stage 0: prerequisites

The PC is qualified as a host: device reach from Docker in WSL 2 (the plan's
probe), an AMD64 image, a git identity in the PC checkout, and staying awake
(plan, Checklist B and items A14 and A15). Record identity gains the origin.

- **Takeover:** none.
- **Amends:** no accepted rule. It needs the owner's authorization of the PC as
  a host, since `AGENTS.md` withholds new hosts from standing authority. It also
  needs an ADR 0012 contract change for the origin and, for AMD64, a release
  qualification and gate-policy change.
- **Effort:** not sized by the audit. The origin is the main unknown of the
  append-only class (high).

### Stage 1: one-way settings and a standby started by hand

Owner-entered settings replicate one way, from the Mac to the PC, as
last-writer-wins records (audit, answer 5). The PC has its own spending share.
When the Mac is down, the owner starts the PC copy by hand after confirming the
Mac core is stopped, and stops it again before the Mac core starts. There is
still one writer at a time and no automatic takeover.

- **Takeover has:** settings, preferences, layouts, rules, scenes and playlists,
  and device control from the PC.
- **Takeover lacks:** history and inbox handling since the last sync, sessions
  until hooks report to the PC, the art catalog and ledger, the Pixoo media
  library, remembered Nanoleaf scenes, gaps in the Volcano and Roborock
  archives, and every Mac-only input. Settings changed on the PC while it leads
  are not carried back.
- **Amends:** ADR 0008's PC role and "The Mac owns persistent state",
  `docs/architecture.md`'s PC role and "One runtime owns", and ADR 0012's
  personal data host.
- **Effort:** medium (settings), plus low (configuration templating for the PC).

### Stage 2: append-only and monotonic records in both directions

History, inbox handling, acknowledgements, art feedback, assistant
conversations and the Volcano and Roborock archives merge in both directions.
Art images and Pixoo media copy as files. Fire-and-forget producers (hooks, the
Codex Desktop collector, the Volcano collector, read receipts) report to both
machines, or one machine forwards with an outbox. Connection-bound producers
stay with the lead.

- **Takeover has:** Stage 1, plus history, handled inbox items, archives and
  media up to the last exchange, and current sessions.
- **Takeover lacks:** automatic takeover, Mac-only inputs, and connection-bound
  producers until they reconnect.
- **Amends:** ADR 0012's "Copies of other owners' state are rebuilt by sync,
  not stored". The no-replay and live-only command rules stay.
- **Effort:** high (append-only and monotonic), low to medium (files).

### Stage 3: the Mac-preferred lead and automatic takeover

The lead rule, the takeover interval and lead-only fencing start here. Both
copies run, but only the lead writes to devices and runs lead-only work.

- **Takeover has:** Stage 2, automatic.
- **Takeover lacks:** either-copy device writes, so the PC writes nothing while
  the Mac leads, and Mac-only inputs.
- **Amends:** ADR 0008's "automatic failover ... not required" and "never run
  both device writers", `docs/architecture.md`'s "no automatic failover",
  `AGENTS.md`'s one-designated-writer sentence for the split-lead case, and
  `docs/bunny-container.md`'s handoff paragraph.
- **Effort:** high (lead-only work).

### Stage 4: either-copy writes for qualified devices

Each device qualified for it accepts writes from both copies.

- **Takeover has:** everything except the Mac-only inputs and connection-bound
  producers.
- **Amends:** "one writer controls each device" in ADR 0012 and
  `docs/architecture.md`, and `AGENTS.md`'s one-designated-writer sentence.
- **Effort:** not sized by the audit. One physical qualification per device.

## Amendments on acceptance

None of these is made now. Acceptance needs a follow-up commit that applies
those for the accepted stages, with each first mention of ADR 0015 linked.
Stage numbers are in brackets.

### ADR 0008, "Current decision"

1. [1] "The PC is an optional activity producer, client and host for explicitly
   PC-attached hardware. It is not a relay or startup dependency for the Mac's
   normal operation."
   Replace with: "The PC is an optional activity producer, client and host for
   explicitly PC-attached hardware, and a second B.U.N.N.Y. host at the stages
   of ADR 0015 the owner has accepted. It is not
   a relay or startup dependency for the Mac's normal operation."
2. [1] "The Mac owns persistent state and the serving endpoint."
   Replace with: "The Mac owns persistent state and the serving endpoint while
   it leads. The PC keeps the records ADR 0015 replicates and serves while it
   leads."
3. [3] "Unattended pre-login startup, automatic failover and a new recovery
   framework are not required."
   Replace with: "Unattended pre-login startup and a new recovery framework are
   not required. Automatic takeover follows ADR 0015's Mac-preferred lead rule."
4. [3] "Manual return must stop the Mac writer first, set its start hold so that
   sign-in cannot restart it, and explicitly select the preserved source and
   data gap; never run both device writers."
   Replace with: "Outside ADR 0015, manual return must stop the Mac writer
   first, set its start hold so that sign-in cannot restart it, and explicitly
   select the preserved source and data gap. Under ADR 0015 only the lead
   writes to a device not qualified for either-copy writes. A split lead is the
   accepted exception, bounded by the takeover interval."

### ADR 0012

5. [1] "Personal data": "It is stored only in private owner-controlled storage on
   the runtime host."
   Replace with: "It is stored only in private owner-controlled storage on the
   runtime hosts the owner has selected."
6. [2] "Ownership and publication": "Copies of other owners' state are rebuilt
   by sync, not stored."
   Replace with: "Copies of other owners' state are rebuilt by sync, not stored.
   Records replicated from the other host under ADR 0015 are stored with their
   origin and are not sync copies."
7. [4] "Ownership and publication": "One owner publishes each fact, and one
   writer controls each device."
   Replace with: "One owner publishes each fact; a replicated record keeps its
   origin machine as owner. One writer controls each device, except devices
   ADR 0015 qualifies for either-copy writes."

### `docs/architecture.md`

8. [1] "Hosting and access": "One runtime owns its core, fixed modules, private
   stores and serving endpoint."
   Replace with: "Each running host's runtime owns its core, fixed modules,
   private stores and serving endpoint. ADR 0015 sets which records replicate between hosts and which host leads."
9. [1] "Hosting and access": "The PC is an optional producer/client and host for
   explicitly PC-attached hardware; normal hub startup, storage, dashboard
   access and selected portable device integrations must work with it off."
   Replace with: "The PC is an optional producer/client, host for explicitly
   PC-attached hardware and, under ADR 0015, a second host that may lead when
   the Mac is unreachable. Normal hub startup, storage, dashboard access and
   selected portable device integrations must work on the Mac with the PC off."
10. [3] "Hosting and access": "Local leases do not fence other computers. There
    is no automatic failover or snapshot rollback."
    Replace with: "Local leases do not fence other computers. ADR 0015's lead
    rule and takeover interval are the cross-machine fence, and they are not
    exact. There is no snapshot rollback."
11. [4] "Event and messaging platform": "One owner holds each fact, and one
    writer controls each device."
    Replace with: "One owner holds each fact, and one writer controls each
    device, except devices ADR 0015 qualifies for either-copy writes."

### `AGENTS.md`, "Runtime and migration boundaries"

12. [3, 4] "Maintain one active agent-state owner and one designated writer per
    physical device."
    Replace with: "Maintain one active agent-state owner per running host and
    one designated writer per physical device: the lead under ADR 0015. Only
    devices ADR 0015 qualifies for either-copy writes take both copies."
13. [1] "Keep controller databases private, especially across Windows and WSL.
    Use explicit API/ownership handoffs, not concurrent access to a mounted
    SQLite file."
    Keep, and add: "Replicate between hosts only through ADR 0015's record
    replication, never by copying or mounting a live SQLite file."

The sentence that standing installation authority "does not authorize new hosts"
stays. The owner authorizes the PC separately.

### `docs/bunny-container.md`

14. [3] "Start, stop and inspect": "Before enabling device control on another
    host, manually stop and verify the old host's device writer, including any
    restart actor. The local state lease prevents two cooperating processes
    from opening the same volume; it cannot prevent two hosts with separate
    volumes from controlling one device. Do not use a copied volume or a
    control flag as proof of a device handoff."
    Replace with: "Outside ADR 0015, before enabling device control on another
    host, manually stop and verify the old host's device writer, including any
    restart actor. Under ADR 0015 the lead rule decides which host writes to a
    lead-only device. The local state lease prevents two cooperating processes
    from opening the same volume; it cannot prevent two hosts with separate
    volumes from controlling one device. Do not use a copied volume, a
    replicated record or a control flag as proof of a device handoff."
15. [3] "Production device profile": "A local state lease cannot exclude another
    computer's writer."
    Keep, and add: "A second host under ADR 0015 follows its lead rule."

The cutover paragraph under "Manual operation after Mac sign-in" and the start
hold's "returning the device writer to another computer" describe the WSL
return path and stay as they are.

## Consequences and risks

- **Split lead.** If only the link between the machines fails, both lead. The
  takeover interval delays the PC's lead-only work. Per-machine spending shares
  cap the total spend. GitHub claims keep delivery jobs single. Nothing
  protects routines, Wemo switching or playback controls from running on both
  machines once the interval passes. Lead-only devices may receive two writers,
  and each copy's tracker resolves its own deadlines without seeing the other's.
- **Inputs on one machine only.** On the Mac: the Volcano Bluetooth collector,
  the Mac Music producer, Codex Desktop reads, the Tronbyt server and browser
  speech. On Windows: the CHOMPI bridge and the Wispr collector. A PC lead runs
  without the Mac's inputs. If the Tidbyt uses the Tronbyt backend, a PC lead
  also loses its display server, which lives on the Mac. Moving or duplicating
  these inputs is a separate owner decision.
- **Clock agreement.** Last-writer-wins needs comparable clocks. WSL 2 clocks
  can drift after the host sleeps (inferred). Clock skew is a qualification
  check on the PC (plan, B9), and a hybrid logical clock bounds its effect.
- **Doubled polling.** Two copies poll the Wemo plugs, speakers, weather and
  Roborock, and call vendor accounts twice. Roborock and the Volcano link may
  not tolerate a second client. Under this proposal their collection stays
  with the lead.
- **Exposure.** Every secret copied to the PC doubles its exposure (inferred).
  Personal data also lives on a second machine. ADR 0011 allows that in
  owner-controlled storage.
- **Work per stage**, from the audit's effort marks: settings medium,
  append-only and monotonic high, files low to medium, lead-only high, local
  configuration low. Stage 0's AMD64 lane and stage 4's per-device qualification
  are not sized.

## Alternatives considered

- **A cloud database holding the state.** The owner chose local state with no
  cloud (decision 1). It would add an internet dependency to every device
  reaction, which ADR 0012 already rejected for device paths.
- **A small cloud tie-breaker for the lead.** It would settle the split-lead
  case, but the owner chose no cloud for the first solution. It is the natural
  next step if the split lead proves costly.
- **Full event sourcing with a replicated log.** ADR 0012 rejected a durable log
  in the Hub and deferred event sourcing. Commands are never stored, and
  history omits observations and stores diffs. A log would mean building
  consumer positions, redelivery and retention, and reversing the no-replay
  rule across every consumer.
- **A cold standby from periodic snapshots.** It needs no merge rules, and loss
  is the time since the last snapshot. Three blockers stand today (audit,
  answer 5). Exclusive locking means the snapshot must come from inside the
  runtime, and no such code exists. Restore refuses a different source revision
  and is qualified only on Mac ARM64. A copied volume is not a device handoff.
- **Keep ADR 0008 unchanged.** The Mac stays the only host, and an outage lasts
  until the Mac returns. This is the cheapest option and remains the default
  until the owner accepts this record.

## Open decisions for the owner

1. Accept this record whole, stage by stage, or not at all.
2. Authorize the PC as a B.U.N.N.Y. host, separately from the worker host of
   #1722, and approve the plan's device-reach probe.
3. AMD64: add a release qualification lane (a CI and gate-policy change), or
   leave the PC unqualified until needed.
4. The takeover interval's length, and how the PC checks that it can reach the
   Mac and the home router.
5. Which devices to qualify for either-copy writes, starting with Nanoleaf and
   Pixoo.
6. Each ceiling's split between the machines.
7. Which secrets to place on the PC.
8. Whether to move or duplicate the Mac-only inputs, the Tronbyt server first.
9. The clock for last-writer-wins: a hybrid logical clock, or wall time with an
   origin tie-break.
