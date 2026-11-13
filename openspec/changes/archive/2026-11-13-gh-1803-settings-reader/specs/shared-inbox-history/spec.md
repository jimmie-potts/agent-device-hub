## ADDED Requirements

### Requirement: Committed core settings read

The authenticated history HTTP route SHALL offer additive snapshot and page
modes using `history/2.0`. Both SHALL use the existing read scope and privacy
checks and SHALL perform no state write, publication or device work.

#### Scenario: Current owner settings and checkpoint agree

- **WHEN** an ordinary read caller requests `settings=snapshot`
- **THEN** the result includes the serving origin, a committed checkpoint and
  current mode and overrides, Home, Lighting and Playback layouts, power
  limits, art policy, Automation rules, routines, settings and interrupt kinds
- **AND** preexisting definitions and defaults are included even without a
  history row, and operational fields are excluded

#### Scenario: Catch up through a fixed head

- **WHEN** a caller requests `settings=page` from a checkpoint
- **THEN** the result scans at most 63 raw local rows through a fixed head,
  returns the highest scanned checkpoint and indicates completion
- **AND** it returns only allowlisted changes and removals in origin order and
  reports the highest safe boundary for applying complete source revisions
- **AND** rolled-back changes are invisible and unrelated rows can advance the
  scan cursor

#### Scenario: Refuse a stale or protected read

- **WHEN** a checkpoint names a changed origin, or its anchor is missing,
  changed or separated by a legacy barrier
- **THEN** the route refuses with `invalid-state` for a changed origin or
  `revision-conflict` for a same-origin discontinuity
- **AND** malformed input and unauthorized callers receive existing refusals
  and a selected protected value prevents the entire answer from being served
