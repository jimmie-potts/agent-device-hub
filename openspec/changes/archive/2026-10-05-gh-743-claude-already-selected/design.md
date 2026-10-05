## Context

Claude selection is verified from the Desktop session store, not UI Automation: the router compares each known session's `lastFocusedAt` with the press time. Claude Desktop stamps `lastFocusedAt` when the selection changes, but not when a link names the session it already shows in front. In the trial the same key pressed from another app verified, so raising the window does change what the router observes. The Record and Send re-check already accepts a target whose `lastFocusedAt` is not older than any other known session's.

## Decisions

- **Evidence is taken before the link.** In the target check, after the target record is known to exist and not be archived, the router reads the foreground window and, only when its package family is Claude's, every known Desktop ID (slot records and Hub `hostSessionId`s) in calls of 64 IDs. The CHOMPI is a USB HID device and a key press does not change the foreground, so a foreground read between the press and the link stands for "Claude was in front at the press". No new adapter call is needed: the existing `foregroundWindow` and `claudeSessions` observations suffice.
- **Strictly newest.** The target's `lastFocusedAt` must be known and greater than every other returned record's non-null value. A tie is not newest. A requested ID with no record is not a Desktop session and does not compete, as in the existing checks.
- **Incomplete means none.** Any failed, timed-out or unknown call, including one chunk of several, gives no evidence. It does not fail the target check: verification then needs the existing advance past the press, so behavior is exactly as before.
- **After the link.** Each poll reads every known ID again. An advance past the press keeps its existing meaning (alone: pass; with another session also past the press: `selection-ambiguous`). Without an advance, already-newest evidence passes only when the target is still strictly the newest among the IDs known at that poll and no other session moved past the press; otherwise the result stays `selection-mismatch`. A session the router learns of during verification therefore counts.
- **Residual risk.** The evidence is that the target is the newest among the sessions the bridge knows (slot records plus Hub `hostSessionId`s), not that it is Claude's last selected session overall: a Desktop session the bridge does not know is never read. The window's view is unobserved. Code home, the Chat tab and a session the bridge does not know are therefore covered only by the link navigating to the target: if Claude is in front on one of them while the target is strictly newest among known sessions and the link does not navigate, verification passes. The composer step does not mitigate this, because `composerFocused` accepts any focused `ProseMirror` `Edit` in the Claude window. The Record and Send re-check accepts the same evidence, and the owner accepted it for the trial. The #743 trial checks whether the link navigates from Code home and from the Chat tab while Claude is in front. `routing-router.test.mjs` pins this residual as an accepted case.

## Failure and recovery

Every unknown or failed observation removes the extra path and leaves the existing fail-closed result. Nothing is retried, the link is opened once and no keystroke is added.

## Acceptance examples

| Example | Test |
| --- | --- |
| Already-selected target with Claude in front verifies; foreground and every record are read before the link; Record then passes its re-check | `routing-router.test.mjs` |
| A changed selection with Claude in front still verifies by the advanced `lastFocusedAt` | `routing-router.test.mjs` |
| A tie or a newer other session fails as `selection-mismatch` | `routing-router.test.mjs` |
| A failed second bounded read before the link (80 known sessions) gives no evidence | `routing-router.test.mjs` |
| Claude not in front before the link gives no evidence, even when the link does not stamp | `routing-router.test.mjs` |
| Another session moving past the press, or a newer session learned after the link, fails | `routing-router.test.mjs` |
| An unknown foreground before the link gives no evidence; the advance rule applies | `routing-router.test.mjs` |
| Accepted residual: Claude in front on Code home with the target strictly newest verifies when the link does not navigate | `routing-router.test.mjs` |
| The `focused` log names the evidence, `advanced` or `already-newest`, for Claude only | `routing-router.test.mjs` |
