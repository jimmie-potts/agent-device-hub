## MODIFIED Requirements

### Requirement: Fixed bounded read-only collection

When explicitly enabled, the ONN owner SHALL collect only the approved YouTube/Stremio metadata projection through the selected fixed reader, without an open dashboard or conversation. It SHALL validate the closed versioned wire, field/session/reply bounds, finite source numbers and release-pinned device artifact. The fixed invocation SHALL supply the reader's required result pipe over raw ADB and preserve reader failure exit status while suppressing startup output. The reader SHALL support the qualified standalone process by initializing only missing process-local media lookup state and preserving existing initialization; failure SHALL retain the same bounded unavailable result. A poll SHALL share the existing private ADB operation-wide cancellation and five-second bound, serialize with controls, prioritize controls and never install, repair, retry, discover or command a device. Unsupported or unavailable reads SHALL expose a gap without blocking controls. Disabling collection SHALL retain earlier history.

#### Scenario: Selected source and refusal

- **WHEN** collection receives a valid selected session, an empty session list or an invalid/oversized reply
- **THEN** it accepts the supported projection, clears current content on empty success or records unavailable evidence, respectively, without a device input action
- **WHEN** the reader artifact is absent/mismatched or a control takes priority
- **THEN** the poll is unavailable or skipped as a gap and ordinary controls remain independent

#### Scenario: Raw ADB result channel

- **WHEN** raw ADB provides socket-backed stdout to the fixed invocation
- **THEN** the reader receives its required pipe and the caller receives only the closed metadata result
- **WHEN** the reader fails
- **THEN** successful forwarding does not replace that failure with a successful shell exit

#### Scenario: Standalone media lookup

- **WHEN** the fixed reader process has no initialized media service manager
- **THEN** the selected session read succeeds after process-local initialization without changing Android settings, permissions or persistent services
- **WHEN** media lookup is already initialized or initialization fails
- **THEN** the reader preserves the existing manager or returns only the fixed unavailable result within its deadline, respectively

