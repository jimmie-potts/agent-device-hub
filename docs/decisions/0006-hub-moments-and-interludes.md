# ADR 0006: Hub moments and interludes across devices

Status: Accepted definition under [hub #291](https://github.com/jimmie-potts/agent-device-hub/issues/291),
2026-09-25. Implementation, installation and physical acceptance remain in the
linked issues.

## Context

Provider hooks and the shared monitor already feed the hub. Each device still
renders its own status presentation: the Nanoleaf worker draws Work from the
shared feed, and the Pixoo shows Monitor. Tidbyt and LIFX join through
[#289](https://github.com/jimmie-potts/agent-device-hub/issues/289).

The owner wants events to trigger coordinated animations across devices. The
first events are a merged pull request, a failed CI run and an upcoming
meeting. The owner also wants agents to add occasional flair of their own: a
light animation they compose or a Pixoo image they pick. Parts of this appear
in [#45](https://github.com/jimmie-potts/agent-device-hub/issues/45) (approved
rules), [#40](https://github.com/jimmie-potts/agent-device-hub/issues/40)
(interruption and restoration), [#267](https://github.com/jimmie-potts/agent-device-hub/issues/267)
(coordinated looks) and [#139](https://github.com/jimmie-potts/agent-device-hub/issues/139)
(event history).

[Controller contract v1](../controller-contract.md) is a closed command union.
To let Codex request light animations,
[codex-nanoleaf #92](https://github.com/jimmie-potts/codex-nanoleaf/issues/92)
therefore added a Nanoleaf-owned `animation.play` extension: typed, Free-only,
bounded to what the device is proven to handle, and journaled by the single
writer. Adding a similar extension to every device would push device-specific
code into the hub.

[ADR 0005](0005-general-device-controls.md) keeps content controls in Free or
Media and says nothing restores automatically.

## Decision

The hub decides, and devices guarantee. Policy lives in the hub. Mechanism,
safety and restoration live in each device controller.

### The hub owns policy

- **Event sources.** The hub normalizes each event and gives it a stable ID,
  deduplicates, and never replays old events after a restart. It reads pull
  request and CI events by polling GitHub
  ([#293](https://github.com/jimmie-potts/agent-device-hub/issues/293)), because
  ADR 0004 defers inbound access. Meeting reminders come from a calendar source
  ([#298](https://github.com/jimmie-potts/agent-device-hub/issues/298)).
- **Rules.** Owner-approved rules map events to moments (#45). The owner can
  add and remove rules without a code change.
- **Agent personas.** Each agent has a signature look and a flourish budget
  ([#294](https://github.com/jimmie-potts/agent-device-hub/issues/294)).
- **Arbitration.** The hub decides every moment against quiet hours, budgets,
  a global "no flourishes" switch and the current mode and alert state. That
  includes moments agents propose
  ([#295](https://github.com/jimmie-potts/agent-device-hub/issues/295)).
- **Choreography.** One moment can go to several devices with a shared palette
  and a best-effort start time
  ([#297](https://github.com/jimmie-potts/agent-device-hub/issues/297)).
- **Moment log.** A log explains each device change: the trigger, the targets,
  the receipts and any pre-emption
  ([#296](https://github.com/jimmie-potts/agent-device-hub/issues/296)).

The hub sends semantic intents. It never sends frames, raw protocol or
device-specific geometry.

### Each device owns mechanism

- **Translation.** A device turns an intent (mood, palette, duration) into its
  own output, using its geometry, encoder and limits.
- **Safety.** One writer per device, bounds and validation at the device, and
  credentials that never leave the controller.
- **Precedence.** The device makes the final call when it executes: alerts
  beat interludes, and interludes beat ambient content. A stale hub decision
  loses safely through the existing generation guards.
- **Restoration.** The device records its base presentation and plays at most
  one interlude. Afterwards it returns to the *current* base, not to a
  snapshot from before the interlude, and it never replays after a restart.
- **Evidence.** Receipts stay truthful, and the device reports external control
  when someone changes it outside the controller.
- **Degradation.** Status presentation keeps running locally when the hub is
  unavailable. Moments that miss their window are dropped, not queued.

### Contract

A shared `moment` command and a `moments` capability arrive in a new
controller contract API minor version, with compatible negotiation, following
the contract's compatibility rules. Delivery is
[#292](https://github.com/jimmie-potts/agent-device-hub/issues/292), with
conformance fixtures.

- **The command carries:**
  - a moment ID that the device uses to ignore duplicates, derived from the
    triggering event;
  - a mood and an optional palette;
  - a bounded duration;
  - a priority class;
  - whether the moment may play as an interlude;
  - a best-effort start time.
- **The capability declares:** the moods the device supports, its duration
  limit and whether it can play interludes.
- **Device extensions stay.** Nanoleaf's `animation.play` extension remains for
  explicit user requests.

### Interludes

- A moment may take over status presentation only as a time-boxed interlude,
  and only when its event kind is in the owner's editable interrupt set.
- The device restores the current base when the interlude ends.
- A new alert pre-empts an interlude, and any explicit command ends it.
- Interludes are skipped while a device shows a quiet presentation, such as
  Nanoleaf Quiet, and during quiet hours.
- This revises ADR 0005's "nothing restores automatically" for interludes
  only. Everywhere else ADR 0005 is unchanged: content runs in Free or Media,
  modes never change as a side effect, and restoration is explicit.

### Agents

Agents propose flourishes, and the hub arbitrates them. Agents never command
devices directly for a flourish. Explicit requests a person makes through the
existing MCP tools are unchanged.

### Privacy

- Events carry a kind and neutral aliases only. No PR titles, repository
  content, calendar titles or attendees.
- Any external image search uses generic mood tags, never task or repository
  text.

## Owner decisions

These are starting defaults, recorded on 2026-09-25. All of them are editable.

- **Interrupt set.** PR merged, CI failed and meeting reminders.
- **Quiet hours.** Built with an on/off switch and a schedule. Default: off.
  Revisit when the owner's schedule settles.
- **Flourish budget.** Conservative at first, tested for a few days, then
  expanded, without blocking other delivery:
  - per agent, at most 1 per completed task and 2 per hour;
  - across all agents, 6 per hour;
  - at least 5 minutes between flourishes on any device.
- **Timing.** Best-effort start times. Open a sync qualification only if
  devices visibly drift.

## Vocabulary

| Term | Meaning |
| --- | --- |
| Moment | A hub-decided, semantic presentation request sent to one or more devices. |
| Interlude | A moment that briefly replaces status presentation and then restores the current base. |
| Base presentation | Whatever the device would show without the moment: status, a scene, a playlist. |
| Flourish | A moment an agent proposes as personality, rather than a rule triggering it. |
| Persona | An agent's signature look and flourish budget. |
| Interrupt set | The owner-editable event kinds allowed to play as interludes. |

## Consequences

- **Devices keep deliberate logic.** Translation, precedence, restoration and
  evidence stay in each device, so the hub stays device-agnostic, and a hub
  outage never blanks a status display.
- **Moment contract.** The moment contract needs an API minor version,
  negotiation and conformance work before devices can play interludes.
  Explicit Free-mode requests keep working today.
- **More device work.** Interlude restoration adds a small state machine to
  each device controller.
- **Budgets.** Conservative budgets trade expressiveness for trust until the
  owner expands them.
- **Bounded issues.**
  - Hub: #292, #293, #294, #295, #296, #297 and #298, with #45 for rules and
    #40 for music interruption.
  - Nanoleaf: [#158](https://github.com/jimmie-potts/codex-nanoleaf/issues/158)
    (interludes), [#161](https://github.com/jimmie-potts/codex-nanoleaf/issues/161)
    (external control), [#153](https://github.com/jimmie-potts/codex-nanoleaf/issues/153)
    (mood presets) and [#150](https://github.com/jimmie-potts/codex-nanoleaf/issues/150)
    (restore).
  - Pixoo: [#91](https://github.com/jimmie-potts/divoom-app-upgrade/issues/91),
    [#92](https://github.com/jimmie-potts/divoom-app-upgrade/issues/92),
    [#93](https://github.com/jimmie-potts/divoom-app-upgrade/issues/93) and
    [#94](https://github.com/jimmie-potts/divoom-app-upgrade/issues/94).
  - Tidbyt and LIFX join after #289.
- **No implementation yet.** This decision creates no implementation,
  installation or device operation, and adds no OpenSpec product delta by
  itself. Each implementation issue records its own capability delta.
