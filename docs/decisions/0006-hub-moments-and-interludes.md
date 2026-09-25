# ADR 0006: Hub moments and interludes across devices

Status: Accepted definition under [hub #291](https://github.com/jimmie-potts/agent-device-hub/issues/291),
2026-09-25. Implementation, installation and physical acceptance remain in the
linked issues.

## Context

Provider hooks and the shared monitor already feed the hub. Each device still
renders its own status presentation, from the shared feed or its own selected
input: the Nanoleaf worker draws Work and the Pixoo shows Monitor. Tidbyt and LIFX will connect through
[#289](https://github.com/jimmie-potts/agent-device-hub/issues/289).

The owner wants events to trigger coordinated animations across devices, for
example when a pull request merges, when CI fails, or before a meeting. The
owner also wants agents to add occasional flair of their own, such as a light
animation they compose or a Pixoo image they choose. Several existing issues
touch parts of this:
[#45](https://github.com/jimmie-potts/agent-device-hub/issues/45) (approved
rules), [#40](https://github.com/jimmie-potts/agent-device-hub/issues/40)
(music participation, alert interruption and restoration per device),
[#267](https://github.com/jimmie-potts/agent-device-hub/issues/267)
(coordinated looks) and [#139](https://github.com/jimmie-potts/agent-device-hub/issues/139)
(event history).

[Controller contract v1](../controller-contract.md) has a closed set of
commands. When [codex-nanoleaf #92](https://github.com/jimmie-potts/codex-nanoleaf/issues/92)
needed Codex to request light animations, it therefore added an
`animation.play` operation to the Nanoleaf-owned `nanoleaf.integration/1.0`
extension. That operation is typed, runs only in Free, stays within the effect
size proven on the device, and is journaled by the single writer. If every
device grew its own extension like this, the hub would need device-specific
code.

[ADR 0005](0005-general-device-controls.md) keeps content controls in Free or
Media, rules out a silent all-device takeover, and says nothing restores
automatically.

## Decision

The hub decides and devices guarantee. Policy lives in the hub; mechanism,
safety and returning to the base presentation live in each device controller.

### The hub owns policy

- **Event sources.** The hub normalizes each event and gives it a stable ID.
  It removes duplicates. Restarts, reconnects and historical replay (#139)
  never trigger a moment.
  - Pull request and CI events come from polling GitHub
    ([#293](https://github.com/jimmie-potts/agent-device-hub/issues/293)).
    Webhooks would need inbound access, and the architecture keeps services on
    loopback unless reachability is made explicit
    ([architecture](../architecture.md#controller-boundary),
    [SDLC scope defaults](../sdlc.md#scope-defaults)).
  - Meeting reminders come from a calendar source
    ([#298](https://github.com/jimmie-potts/agent-device-hub/issues/298)).
- **Rules.** Owner-approved rules map events to moments. The owner can edit
  the interrupt set without a code change. #45 owns storing and editing rules
  and the interrupt set, and arbitrating the moments rules trigger.
- **Agent personas.** Each agent has a signature look and a flourish budget
  ([#294](https://github.com/jimmie-potts/agent-device-hub/issues/294)).
- **Arbitration.** The hub checks each moment against quiet hours, the budgets,
  the global "no flourishes" switch, and the current mode and alert state.
  That includes moments that agents propose
  ([#295](https://github.com/jimmie-potts/agent-device-hub/issues/295)).
- **Choreography.** One moment can reach several devices with a shared palette
  and a best-effort start time
  ([#297](https://github.com/jimmie-potts/agent-device-hub/issues/297)).
- **Moment log.** A log records, for each moment, what triggered it, which
  devices it targeted, their receipts, and any pre-emption
  ([#296](https://github.com/jimmie-potts/agent-device-hub/issues/296)).

The hub sends semantic intents. It never sends frames, raw protocol or
device-specific geometry.

### Each device owns mechanism

- **Translation.** The device turns an intent into its own output, using its
  geometry, encoder and limits. An intent is a mood, an optional palette and a
  duration.
- **Safety.** One writer per device. Bounds and validation happen at the
  device. Credentials never leave the controller.
- **Precedence.** The device makes the final call when it executes. The order
  is: attention and failure alerts first, then moments, then the base
  presentation. While the device presents status, an attention or failure
  alert (Nanoleaf red or yellow) pre-empts a moment, whether the alert existed
  before the moment or arrives during it. A stale hub decision loses safely
  through the existing generation guards.
- **Return to base.** The device plays at most one moment at a time. When the
  moment ends, it returns to its *current* base presentation, never to a
  snapshot taken before the moment. It never replays a moment after a restart.
- **Evidence.** Receipts stay truthful, and the device reports external control
  when a change happens outside the controller.
- **Degradation.** If the hub is unavailable, the device keeps presenting
  status. A device that consumes the shared feed shows that status as visibly
  stale, as it does today, and no moments play. A moment that misses its
  window is dropped, not queued.

### Contract

A shared `moment` command and a `moments` capability arrive in a new controller
contract API minor version, with compatible negotiation, following the
contract's compatibility rules.
[#292](https://github.com/jimmie-potts/agent-device-hub/issues/292) delivers it
together with conformance fixtures.

- **The command carries:**
  - A moment ID derived from the triggering event. The device ignores
    duplicates of the same ID.
  - The intent: a mood and an optional palette. The palette is optional so the
    device can fall back to its own preset for the mood.
  - A bounded duration.
  - A priority class.
  - Whether the moment may cover status presentation. This is true only for
    event kinds in the interrupt set.
  - A best-effort start time. #292 must define its clock domain, because the
    contract never compares times across processes without a shared epoch.
- **The capability declares** the moods the device supports, its duration
  limit, and whether it can cover status presentation.
- Nanoleaf's `animation.play` operation remains for explicit user requests,
  which persist until something replaces them.

### Moments are always transient

- **Every moment is time-boxed.** An *interlude* is any moment's playback that
  then returns to the device's current base presentation.
- **Status presentation.** A moment may play as an interlude over Nanoleaf
  Work or Pixoo Monitor only if its event kind is in the owner's interrupt set.
  At the end, the device returns to current status.
- **Content modes.** Any approved moment may play as an interlude over Free or
  Media content, whether or not its event kind is in the interrupt set. At the
  end, the device returns to the scene or playlist it is showing now.
- **Ending early.** An attention or failure alert on status presentation
  pre-empts an interlude, and any explicit command ends it.
- **Skipped states.** No interlude plays while a device shows a quiet
  presentation, such as Nanoleaf Quiet, or during quiet hours. Quiet hours are
  the owner's do-not-disturb control.
- **Relation to ADR 0005.** Returning to the current base after an interlude is
  not ADR 0005 *restoration*. In ADR 0005, restoration means returning from
  content to status through an explicit mode command, and that stays explicit.
  No moment changes a device's selected mode. Content controls stay in Free or
  Media. This decision revises ADR 0005's "nothing restores automatically" only
  for the automatic end of an interlude.
- **Not a takeover.** A choreographed moment is not ADR 0005's all-device
  takeover or a desk preset. It changes no modes. It sends each device an
  independent moment that the device can pre-empt, and one device's failure
  never blocks another.

### Agents

Agents propose flourishes and the hub decides. Agents never command devices
directly for a flourish. Explicit requests a person makes through the existing
MCP tools are unchanged.

### Privacy

- Events carry only a kind, neutral aliases and, for a meeting reminder, its
  start time. They never carry pull request titles, repository content,
  calendar titles or attendees.
- A Pixoo image search that an agent proposes
  ([divoom #94](https://github.com/jimmie-potts/divoom-app-upgrade/issues/94))
  uses generic mood tags only, never task or repository text.

## Owner decisions

These starting defaults were recorded on 2026-09-25. All of them are editable,
and the issues listed own the exact values.

- **Interrupt set.** A merged pull request, a failed CI run, and meeting
  reminders (#45).
- **Quiet hours.** Built with an on/off switch and a schedule. The default is
  off. Revisit the default when the owner's schedule settles (#295).
- **Flourish budget.** Start conservative, test for a few days, then expand,
  without blocking other delivery (#294):
  - Per agent: at most 1 flourish per completed task and at most 2 per hour.
  - Across all agents: at most 6 per hour.
  - At least 5 minutes between flourishes on any one device.
- **Timing.** Best-effort start times. Open a story to qualify device sync only
  if devices visibly drift during choreography (#297).

## Vocabulary

| Term | Meaning |
| --- | --- |
| Moment | A hub-decided, semantic presentation request sent to one or more devices. It is always transient. |
| Interlude | A moment's time-boxed playback that then returns to the device's current base presentation. |
| Base presentation | Whatever the device would show without the moment: status, a scene or a playlist. |
| Interrupt set | The owner-editable event kinds whose moments may cover status presentation. |
| Flourish | A moment an agent proposes as personality, rather than one a rule triggers. |
| Persona | An agent's signature look and flourish budget. |
| Choreography | Sending one moment's intent to several devices with a shared palette and a best-effort start. |
| Moment log | The record of each moment's trigger, targets, receipts and pre-emptions. |

## Consequences

- **Device logic stays deliberate.** Translation, precedence, returning to base
  and evidence stay in each device. The hub stays device-agnostic, and a hub
  outage never blanks a status display.
- **Contract work first.** Devices need the new contract minor version,
  negotiation and conformance before they can play moments. Explicit Free-mode
  requests keep working today.
- **Small state machines.** Returning to base after an interlude adds a small
  state machine to each device controller.
- **Budgets start tight.** Conservative budgets trade expressiveness for trust
  until the owner expands them.
- **Bounded issues.**
  - Hub:
    - #292 (contract), #293 (GitHub events), #294 (personas), #295 (agent
      proposals), #296 (moment log), #297 (choreography), #298 (calendar).
    - #45 for rules and the interrupt set.
    - #40, which decides where music playback sits in this precedence.
  - Nanoleaf:
    - [#146](https://github.com/jimmie-potts/codex-nanoleaf/issues/146): its
      event-to-animation mapping moves to hub rules.
    - [#158](https://github.com/jimmie-potts/codex-nanoleaf/issues/158):
      interludes.
    - [#161](https://github.com/jimmie-potts/codex-nanoleaf/issues/161):
      external control.
    - [#153](https://github.com/jimmie-potts/codex-nanoleaf/issues/153): mood
      presets.
    - [#150](https://github.com/jimmie-potts/codex-nanoleaf/issues/150):
      restoring the remembered scene.
  - Pixoo:
    - [#91](https://github.com/jimmie-potts/divoom-app-upgrade/issues/91): mood
      tags.
    - [#92](https://github.com/jimmie-potts/divoom-app-upgrade/issues/92):
      interludes.
    - [#93](https://github.com/jimmie-potts/divoom-app-upgrade/issues/93):
      agent-generated art.
    - [#94](https://github.com/jimmie-potts/divoom-app-upgrade/issues/94):
      staged GIF proposals.
  - Tidbyt and LIFX declare `moments` unsupported until each has its own
    interlude story, after #289 connects them.
- **Decision only.** This decision creates no implementation, installation or
  device operation, and adds no OpenSpec product delta by itself. Each
  implementation issue records its own capability delta.
