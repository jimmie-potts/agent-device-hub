## ADDED Requirements

### Requirement: Reusable Soft keys ONN card

The dashboard SHALL use the approved Soft keys card on Home, the ONN component view and the ONN controls page, retaining existing device identity and saved Home placement. The TV/box illustration SHALL stay mounted and visible when keyboard-accessible Remote and Apps tabs change only the controls. Both tabs SHALL retain one stable card geometry in light/dark desktop and phone layouts, with reduced-motion support and no horizontal overflow. Healthy cards SHALL omit repeated connection/desired-state facts and default no-command text; necessary access, freshness and request evidence SHALL remain available without an Activity or Details tab.

#### Scenario: Move between control tabs
- **WHEN** a user switches Remote and Apps by pointer or keyboard
- **THEN** the same illustration remains visible, the card dimensions stay stable, keyboard focus is usable and no device command is sent

#### Scenario: Reuse and hide the card
- **WHEN** the same configured ONN is shown on Home, its component view or its module page, or hidden and re-entered through Home editing
- **THEN** the existing owner, authenticated shell connection and command outcome recovery remain authoritative, and presentation changes send no device command

### Requirement: Quiet controls preserve evidence and authority

The card SHALL dispatch only explicit qualified single-key, app-shortcut and focused-text requests through the existing guarded tracked boundary. Read-only permission, stale or unavailable copies, mismatched selected targets, unsupported controls and locked attempts SHALL prevent dispatch. App labels SHALL use captured current-app evidence and its original fifteen-second freshness boundary, never optimistic app-launch results. Text SHALL remain memory-only and clear on submission. Compact feedback SHALL preserve pending, refused, failed, transmitted, observed and uncertain meanings with full safe evidence accessible. Uncertainty SHALL remain locked through re-entry and reload without replay. Corner attention SHALL preserve the normal card surface and retain access to Inbox where needed.

#### Scenario: Single deliberate action
- **WHEN** a control-capable user activates a qualified key, app or valid text input with current owner evidence
- **THEN** exactly one existing request with the current configuration/generation guards is sent, and acceptance or transmission never claims a changed foreground app or observed TV effect

#### Scenario: Unsafe or unknown action
- **WHEN** the source is stale/unavailable, the target differs, a control is not declared, permission is read-only, input is invalid or a preceding request remains locked
- **THEN** no action is dispatched, the reason/evidence remains inspectable and no timer, reload or reconnect resends the request

### Requirement: History remains an owning read

The card's History link SHALL open the existing retained ONN history UI through a module-local page, preserving its filters, evidence, continuation, privacy and observation-only semantics. History SHALL also remain accessible on the existing controls URL. Opening either view, navigating back and reading stored history SHALL send no device control or metadata poll, and SHALL add no primary shell destination or collection source.

#### Scenario: Open retained history
- **WHEN** a reader follows History from Home or an ONN card and browses existing filters or continuation
- **THEN** the authenticated ONN owner supplies bounded retained observations, existing source-value limitations remain visible and the device effect count does not change
