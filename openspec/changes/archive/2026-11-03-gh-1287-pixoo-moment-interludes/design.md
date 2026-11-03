## Context

`MonitorPresentation` already decides what the Pixoo shows beside the player: the dashboard while Monitor participates, and a Now Playing card, sometimes over a playlist paused under a guarded takeover. All pictures go through `Player.uploadDashboard`, which is generation guarded and serialized with the device's other writes. A moment needs the same owner and the same writer.

## Decisions

- **The moment lives in `MonitorPresentation`.** It is one more thing that picture can be. A separate component would need its own copy of the attention, takeover and mode rules, and would be a second path to the writer. The rejected alternative was a player-level interlude, which would have mixed presentation policy into playback.
- **Over Media it reuses the takeover.** A `moment` kind of takeover shares `hold`, the guard `givenBack` and the resume `giveBack` with Now Playing. The moment's hold additionally refuses to record a generation other than the one its own pause produced, so a manual pause that lands during the hold is never resumed over.
- **Over Monitor it writes under Monitor's own generation.** Nothing pauses or resumes. Clearing `lastFrame` at the end sends whatever the dashboard is by then, so the return goes to the current base.
- **Conditions over Monitor are all required.** The issue's comment requires the hub's `coversStatus` mark, and the owner's decision adds the setting and the attention rule. Taking them together satisfies both and keeps ADR 0006's interrupt set in force. The cost is that a sender must use `priorityClass: 'event'` for art meant to appear over Monitor, since a flourish cannot set `coversStatus`.
- **Attention is a level, not an edge, on both bases.** A session already waiting refuses a moment on Media too, so the same rule holds whether attention came first or second. Missing evidence refuses only over Monitor, where it could hide attention.
- **A paused or stopped Media player refuses.** There is no call that repaints a paused item, so a moment there would leave its art on the display. Refusing is the only way to never leave a stale picture.
- **A takeover refuses.** Layering over a card would need the card's expiry to wait for the moment. Refusing is smaller, and at 6 to 8 appearances a day a missed one costs little. The hub logs the refusal.
- **The start and end writes skip Monitor's cadence, down to one write a second.** With a 10 s cadence a moment could otherwise miss its window or overstay its duration. Writes stay one at a time.
- **The duration counts from the acknowledged write**, as Nanoleaf counts from its effect write, so a slow upload does not shorten what is seen.
- **A moment's write stands once launched.** Aborting it when attention arrives could leave its result uncertain, and an uncertain write pauses the player on a real device, which would stop Monitor just as attention needs it. So only a newer player generation retires it, and the current base replaces it. The scenario over the remote transport found this.
- **Frames are drawn before anything else happens.** A failed render reaches neither the player nor the device.
- **The seam is `momentContent(request)`.** It returns a `MomentContent` union that `renderMomentContent` draws in the render worker. #679 adds a member for its art reference and a case for drawing it; the presentation receives frames and does not change. The player's picture write takes one or two frames, so a longer animation needs that widened separately.

## Risks / Trade-offs

- A moment cut off by a crash over Media leaves its picture on the display until someone resumes, because a restart pauses playback by the player's existing rule. The moment's command reports `uncertain`, and the player reports paused, so the record is truthful.
- If the dashboard's render fails as a moment ends over Monitor, the moment's picture stays until a render succeeds, as a failed render keeps the last picture everywhere else.
- A track that starts during a moment over Media gets no pop-up afterwards. A whole takeover still begins.

## Recovery

The table and the setting row are additive. Older code ignores both. Nothing needs migrating, and no earlier data changes.
