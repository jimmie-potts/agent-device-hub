## Why

The [#743](https://github.com/jimmie-potts/agent-device-hub/issues/743) trial cannot pass its Send step: the Windows adapter answers approval visibility as unknown for both clients, so the router refuses every Send. When #742 shipped, no card had been opened, so no selector could be qualified. The trial has since opened harmless cards in throwaway tasks and probed their UI Automation structure read-only (control types, class tokens, redacted AutomationIds, pattern flags and name lengths; never names or text) on Codex 26.930.3930.0 and Claude 2.19675.0.0:

- Claude: a question card and a permission card each render as one `Group` whose class list contains `epitaxy-approval-card`. The composer stays present and keeps keyboard focus, so composer focus alone cannot block Send.
- Codex: the escalation card has no distinctive token, but it replaces the composer. While it is open, the window has no `ProseMirror` `Edit` and focus is on a card button that Enter would activate. Before and after, there is exactly one composer.

## What Changes

- A read-only helper operation, `approvalVisible`, scoped to the client's own foreground window and process like `composerFocused`. It runs one `FindAll` over the window's control view and counts elements by class token: elements of any control type carrying Claude's approval-card token, or Codex's `Edit` composers.
- The adapter answers Claude as `true` while any card exists and `false` when none does. It answers Codex as `false` only while exactly one composer exists, and unknown when there is none (`codex-composer-absent`) or several (`codex-composer-count`). A client not in front, a helper failure, a malformed reply or a foreground change is unknown.
- The router is unchanged: it refuses Send unless the answer is known `false`, and the Hub approval check stays.
- The OS adapter interface version stays 2, because `approvalVisible` already exists with the same signature.
- Document the structure in `UIA-NOTES.md`, the bridge README and the qualification report, and extend the native Windows check.

## Capabilities

### Modified Capabilities

- `chompi-bridge`: approval visibility from class tokens in the client's window replaces the unconditional unknown.
- `chompi-task-routing`: the unknown-approval scenario names the Windows adapter's remaining unknown cases instead of an unqualified selector.

## Impact

Bridge package only. Send can now pass in real use when no card is open and the Hub shows no approval. A visible Claude question card blocks Send, because it shares the permission card's token. Installation means reinstalling the bridge on Windows; the live guard checks are part of the #743 trial.
