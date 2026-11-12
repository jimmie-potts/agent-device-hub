# ADR 0015: Run B.U.N.N.Y. on the Mac and the PC with a Mac-preferred lead

Status: Stage 0 accepted on 2026-11-12; stages 1 to 4 proposed, for
[Hub #1723](https://github.com/jimmie-potts/agent-device-hub/issues/1723).
The owner accepts it one stage at a time ([Acceptance](#acceptance)). Stage 0
changes no rule in an accepted document. Each later stage would amend the
sentences listed under it in [Amendments by stage](#amendments-by-stage). Until
that stage is accepted, nothing it lists changes in [ADR 0008](0008-runtime-hosting.md),
[ADR 0012](0012-bunny-event-platform.md), `docs/architecture.md`,
`docs/bunny-container.md` or `AGENTS.md`, and the rules there stay in force: one
designated writer per device and no automatic failover. This record installs
nothing, authorizes no new host and sends no device command. Items marked
*proposed* are the author's, and the owner can change them.

## Acceptance

The owner decided how this record is accepted, in chat to the coordinating
session at 2026-11-11T17:56:35Z: "We can do stage by stage."
([recorded on #1725](https://github.com/jimmie-potts/agent-device-hub/pull/1725#issuecomment-6803327523)).

| Stage | Adds | Status |
| --- | --- | --- |
| [0](#stage-0-prerequisites) | The PC checked as a host; the fact log on the Mac (in source; not installed when stage 0 was accepted, see [#1750](https://github.com/jimmie-potts/agent-device-hub/issues/1750)) | accepted 2026-11-12: "your recommendation is good for all 7" (owner decision 6) |
| [1](#stage-1-one-way-settings-to-a-pc-copy-that-runs-with-device-control-off) | Settings read one way from the Mac by a PC copy that runs with device control off; takeover by hand | not accepted |
| [2](#stage-2-facts-in-both-directions) | Facts merged in both directions; media copied | not accepted |
| [3](#stage-3-the-mac-preferred-lead-and-automatic-takeover) | The Mac-preferred lead and automatic takeover | not accepted |
| [4](#stage-4-either-copy-writes-for-qualified-devices) | Either-copy writes for qualified devices | not accepted |

Accepting a stage adopts its section and needs a follow-up commit that applies
its amendments; stage 0 has none. A stage's "Before it starts" list names the
earlier stages it needs. Accepting one stage does not accept a later one. The
owner was to decide stage 1 after the device reach probe's result. That result
came in on 2026-11-12, and stage 1 is open.

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

- **No replayable log existed when the audit ran.** ADR 0012 rules out replay
  and never stores commands, and each owner keeps its own SQLite state. The
  core's history was append-only but carried no machine and ordered rows with a
  counter local to one installation (audit, answer 1). Since then,
  [#1729](https://github.com/jimmie-potts/agent-device-hub/issues/1729) decided
  that history becomes a fact log (below).
- **Identity is not scoped to a machine.** Both cores would publish as
  `bunny/core`, and each module as `bunny/modules/<name>`, with independent
  revision counters. The fact log adds the origin to history rows only. The
  live intake still cannot tell machines apart: a peer's state for the same
  entity at a lower revision is dropped as stale (audit, answers 1 and 3;
  [prototype](https://github.com/jimmie-potts/agent-device-hub/issues/1729#issuecomment-6803058506),
  A5).
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
  The owner has since authorized the PC as a worker host, and #1722's
  orchestrator runs alongside today's way of working (owner decision 6).
- **Container reach from the PC was unproven until 2026-11-12.** The probe in
  the plan's section 6 had not run when stage 0 was accepted. It ran later that
  night and passed ([Stage 0](#stage-0-prerequisites)).

## Owner decisions

These are the owner's own decisions, recorded on #1722, #1723, #1729 and #1725
from chat on 2026-11-11 and 2026-11-12. Decisions 1 to 5 take effect here only
with the stage that uses them.

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
4. **Events and stores** were decided on #1729 at 17:29:53Z and 17:38:20Z
   ([decisions](https://github.com/jimmie-potts/agent-device-hub/issues/1729#issuecomment-6802744525),
   [confirmation](https://github.com/jimmie-potts/agent-device-hub/issues/1729#issuecomment-6802945487),
   from the
   [options paper](https://github.com/jimmie-potts/agent-device-hub/issues/1729#issuecomment-6802532343)).
   ADR 0012's [2026-11-11 amendment](0012-bunny-event-platform.md#amendment-2026-11-11)
   records them ([PR #1742](https://github.com/jimmie-potts/agent-device-hub/pull/1742),
   merged). Event sourcing is not adopted, and no store moves off SQLite.
   History is a fact log: every row carries the installation it came from (its
   origin) and a sequence per origin, and a reader asks for everything from an
   origin after N.
   [#1740](https://github.com/jimmie-potts/agent-device-hub/issues/1740)
   delivered it in source
   ([PR #1745](https://github.com/jimmie-potts/agent-device-hub/pull/1745)).
   No rule limits what a display or device on the owner's
   network may read and show, and "A past fact never triggers a command by
   itself" (17:38:20Z).
5. **Settings replicate as records through the fact log, not through the
   database's built-in change capture.** At 17:56:35Z the owner answered "Your
   recommendation." to that question, recorded on
   [#1729](https://github.com/jimmie-potts/agent-device-hub/issues/1729#issuecomment-6803326773). The
   [prototype](https://github.com/jimmie-potts/agent-device-hub/issues/1729#issuecomment-6803058506)
   showed that the built-in change capture works with the runtime's database
   settings but cannot apply "latest edit wins" by itself. Its conflict handler
   sees only the conflict type, never the rows.
6. **Stage 0 is accepted, with the PC's first steps.** At 2026-11-12T00:36:12Z
   the owner answered seven numbered decisions, each put with a
   recommendation: "For the decisions waiting on me, for all 1, 2, 3, 4, 5, 6
   of those, 7 of those, your recommendation is good for all 7." The
   recommendations accepted, as recorded on
   [#1723](https://github.com/jimmie-potts/agent-device-hub/issues/1723#issuecomment-6810823533)
   and [#1722](https://github.com/jimmie-potts/agent-device-hub/issues/1722#issuecomment-6810823271):
   - "Stage 0 is accepted. Stages 1 to 4 are not accepted." Stage 1 is
     decided after the probe.
   - "the PC is authorized as a worker host (recorded on #1722) and is not yet
     authorized as a standby runtime host". The standby authorization waits
     for the probe result.
   - The device reach probe is approved as written in the plan, "including the
     one read-only request to a LIFX bulb, with the Roborock limited to a
     ping". It sends no command to any device. One point of the plan changed
     afterwards on the owner's instruction (decision 7).
   - For the PC's processor image, start with a local build on the PC
     "instead of a new release qualification lane, which would be a gate
     change".
   - The delivery orchestrator runs alongside today's way of working (#1722).
7. **Device addresses for the probe come from the Mac's configuration.** After
   approving the probe, the owner instructed the coordinating session: "Pull
   the device IP addresses from our configs and send the info to the 'Mac
   connection test' session and coordinate and orchestrate." (recorded on
   [#1723](https://github.com/jimmie-potts/agent-device-hub/issues/1723#issuecomment-6810927337)
   at 2026-11-12T00:43:06Z). So the coordinating session read the addresses
   from the Mac runtime's private configuration and passed them privately to
   the owner's session on the PC, instead of the owner typing them. They are
   never a guessed target and never written to GitHub. The rest of the plan
   stood, and its step 6 (other network modes) stayed unapproved.

## Rules every stage keeps

Everything in this section is *proposed* and open to the owner's change.
Stage 0 adopts none of them. Each rule takes effect only with an accepted stage
that uses it.

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

These rules govern commands to devices. Nothing here limits what a display or
device may read and show.

### Replicate through the fact log, not commands

Commands stay live-only and are never replicated. One installation reads the
other's facts from its fact log after N per origin and stores them.

- **The origin** is #1740's: an identifier created once per installation and
  kept in the core store, never a host name. Revisions stay per origin and are
  never compared across origins.
- **Settings** (mode, layouts, rules and routine definitions, the art schedule
  policy, power limit definitions, device preferences, scenes and playlists)
  are records in the fact log. The reader applies the latest edit, comparing a
  timestamp that is comparable across machines: a hybrid logical clock, or wall
  time with the origin as a tie-break. A delete travels as a record of its own
  (a tombstone).
- **Append-only facts** (history, and the archives once they are facts) merge
  as a union: read after N per origin and add.
- **Acknowledgements and inbox handling** merge monotonically: once handled,
  always handled.
- **Immutable media** (Pixoo originals and renditions, generated art) are copied
  and never rewritten. Art bytes live in SQLite today, so deletion and pruning
  must stay in step with the catalog.
- **Counters, budgets, claims and watermarks are never merged.** They stay with
  the lead or stay per machine.
- **Sessions are not replicated.** Each machine reduces them from the same hook
  observations once producers report to both machines. The agent-state block
  stays local to each core.
- **A merged fact never triggers a command by itself.** In the prototype the
  merge wrote only history rows, with no publication, no tracker change and no
  device call (A6).

### Spending, delivery claims and secrets

- **Spending is split.** Each machine has its own share of each ceiling (art,
  companions, assistant). Together the shares never exceed the owner's ceiling,
  even when both lead.
- **A delivery job is claimed on GitHub** (the issue's assignment), not in
  either copy. This keeps #1722's orchestrator safe from a split lead.
- **Credentials and secrets are placed on the second machine only by the owner,
  one by one.** Nothing replicates a secret. Each producer that reports to both
  machines needs its own grant on each, and so does the peer read.

## Stages

Each stage lists what it adds, what must be true before it starts, what a
takeover has and lacks, its amendments and its effort. Effort marks are the
audit's unless stated.

### Stage 0: prerequisites

Accepted on 2026-11-12 (owner decision 6).

- **Adds:** the PC checked as a host. That covers device reach from Docker in
  WSL 2 (the plan's probe), an image for the PC's processor, a git identity in
  the PC checkout, and staying awake (plan, Checklist B and items A14 and
  A15). The fact log of #1740 is merged in source. It was not installed on the
  Mac when stage 0 was accepted, and it reaches the Mac with a routine upgrade
  tracked on [#1750](https://github.com/jimmie-potts/agent-device-hub/issues/1750).
- **No runtime on the PC.** Stage 0's checks start no B.U.N.N.Y. runtime on the
  PC. They use throwaway containers only, with no persistent state and no
  device command. Checking the local build by starting a throwaway runtime from
  it needs its own owner decision.
- **Image:** a local build on the PC, not a new release qualification lane. A
  locally built image is not a qualified release, so it qualifies nothing
  beyond the probe and stage 0's checks. It is not a reviewed immutable image
  under ADR 0008, the operator's qualified routes refuse it, and it gives no
  standby or device-writer authority.
- **Before it starts:** met. The owner approved the plan's probe as written,
  except that the addresses came from the Mac's configuration (owner decisions
  6 and 7). The PC is authorized as a worker host only, so stage 0's checks run
  without the PC becoming a standby runtime host.
- **Probe result:** passed, on 2026-11-12 between 00:44Z and 00:49Z
  ([result](https://github.com/jimmie-potts/agent-device-hub/issues/1723#issuecomment-6811046647)).
  Steps 0 to 5 passed, as the result's own table records:
  - From WSL directly, every TCP row connected (Pixoo, both Nanoleaf devices,
    both Wemo plugs, Sonos, the Sony receiver and the Tronbyt server on the
    Mac). The LIFX bulb was checked by ping only.
  - From throwaway containers on the default bridge and on a project-style
    bridge, every TCP row was `open` and the Tronbyt health read returned 200.
    The weather, OpenAI and Anthropic hosts were reached by TLS handshake only.
  - One LIFX `LightGet` through the repository's unmodified transport got a
    reply. It replaced the plan's `GetService` or `GetPower` because the
    encoder accepts only the reads 14, 32 and 101.
  - One fetch from the Mac to a port published on the PC returned HTTP 200.

  It did not show Nanoleaf UDP frames, the Pixoo's own fetch, anything about
  the Roborock (which has no address in the configuration), sustained traffic,
  or sleep and idle behavior. No runtime was started on the PC and no device
  command was sent, so no module was exercised. The result authorizes nothing
  by itself.
- **Still to do:** the locally built image, staying awake, and the git identity
  in the PC checkout. With the probe result in, the owner's decisions on
  authorizing the PC as a standby runtime host and on stage 1 are open again.
- **Takeover:** none.
- **Amendments:** none. Accepting stage 0 changes no rule in an accepted
  document. The PC's roles under ADR 0008 and `docs/architecture.md` stay as
  they are, because a worker host is a client of the Mac core with no state or
  device authority. The deferral of further Windows/AMD64 installation
  qualification also stays true, because a local build installs and qualifies
  nothing. #1740 and ADR 0012's 2026-11-11 amendment carry the origin, so this
  record needs no contract change of its own.
- **Effort:** #1740 is delivered in source and the probe is done. The local
  build, staying awake and the git identity are not sized.

### Stage 1: one-way settings to a PC copy that runs with device control off

The owner was asked on 2026-11-12 about an earlier version of this stage, a
standby started by hand. Revision 4 changed it to the version below, and the
owner has not been asked about it (open decision 1).

- **Adds:** owner-entered settings become records in the Mac's fact log. The PC
  reads them after N and applies the latest edit (audit, answer 5; owner
  decision 5). The PC has its own spending share. There is one device writer at
  a time and no automatic takeover.
- **The PC copy's mode** (*proposed*; it does not exist today, see "Before it
  starts"):
  - The PC must read the Mac's settings while the Mac runs, so the PC copy runs
    alongside the Mac all the time, with device control off.
  - It reads the Mac's settings facts and applies them. No producer reports to
    it, so it holds no sessions.
  - It serves no client, sends no device command, runs no lead-only work
    (routines, schedules, spending, claims) and accepts no settings edits.
  - When the Mac is down, the owner confirms the Mac core is stopped with its
    start hold set, as `docs/bunny-container.md` already requires before device
    control moves to another host, and then turns device control on in the PC
    copy. Before the Mac core starts again, the owner turns it off.
- **Today's product** (read on `main` at `eebb5923`):
  - Device control is fixed when the container is created.
    `deploy/container/compose.production.yaml` sets
    `BUNNY_CONTROL: ${BUNNY_CONTROL:-disabled}` in the private Compose file the
    owner renders. `deploy/container/entrypoint.mjs` (`containerOptions`) reads
    it once at start, and `docs/bunny-container.md` "Production device profile"
    says to set `BUNNY_CONTROL=enabled` "when rendering". So turning control on
    or off means rendering the Compose file again and recreating the container
    (I: a running container's environment cannot change).
  - With control disabled, the entrypoint starts the core plus only configured
    modules that reach no device (`productionModules`, which falls back to
    `hostLocalModules` and `checkLocalBrowserConfig`). `docs/bunny-container.md`
    says the image "instantiates only the real session core". A copy in that
    mode cannot apply the settings that device modules keep, such as Nanoleaf
    preferences, Pixoo playlists and LIFX mode.
  - With control enabled, every configured module starts. The core's options
    (`CoreOptions` in `apps/runtime/src/core/core.ts`) have no switch that holds
    back routines, the art schedule, power limits or claims
    (`apps/runtime/src/core/automation.ts`, `art-schedule.ts`,
    `power-schedules.ts`). A search of `apps/runtime/src` found no standby or
    lead setting, and nothing refuses settings edits.
- **Before it starts:** stage 0 and the probe's result. The owner authorizes
  the PC as a standby runtime host, since `AGENTS.md` withholds new hosts from
  standing authority. The PC runs an image fit for a standby: the local build
  of stage 0 qualifies nothing. Settings that are not published families today
  become facts. Most module settings are not, and each needs a change record
  (audit, answer 6). A read route for "after N" with its own grant, reachable
  from the PC; the private entry refuses role credentials today (plan,
  "The network path"). Apply code on the PC for each settings family. New build
  and qualification work, because none of it exists today:
  - a standby mode in which the runtime applies settings facts, including
    device modules' settings, without device writes, lead-only work, spending
    or claims;
  - refusal of settings edits on the standby;
  - a qualified way to turn device control on and off for a takeover, and back,
    with the Mac's start hold in place.
- **Takeover has:** settings, preferences, layouts, rules, scenes and playlists,
  and device control from the PC.
- **Takeover lacks:** history and inbox handling, sessions until hooks report to
  the PC, the art catalog and ledger, the Pixoo media library, remembered
  Nanoleaf scenes, gaps in the Volcano and Roborock archives, and every
  Mac-only input. Settings changed on the PC while it leads are not carried
  back.
- **Amendments:** 1.1 to 1.7. Amendment 1.7 covers the second running core.
- **Effort:** medium for settings, plus low for configuration templating on the
  PC. The standby mode, the refusal of edits and the control switch are not
  sized.

### Stage 2: facts in both directions

- **Adds:** each installation reads the other's facts after N per origin and
  adds them, in both directions. The prototype showed this works. Order held
  within each origin, the origins did not collide, a repeated merge added
  nothing, and the merge published and commanded nothing (A1 to A4, A6).
  Acknowledgements, inbox handling, art feedback, assistant conversations and
  the Volcano and Roborock archives become facts so that they merge too. Art
  images and Pixoo media copy as files. Fire-and-forget producers (hooks, the
  Codex Desktop collector, the Volcano collector, read receipts) report to both
  machines. Connection-bound producers stay with whichever machine they connect
  to.
- **The PC copy's mode** (*proposed*): while the Mac runs, the PC copy keeps
  stage 1's standby mode with device control off. Unlike stage 1, it takes
  observations from the producers that report to it, reduces its own sessions
  and exchanges facts with the Mac in both directions. It still sends no device
  command, runs no lead-only work, serves no client except producer intake and
  the peer read, and accepts no settings edits. Settings still travel one way
  from the Mac until stage 3. The other direction runs all the time. The PC
  records the observations its producers send it, and the Mac merges those
  rows. So the Mac holds a second-origin copy of every fact delivered to both
  machines, as the prototype's A8 found: the union keeps the fact once per
  origin. The same direction also carries what the PC recorded while it led
  during a takeover by hand. Takeover stays by hand, as in stage 1.
- **Before it starts:** stage 1, including its standby mode and control switch,
  which this stage also needs. History's duplicate check looks only at the
  local origin's rows, which #1740 includes. Without it, a fact delivered to
  both machines makes the local tracker ignore its own copy (A8). Code that
  rebuilds state from merged history groups change rows by origin, since each
  is a diff against its own origin's previous record. The exchange stays
  pull-only: a live link between the runtimes would need the origin in the
  envelope and in the live staleness check (A5), which this record does not
  propose.
- **Takeover has:** stage 1, plus history, handled inbox items, archives and
  media up to the last exchange, and current sessions.
- **Takeover lacks:** automatic takeover, Mac-only inputs, and connection-bound
  producers until they reconnect.
- **Amendments:** 2.1.
- **Effort:** the history exchange is small once #1740 exists. The prototype's
  fact log took about 75 lines in `history.ts`. Turning the archives,
  acknowledgements and inbox handling into facts is not sized. Media copying is
  low to medium.

### Stage 3: the Mac-preferred lead and automatic takeover

- **Adds:** the lead rule, the takeover interval and lead-only fencing. Both
  copies run, but only the lead writes to devices and runs lead-only work.
- **Before it starts:** stage 2. Each installation knows which peer is the
  preferred lead. The origin is an opaque identifier, so this is its own
  setting (*proposed*). The takeover interval is fixed. From this stage either
  copy accepts settings edits, merged by latest edit.
- **Takeover has:** stage 2, automatic.
- **Takeover lacks:** either-copy device writes, so the PC writes nothing while
  the Mac leads, and Mac-only inputs.
- **Amendments:** 3.1 to 3.6.
- **Effort:** high (lead-only work).

### Stage 4: either-copy writes for qualified devices

- **Adds:** each device qualified for it accepts writes from both copies.
- **Before it starts:** stage 3, and one physical qualification per device with
  the owner's permission for that test.
- **Takeover has:** everything except the Mac-only inputs and connection-bound
  producers.
- **Amendments:** 4.1 to 4.5. Amendments 4.4 and 4.5 add the exception to
  stage 3's "only the lead writes" sentences.
- **Effort:** not sized by the audit.

## Amendments by stage

None of these is made now. Stage 0, the only accepted stage, has none.
Accepting a later stage needs a follow-up commit that applies that stage's
amendments, linking the first mention of ADR 0015 in each file. ADR 0012's
2026-11-11 amendment
([PR #1742](https://github.com/jimmie-potts/agent-device-hub/pull/1742),
merged) already changed ADR 0012's no-replay wording, its log and event
sourcing alternatives and `docs/architecture.md`'s "No replay" bullet. This
record does not propose those again. Each quoted sentence below was checked
against `main` on 2026-11-12.

### Stage 1

1.1. ADR 0008, "Current decision": "The PC is an optional activity producer,
client and host for explicitly PC-attached hardware. It is not a relay or
startup dependency for the Mac's normal operation."
Replace with: "The PC is an optional activity producer, client and host for
explicitly PC-attached hardware, and a second B.U.N.N.Y. host at the stages of
ADR 0015 the owner has accepted. It is not a relay or startup dependency for
the Mac's normal operation."

1.2. ADR 0008, "Runtime and access": "The Mac owns persistent state and the
serving endpoint."
Replace with: "The Mac owns persistent state and the serving endpoint while it
leads. The PC keeps the records ADR 0015 replicates and serves while it leads."

1.3. ADR 0012, "Personal data": "It is stored only in private owner-controlled
storage on the runtime host."
Replace with: "It is stored only in private owner-controlled storage on the
runtime hosts the owner has selected."

1.4. `docs/architecture.md`, "Hosting and access": "One runtime owns its core,
fixed modules, private stores and serving endpoint."
Replace with: "Each running host's runtime owns its core, fixed modules,
private stores and serving endpoint. ADR 0015 sets which records replicate
between hosts and which host leads."

1.5. `docs/architecture.md`, "Hosting and access": "The PC is an optional
producer/client and host for explicitly PC-attached hardware; normal hub
startup, storage, dashboard access and selected portable device integrations
must work with it off."
Replace with: "The PC is an optional producer/client, host for explicitly
PC-attached hardware and, under ADR 0015, a second host. Normal hub startup,
storage, dashboard access and selected portable device integrations must work
on the Mac with the PC off."

1.6. `AGENTS.md`, "Runtime and migration boundaries": keep "Keep controller
databases private, especially across Windows and WSL. Use explicit
API/ownership handoffs, not concurrent access to a mounted SQLite file." and
add: "Replicate between hosts only through ADR 0015's fact-log replication,
never by copying or mounting a live SQLite file."

1.7. `AGENTS.md`, "Runtime and migration boundaries": "Maintain one active
agent-state owner and one designated writer per physical device."
Replace with: "Maintain one active agent-state owner per running host and one
designated writer per physical device. Under ADR 0015 a second host's copy runs
with device control off until the owner turns it on for a takeover."

### Stage 2

2.1. ADR 0012, "Ownership and publication": "Copies of other owners' state are
rebuilt by sync, not stored."
Replace with: "Copies of other owners' state are rebuilt by sync, not stored.
Facts read from a peer installation's fact log under ADR 0015 are stored in
history with their origin; they are not sync copies."

### Stage 3

3.1. ADR 0008, "Manual operation and state handoff": "Unattended pre-login
startup, automatic failover and a new recovery framework are not required."
Replace with: "Unattended pre-login startup and a new recovery framework are not
required. Automatic takeover follows ADR 0015's Mac-preferred lead rule."

3.2. ADR 0008, "Manual operation and state handoff": "Manual return must stop
the Mac writer first, set its start hold so that sign-in cannot restart it, and
explicitly select the preserved source and data gap; never run both device
writers."
Replace with: "Outside ADR 0015, manual return must stop the Mac writer first,
set its start hold so that sign-in cannot restart it, and explicitly select the
preserved source and data gap. Under ADR 0015 only the lead writes to devices.
A split lead is the accepted exception, bounded by the takeover interval."

3.3. `docs/architecture.md`, "Hosting and access": "Local leases do not fence
other computers. There is no automatic failover or snapshot rollback."
Replace with: "Local leases do not fence other computers. ADR 0015's lead rule
and takeover interval are the cross-machine fence, and they are not exact.
There is no snapshot rollback."

3.4. `AGENTS.md`, the sentences as replaced by 1.7.
Replace with: "Maintain one active agent-state owner per running host and one
designated writer per physical device: the lead under ADR 0015, with its
split-lead case as the accepted exception."

3.5. `docs/bunny-container.md`, "Start, stop and inspect": "Before enabling
device control on another host, manually stop and verify the old host's device
writer, including any restart actor. The local state lease prevents two
cooperating processes from opening the same volume; it cannot prevent two hosts
with separate volumes from controlling one device. Do not use a copied volume
or a control flag as proof of a device handoff."
Replace with: "Outside ADR 0015, before enabling device control on another host,
manually stop and verify the old host's device writer, including any restart
actor. Under ADR 0015 the lead rule decides which host writes to a device. The
local state lease prevents two cooperating processes from opening the same
volume; it cannot prevent two hosts with separate volumes from controlling one
device. Do not use a copied volume, a replicated record or a control flag as
proof of a device handoff."

3.6. `docs/bunny-container.md`, "Production device profile": keep "A local state
lease cannot exclude another computer's writer." and add: "A second host under
ADR 0015 follows its lead rule."

The sentence that standing installation authority "does not authorize new hosts"
stays in `AGENTS.md`. The cutover paragraph under "Manual operation after Mac
sign-in" and the start hold's "returning the device writer to another computer"
describe the WSL return path and stay as they are.

### Stage 4

4.1. ADR 0012, "Ownership and publication": "One owner publishes each fact, and
one writer controls each device."
Replace with: "One owner publishes each fact; a fact read from a peer keeps its
origin. One writer controls each device, except devices ADR 0015 qualifies for
either-copy writes."

4.2. `docs/architecture.md`, "Event and messaging platform": "One owner holds
each fact, and one writer controls each device."
Replace with: "One owner holds each fact, and one writer controls each device,
except devices ADR 0015 qualifies for either-copy writes."

4.3. `AGENTS.md`, the sentence as replaced by 3.4: add "Devices ADR 0015
qualifies for either-copy writes take writes from both hosts."

4.4. ADR 0008, the sentence "Under ADR 0015 only the lead writes to devices."
as added by 3.2.
Replace with: "Under ADR 0015 only the lead writes to devices, except devices
ADR 0015 qualifies for either-copy writes."

4.5. `docs/bunny-container.md`, the sentence "Under ADR 0015 the lead rule
decides which host writes to a device." as added by 3.5.
Replace with: "Under ADR 0015 the lead rule decides which host writes to a
device, except devices ADR 0015 qualifies for either-copy writes, which take
writes from both."

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
- **Clock agreement.** Latest-edit-wins needs comparable clocks, and a merged
  row's time comes from the peer's clock. WSL 2 clocks can drift after the host
  sleeps (inferred). Clock skew is a qualification check on the PC (plan, B9),
  and a hybrid logical clock bounds its effect.
- **Doubled polling.** Two copies poll the Wemo plugs, speakers, weather and
  Roborock, and call vendor accounts twice. Roborock and the Volcano link may
  not tolerate a second client. Under this proposal their collection stays
  with the lead.
- **Exposure.** Every secret copied to the PC doubles its exposure (inferred).
  Personal data also lives on a second machine. ADR 0011 allows that in
  owner-controlled storage.
- **History grows on both machines.** The prototype's illustration of about 470
  rows, or 0.4 MB, an hour is synthetic. The real rate is not known. From
  stage 2 each machine also stores the other's rows. Every fact delivered to
  both machines is then held twice on each machine, once per origin (A8), so
  for facts from producers that report to both, history grows about twice as
  fast on each machine (inferred).
- **Work per stage**, from the audit's effort marks unless stated: settings
  medium, lead-only high, local configuration low, media low to medium. The
  history exchange is small now that #1740 is delivered in source. Turning the
  archives and handling into facts, a qualified image for a PC standby and
  stage 4's per-device qualification are not sized.

## Alternatives considered

- **A cloud database holding the state.** The owner chose local state with no
  cloud (decision 1). It would add an internet dependency to every device
  reaction, which ADR 0012 already rejected for device paths.
- **A small cloud tie-breaker for the lead.** It would settle the split-lead
  case, but the owner chose no cloud for the first solution. It is the natural
  next step if the split lead proves costly.
- **Event sourcing with a replicated log.** Not adopted (decision 4). Each owner
  keeps its current state, which stays authoritative. The fact log carries
  facts, never commands, and this record replicates through it.
- **The database's built-in change capture for settings.** Not chosen
  (decision 5). Besides lacking latest-edit-wins, the prototype found it needs
  tombstones, keys that are not local counters, echo suppression and
  schema-version checks. A changeset from a wider table applied to a narrower
  one silently applied nothing.
- **A store with built-in replication instead of SQLite.** Not adopted: no store
  moves off SQLite (decision 4).
- **A cold standby from periodic snapshots.** It needs no merge rules, and loss
  is the time since the last snapshot. Three blockers stand today (audit,
  answer 5). Exclusive locking means the snapshot must come from inside the
  runtime, and no such code exists. Restore refuses a different source revision
  and is qualified only on Mac ARM64. A copied volume is not a device handoff.
- **Keep ADR 0008 unchanged.** The Mac stays the only host, and an outage lasts
  until the Mac returns. This is the cheapest option and remains in force for
  every stage the owner has not accepted.

## Open decisions for the owner

Each item names the first stage that needs it.

1. **Stage 1 changed after the owner was asked** (*proposed*, not yet put to
   the owner).
   - **What changed:** on 2026-11-12 the owner was asked about a standby
     started by hand when the Mac is down. Revision 4 replaced it with a PC
     copy that runs all the time alongside the Mac, with device control off.
   - **Why:** the PC must read the Mac's settings while the Mac runs, and a
     takeover cannot read from a Mac that is down.
   - **Cost:** the continuous copy needs a standby mode, refusal of settings
     edits and a qualified control switch, none of which exists today (stage
     1, "Before it starts").
   - **Alternative:** a hand-started standby that copies settings at takeover
     from the last backup, or not at all.
     - From the backup: settings are only as fresh as that backup. Today's
       restore refuses a different source revision and is qualified only on
       Mac ARM64 (audit, answer 5).
     - Not at all: the owner re-enters settings by hand during a takeover.
   - The owner has not been asked about this version.
2. Now that the probe has passed: whether to accept stage 1, and whether to
   authorize the PC as a standby runtime host (stage 1). The result authorizes
   neither by itself.
3. Which image a PC standby runs. The local build qualifies nothing, so a
   standby needs a qualified image for the PC's processor, through a release
   qualification lane (a gate change) or another route the owner chooses
   (stage 1).
4. Each ceiling's split between the machines (stage 1).
5. Which secrets to place on the PC (stage 1).
6. Whether to move or duplicate the Mac-only inputs, the Tronbyt server first
   (stage 1).
7. The clock for latest-edit-wins: a hybrid logical clock, or wall time with an
   origin tie-break (stage 1).
8. The takeover interval's length, and how the PC checks that it can reach the
   Mac and the home router (stage 3).
9. How each installation knows which peer is the preferred lead (stage 3).
10. Which devices to qualify for either-copy writes, starting with Nanoleaf and
   Pixoo (stage 4).
