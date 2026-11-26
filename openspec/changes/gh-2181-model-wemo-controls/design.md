## Context

The owner selected one sharing policy for both Conversation supervisors. The engine already knows the current authenticated owner message, permitted context and configured Wemo owner records. The core already tracks generic power requests and resolves their effects through the designated Wemo writer.

## Decisions

Use the existing `set_wemo_power` allowlist entry. Its closed tool parameters select either one or two references or the explicit Wemo group, plus a Boolean setting. The Hub attaches the saved owner request and any current clarification to the model response. That identity comes from the private turn record.

The Hub resolves the whole selection before any dispatch. An exact ID resolves an identity independently of labels. Duplicate labels require an explicit ID from the owner or an answer to the active clarification. Prior owner context can supply a reference. The Hub checks ownership, grants, capability, revision, generation and hold through the existing dispatch path. The core retains maximum-on policy.

Save one operation identity and dispatch state per target before sending. A restart reconciles saved requests from the core tracker and correlated readback. It never issues another command for a saved operation. A lost reply for one plug leaves an independent receipt for the other plug.

## Risks

The selected supervisor can misinterpret language. The tool instructions identify questions, quoted examples, hypothetical actions, negation, corrections and device labels as distinct from the current request for action. The Hub makes reference and authority checks independently. Scripted transport tests establish the tool boundaries. The separate bounded hosted evaluation exercises model interpretation.

A change of grants, configured identity or guard between interpretation and dispatch can stale a proposal. Recheck against current records before sending. If a steer arrives between per-target sends, retain earlier receipts and stop the remaining sends from the superseded request.
