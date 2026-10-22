# Hub control cards

## Purpose

Provide concise reusable Hub mode and shared Inbox cards while preserving explicit control, truthful evidence and manual handling.

## Requirements

### Requirement: Concise mode controls

The dashboard SHALL show the synced saved mode and matching artwork with Work, Free and Quiet buttons. Clicking the selected mode SHALL submit an explicit new revision-guarded request. The face SHALL omit Saved choice, device lists, routine bottom status, Latest request and a separate Reapply button. Requested or accepted evidence SHALL NOT select a mode. Stale, unavailable and read-only evidence SHALL remain apparent and prevent unauthorized changes. Routine feedback SHALL remain available to assistive technology.

#### Scenario: Explicit selection and reapplication
- **WHEN** the operator clicks Work twice after each request settles
- **THEN** two distinct guarded attempts occur and the artwork follows the synced choice, with no replay from disclosure, reload or reconnect

### Requirement: Correlated mode issue indicator

A related unhandled mode request or device-result issue SHALL show a corner exclamation and Check Inbox control without highlighting the Hub card surface. The control SHALL open and focus a related entry without handling it. Handling the related entry SHALL clear the indicator after synced removal; unrelated handling SHALL NOT. A later successful mode request SHALL clear a prior issue only with definitive success for its affected target, not on click, saved choice or acceptance. Missing, stale, pending, failed, uncertain or conflicting evidence SHALL NOT prove resolution. Historical Inbox entries SHALL remain until handled. A refusal without an Inbox item SHALL be identified honestly without claiming an item exists. When recent parent/child projections have retired, a retained device-mode issue SHALL remain reviewable with its association explicitly unavailable, including on a fresh mount. Current evidence of an independent native request SHALL exclude it; absent evidence SHALL NOT prove independence or resolution. In this unavailable-association case, later success SHALL require a definitive matching core child for that target from a mode request sent after the item was created; the UI SHALL NOT claim that an unavailable historical link is proven.

#### Scenario: Handling and independent results
- **WHEN** one device mode request fails while another succeeds
- **THEN** the saved mode remains, Check Inbox opens the related failure, and dismissing an unrelated command does not clear the indicator

#### Scenario: Reapply succeeds after pending evidence
- **WHEN** a later mode reapplication is accepted, then its affected device result succeeds
- **THEN** the indicator remains during acceptance and clears after definitive success while the older Inbox entry remains available

#### Scenario: Retired projections and a fresh mount
- **WHEN** a retained device-mode issue outlives its recent parent and child operation projections and the operator reloads Home
- **THEN** Check Inbox remains, identifies the unavailable link honestly and opens the retained item without a command; a later accepted request or earlier success does not clear it

#### Scenario: Stale copies and late conflict
- **WHEN** operations or Inbox evidence becomes stale or a later result conflicts
- **THEN** stale evidence does not clear a retained warning and a current related conflict requires review without automatic retry

### Requirement: Shared expandable Inbox cards

Reusable Inbox entries SHALL show device, action and result concisely, with evidence, conflicting outcomes, request identity, display dismissals and handling actions on expansion. Expanding or navigating SHALL send no command. Dismiss SHALL only handle the shared item; Send again SHALL explicitly create a new tracked command through the existing owner. An accepted reply SHALL wait for synced removal. Duplicate clicks and uncertain replies SHALL NOT cause automatic repeat handling. Read-only sessions SHALL have no write controls, stale copies SHALL disable actions, and device holds SHALL remain separate.

#### Scenario: Passive review and handling
- **WHEN** the operator expands an uncertain entry, then dismisses it
- **THEN** expansion sends nothing and one guarded handling request removes it from shared views without a device command

#### Scenario: Lost resend reply
- **WHEN** an explicit Send again reply is lost
- **THEN** the UI retains uncertainty and does not resend on update or reconnect

### Requirement: Accessible shared presentation

The cards SHALL reuse the shell-owned state and command adapters without new subscriptions or writers. Keyboard, desktop and phone light/dark presentation SHALL preserve readable text, stable target focus and nonoverlapping controls. The same presentation SHALL be independently composable from passed state and callbacks.

#### Scenario: Phone inspection
- **WHEN** a read-only operator inspects the cards at phone width in either theme
- **THEN** evidence remains accessible, controls fit and inspection sends no command
