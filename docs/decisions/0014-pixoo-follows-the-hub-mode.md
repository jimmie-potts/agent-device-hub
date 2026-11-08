# ADR 0014: The Pixoo follows the Hub mode

Status: Accepted for
[Hub #1574](https://github.com/jimmie-potts/agent-device-hub/issues/1574) under
[epic #1050](https://github.com/jimmie-potts/agent-device-hub/issues/1050),
owner decision of 2026-11-08. Amends [ADR 0005](0005-general-device-controls.md)
(its vocabulary and its rule that no common device-mode enum exists) and
[ADR 0013](0013-pixoo-moment-interludes.md) (moments over Monitor and over
Media). Withdraws both of ADR 0013's 2026-11-05 amendments: the empty-Media
amendment recorded in
[#1288](https://github.com/jimmie-potts/agent-device-hub/issues/1288#issuecomment-6650127516)
and Amendment 2's stopped-item rules, whose "a Monitor visit pauses the item"
no longer has a Monitor visit to refer to.
Implementation, installation and physical acceptance remain in the linked
issues: #1574 (contracts and module),
[#1575](https://github.com/jimmie-potts/agent-device-hub/issues/1575) (runtime
dashboard) and
[#1576](https://github.com/jimmie-potts/agent-device-hub/issues/1576) (install
and observation).

## Context

The Hub owns one Work/Free/Quiet mode
([runtime-hub-mode](../../openspec/specs/runtime-hub-mode/spec.md), #924 and
#695). Every participant except the Pixoo takes those values as its native
modes: the Nanoleaf renders from them, the Tidbyt will dim in Quiet (#1414) and
the LIFX bulb will join under #415. The Pixoo alone kept its own pair, Monitor
and Media, and the shared table mapped Work and Quiet to Monitor and Free to
Media, so that "Monitor stood for both Work and Quiet".

The Pixoo's mode also did two jobs at once. It was policy, deciding what a
moment could cover, and it was the content switch: Monitor drew the status
dashboard, Media played the playlist, starting a playlist switched the mode, and
every mode change paused the player. On 2026-11-08 a dashboard switch of the Hub
to Free left the Pixoo in Media, paused with nothing loaded. The paused flag was
the one a deliberate Pause sets, so the 19:33Z scheduled art appearance was
refused as if the owner had asked for a dark panel (#687). Two rules that each
made sense alone, "a mode change pauses" and "exact art needs a stopped player",
combined into a Pixoo that almost never showed daily art while the Hub was in
Free.

## Decision

The Pixoo takes Work, Free and Quiet as its native modes, straight from the
Hub-mode fan-out, and a mode is policy only.

- **A mode never chooses the content and never pauses the player.** The one
  exception is the Work stop below. Startup, restart and sync apply no mode;
  the module remembers the last mode it was given, Free before any.
- **Two bases.** The status dashboard rests on the display whenever the player
  holds no item. A started playlist or rendition is the playback base until it
  is stopped or cleared, and a paused item stays on the display as it does
  today. There is no empty Media state; Screen off is the way to a dark panel.
- **Work set.** Work admits the status base, the Now Playing pop-up, and moments
  or art the core marks as allowed to cover status (ADR 0006's interrupt set,
  which the art schedule's "cover status" setting already drives). Work refuses
  a playlist or rendition start and the whole-display Now Playing takeover.
  Selecting Work while something plays stops it and returns to the status base;
  nothing resumes automatically when Free returns (ADR 0005, "nothing restores
  automatically"). Free admits everything. Quiet admits what Free admits.
- **Quiet brightness.** Quiet applies the owner's Quiet brightness from the
  `pixoo` section (`quietBrightness`, 1 to 100, default 20) and, on leaving,
  restores the brightness last requested before Quiet. A brightness command
  during Quiet is honoured and persists until the next mode command, which
  reapplies the mode's policy, as ADR 0005 already says of the Nanoleaf: a
  Quiet command received in Quiet rewrites the Quiet level. Work and Free set
  no brightness of their own. What Quiet means elsewhere is unchanged: the core
  still blocks event-rule moments to a Quiet target, companions still refuse
  speech, the Nanoleaf still goes steady, and scheduled art still follows the
  automation quiet hours rather than the Hub mode.
- **Moments and art on the two bases.** Over the status base, attention or a
  stale session source refuses or ends a moment, and permission to cover status
  is required in Work only, since in Free and Quiet status is incidental. The
  owner's "moments over status" switch (today's "moments over Monitor") remains
  the one setting. Over the playback base, a playing item pauses and resumes in
  place, and a paused item refuses, since nothing can repaint it. The time box,
  the single blank frame, the no-replay rule and the Now Playing precedence of
  ADR 0013 stay. The empty-pause rule and both 2026-11-05 amendments are
  withdrawn, because the states they governed no longer exist: a stopped or
  finished item is no longer a base of its own but a retained item behind the
  status base, resumable in Free, and no view change pauses it. Screen off
  still pauses, as ADR 0005 says.
- **Contracts.** The Pixoo's `device` record advertises `work`, `free` and
  `quiet` and reports the Hub mode as `desired.mode`; `device-mode-set/2.0`
  carries them unchanged in shape; the shared table maps the Pixoo one to one.
  `pixoo-display/2.1` reports `mode` in the Hub's vocabulary, the `base` on the
  display and `moments.overStatus`. The Pixoo refuses a command that carries
  `requireMode` with `invalid-request`; routines keep an optional "runs only in
  Work, Free or Quiet" precondition that the core checks against the device's
  reported mode before sending. Presentation setting version 1 keeps accepting
  a `mode` member, ignored, so the installed configuration needs no edit.
  Legacy 1.x surfaces (`apps/dashboard`, `apps/hub`, `pixoo-integration/1.0`)
  are untouched and keep addressing the stopped writer.

## Vocabulary

| Term | Meaning |
| --- | --- |
| Base | What the Pixoo shows when nothing covers it: the status base or the playback base. Avoid "Monitor mode" and "Media mode". |
| Status base | The status dashboard drawn from the module's copy of the sessions. |
| Playback base | The player's current item, playing or paused. |
| Work set | The content kinds the Pixoo admits in Work. |
| Quiet brightness | The owner's brightness level applied in Quiet. |
| Remembered brightness | The brightness last requested before Quiet, restored on leaving it. |
| Monitor | Only the status dashboard's view settings (filter, cadence) and the `pixoo-monitor-set` wire family; no longer a mode. |

## Consequences

One mode vocabulary across the Hub's participants: no Hub-to-Pixoo mapping, no
hand-written reverse map in the dashboard, and the core's automation reads the
Pixoo's mode correctly (a Pixoo in `monitor` or `media` read as `quiet`, so its
event-rule moments were always blocked). A Hub switch can no longer look like
the owner's Pause.

Superseded: #1276's Media-only admission and #1297's content-mode precondition
give way to the Work refusal at the device and the Hub-mode precondition in the
core. The Nanoleaf's rule that a mode change clears its brightness override is
now shared in spirit; its text in ADR 0005 is unchanged.

Open extensions, deliberately left out: per-playlist "allowed in Work" flags and
a configurable Work set (first trigger: the owner wanting a playlist in Work;
manual alternative until then: select Free), and any Hub-wide change to what
Quiet means. The Tidbyt (#1414) and LIFX (#415) decide their own Quiet and Work
behavior and may cite this record for the brightness rule.
