## 1. Contracts

- [x] 1.1 Add the reply speak shape to the speech output family and the `speak` action with `messageId` to the assistant control family, in schema and types; verify with contract tests that a reply within its deadline is admitted and a blank, oversized, mixed or extra-field payload is refused.

## 2. Coordinator, policy and engine

- [x] 2.1 Make the coordinator's candidate a card-or-reply source with `offerReply`, reply rank equal to coding attention and the shared deadline; verify with coordinator tests that a reply speaks once per key, a newer pending reply replaces an older one, a reply preempts a notice after confirmed stop and waits for active attention, and expired or ineligible replies are refused.
- [x] 2.2 Add `replyRefusal` to the presentation policy and wire the module's eligibility and `speak` seam; verify by the module tests running through `createCompanionsModule`.
- [x] 2.3 Offer the result, question, refusal and over-bound context message after they are durable, add the `speak` control and the saved-message lookup, and expose message ids on the conversation page; verify with engine tests that each offer carries the saved text and key, startup reconciliation offers nothing, Speak replays once per request and refuses owner text, unknown messages and mixed controls, a result over the bound is not offered, and a throwing offer never fails the task.

## 3. Browser

- [x] 3.1 Make the browser speech session speak a reply's text under the reply policy and deadline, add reply wording and a shared live Reachy copy hook to the speech controls, and mount the controls and Speak buttons on the Conversation page; verify with the session test and the new spoken-replies browser journey (question, result and replay spoken, Stop without cancelling, Quiet silence, mute, keyboard and axe).

## 4. Specifications and guides

- [x] 4.1 Update the companions README (browser speech and conversation sections); verify by instruction readback against the implemented behavior.
- [x] 4.2 Run root build, lint, the companions suite, contract tests and the companions browser suite on Linux, then synchronize the two delta specs into the main specs and archive this change on the delivery branch before final review; verify each command exits zero and `openspec validate` passes before archive.
