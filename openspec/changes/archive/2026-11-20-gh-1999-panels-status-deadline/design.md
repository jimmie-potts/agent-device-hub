## Context

The Nanoleaf worker checks device ownership serially with frame output. Both live Music and prepared shows use the same playback loop. The link already distinguishes its own deadline, the HTTP transport's deadline and other failures for diagnosis.

## Decisions

- Tell the worker when either existing deadline ended a GET. Preserve the current reachability update, trace behavior and error handling for other callers.
- Keep one in-memory miss state within the playing worker. Use the next regular ownership check to clear it. An immediate extra read would change cadence. Sending frames before that check would rely on an unconfirmed selection.
- Handle pending endings before deciding whether to check again, finish for a second deadline, or send any frame. Require explicit power and brightness when a check or restoration resolves the hold. Missing evidence cannot authorize a frame or restoration. The show timeline and source validity continue as they do during any slow read.
- Forget any first frame prepared before the hold. Render from a current input or the current timeline position once ownership is confirmed. An interruption or restart still retires the session.

## Risk

An NL22 selection that reports the same streaming value, brightness and power is already indistinguishable under the existing guard. The hold requires the same positive checks and gives no additional write authority. Cover both read stages, two consecutive misses, pending endings, confirmed takeover and resume timing on a disposable clock.

## Deployment

This is a source-only change. There is no store or contract migration. The installed pilot under #725 can select a later qualified runtime batch and verify the actual Panels.
