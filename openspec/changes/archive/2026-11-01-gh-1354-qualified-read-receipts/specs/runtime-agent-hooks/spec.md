## ADDED Requirements

### Requirement: Claude terminal offers an explicit bound read action

The qualified Claude terminal extension SHALL offer an explicit action for a successful completed root result. It SHALL correlate the native extension turn with the classic lifecycle prompt ID, preserve the native session identity, and discard an incomplete or inconsistent mapping. It SHALL freeze the selected target when the pane opens and retain it if another result completes. Opening, rendering, completion and headless execution SHALL emit no positive receipt.

The extension SHALL use a bounded host helper with the selected private producer file. The helper SHALL use existing SDK sync and publication, with no state polling, automatic retry or device wait. It SHALL bind only the matching finished lifecycle turn and publish only allowlisted lifecycle/2.1 metadata. It SHALL distinguish confirmed state from a sent but unconfirmed observation. Unsupported native versions or UI kinds SHALL remain unavailable.

#### Scenario: Native prompt and turn IDs differ
- **WHEN** the extension observes a root prompt, its native turn start, its matching classic Stop and successful turn completion
- **THEN** its action identifies the lifecycle prompt that the existing hook sent, even when the extension turn ID differs

#### Scenario: Old pane after a new result
- **WHEN** result B completes while the pane for A remains open and the user clicks A
- **THEN** the action retains A's mapped identity and frozen owner target

#### Scenario: No action or incomplete mapping
- **WHEN** a pane renders without a click, the client is headless, the turn is a child, interrupted or failed, the prompt mapping is missing, or the session is cleared
- **THEN** no positive read observation is published

#### Scenario: Unavailable helper
- **WHEN** configuration is unsafe, the endpoint refuses access, the owner has no matching finished record, or the helper reaches its deadline
- **THEN** agent behavior and permission decisions are preserved, no retry starts, and no successful read is claimed

#### Scenario: Private fields
- **WHEN** native hook inputs contain prompt, response, transcript path, tool content or credentials
- **THEN** none of those fields enters the helper input, lifecycle message, session provenance or diagnostic output
