## Why

In the [#743](https://github.com/jimmie-potts/agent-device-hub/issues/743) owner trial (epic [#738](https://github.com/jimmie-potts/agent-device-hub/issues/738)), pressing the key of the Claude Desktop Code session that Claude already showed in front failed closed as `focus-failed step verify reason selection-mismatch`. Claude Desktop advances a session's `lastFocusedAt` only when the selection changes, so a link to the session it already shows moves nothing, and the router waits for an advance that never comes. The same key pressed from another app works, because raising the window stamps the session. The owner decided to accept "already newest" evidence ([decision comment](https://github.com/jimmie-potts/agent-device-hub/issues/743#issuecomment-5996572555)).

## What Changes

- Before the link, when Claude owns the foreground, the router reads every known Claude Desktop record in bounded calls. If the target's `lastFocusedAt` is strictly greater than every other known session's, it has already-newest evidence.
- After the link, verification passes as before when only the target's `lastFocusedAt` moved past the press. With already-newest evidence it also passes when the target is still strictly the newest and no other session's `lastFocusedAt` moved past the press.
- A tie, a foreground that is not Claude or is unknown, or any unknown or failed read before the link gives no evidence, and verification fails closed as before. The link is opened once and no keystroke is added. The version re-gate and composer step are unchanged.
- The bridge README and the qualification report describe the extra evidence.

## Capabilities

### Modified Capabilities

- `chompi-task-routing`: Claude selection also accepts a target that was already strictly the newest with Claude in front.

## Impact

Bridge router only; no OS adapter, profile, Hub or contract change. The fake adapter now models Claude's real behavior of not stamping a link to the session it already shows in front. Installation means reinstalling the bridge on Windows, and the live check is part of the #743 trial.
