# ADR 0013: Pixoo moments as interludes

Status: Accepted for
[Hub #1287](https://github.com/jimmie-potts/agent-device-hub/issues/1287) under
[epic #677](https://github.com/jimmie-potts/agent-device-hub/issues/677). The
owner's decision of 2026-11-03 is recorded in that epic: art shows over Media and
resumes in place, shows over Monitor briefly only when nothing needs attention,
with a setting to turn that off, and attention ends it at once with no replay. The
other rules below follow from it, from ADR 0006 and from the issue's discussion.
The [owner's 2026-11-05 amendment](https://github.com/jimmie-potts/agent-device-hub/issues/1288#issuecomment-6650127516)
allows brief scheduled exact art over empty Media while retaining explicit pauses,
attention, pins and Now Playing takeovers. Ordinary mood moments keep their policy.
Physical acceptance belongs to
[#687](https://github.com/jimmie-potts/agent-device-hub/issues/687).

This amends the Pixoo's ADR 0018, *Monitor and Media share the existing writer*.
Its repository, divoom-app-upgrade, is archived, and the copy under
`docs/diagrams/legacy/sources/` is a receipted snapshot that does not change, so
the amendment lives here. The same applies to that repository's
`agent-monitor-controls` specification and its "Explicit display participation"
requirement: their current successor is
[`bunny-pixoo-module`](../../openspec/specs/bunny-pixoo-module/spec.md).

## Context

ADR 0018 rejected automatic attention takeover because it would violate Media
intent. [ADR 0006](0006-hub-moments-and-interludes.md) then defined moments: the
hub decides, and the device enforces bounds, precedence and return to its current
base. The Pixoo declared moments unsupported until now.

## Decision

ADR 0018's rejection stands for raw agent events: they still never select a mode.
A moment is a different thing, and may cover the current base for a short time.

- **Over Media**, a moment pauses a playing playlist and resumes it at the same
  item when it ends. A paused or stopped item refuses the moment, because no call
  can repaint it. A player with nothing loaded takes the moment without being
  touched, and one blank frame follows it (see the amendment below).
- **Over Monitor**, a moment plays only when all of these hold: the hub marks it
  as allowed to cover status (ADR 0006's interrupt set), the owner's setting is on,
  and the session source is current and shows nothing needing attention. The
  setting defaults to on. Turning it off ends a moment over Monitor.
- **Attention** (approval, input or question) ends a moment at once on either base,
  and it is never replayed. It also refuses a new one on either base. Over Monitor,
  a session source that stops being current ends a moment the same way, since
  nothing then shows that no attention is needed. Over Media, missing session
  evidence does not stop a moment, because Media does not present status.
- **Now Playing** keeps the display: a moment is refused while a takeover holds
  it. A song that wants the whole display during a moment takes over when the
  moment ends, without the playlist flashing in between. A track that starts
  during a moment over Media gets no pop-up afterwards.
- **Any explicit command** that changes what plays ends a moment. A pause, stop or
  new start owns what comes next and is never resumed over, and neither is a start
  still capturing its selection. A next or previous keeps the playlist playing,
  since the moment paused it, not the owner. A Monitor view change in Media leaves
  playback alone, so the moment ends and the playlist resumes.
- **Time box.** A moment's picture does not outlast it. When nothing follows it,
  such as after a manual pause, stop or change to Media, one blank frame replaces
  it. There is no call that repaints a paused item. An uncertain write is one
  exception: as in ADR 0018, unknown artwork is not rolled back. The blank is also
  dropped once the device was offline or under external control, because what it
  shows by then may be the owner's. The picture stays in those cases.
- **Mode.** A moment never changes the device mode.
- **Restart.** A moment is never replayed. Its command reports `uncertain` at the
  next start, and its ID stays refused for 24 hours. The player's own rule still
  applies after a restart: playback stays paused until someone resumes it, so a
  restart during a moment over Media leaves its picture on until then.

Return uses the existing path. Over Media, the moment holds the player through the
Now Playing takeover and resumes only if the generation its own pause produced,
the paused intent and the screen request are all unchanged. There is no second
restore path. Over Monitor, the next picture is the current dashboard, not a saved
one. Empty Media has nothing to restore and uses the existing one-shot blank path.
The Pixoo adds no policy of its own about event kinds or cooldowns; those stay
in the hub.

## Consequences

The Pixoo declares `capabilities.moments` with its moods and duration bound, and
`coversStatus` follows the owner's setting. A flourish cannot cover status under
`moment-play`'s schema, so a moment meant to appear over Monitor must be sent as an
`event` with `coversStatus` set. Choosing that is the sender's concern
([#684](https://github.com/jimmie-potts/agent-device-hub/issues/684)).

Source and simulator tests prove the source behavior only. They do not show what a
physical Pixoo displays.

## Amendment, 2026-11-05

The owner chose to let a Pixoo with nothing loaded show art, and return to its idle
screen afterwards. This replaces the first decision's refusal of every player that
is not playing: Media is the default mode, so that refusal would have hidden most
scheduled art. A paused or stopped item still refuses, because nothing could repaint
it. So does a player in error, and a display left unknown by an uncertain write or
external control, until the next start, clear or restart.

The module can't read back what the device showed or return it to a built-in channel,
so the "idle screen" is one black frame. On a fresh installation the device's own
display therefore goes black after its first moment. A restart during such a moment
leaves the art on with nothing to blank it, until something else writes, and it also
forgets an unknown display on an empty player. How this looks on a real Pixoo belongs
to [#687](https://github.com/jimmie-potts/agent-device-hub/issues/687).
