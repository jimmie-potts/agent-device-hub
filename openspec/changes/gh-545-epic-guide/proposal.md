## Why

The owner selected a browser-first rebuild of the work Guide around explicit
epics, with the portfolio Project's Phase and Commitment alongside issue facts
and a later local Ask the Guide on the same components. The approved
`guide-records/1.0` assumes topic sub-guides and a Guide metadata section, so
the browser, the Project views and Ask need a new records version and one
reusable component catalog.
[Hub #545](https://github.com/jimmie-potts/agent-device-hub/issues/545) owns
this definition.

## What Changes

- Define `guide-records/2.0`: explicit `epic` label, native parent membership,
  nearest-epic placement with deep, cross-repository, standalone and unresolved
  cases, Project Phase and Commitment with inheritance, conflict and unknown
  states, a seven-day Recently done window anchored at the dataset's as-of time
  with its own completeness receipt, and a ready gate matched to the new intake
  forms.
- Define `guide-views/1.0`: one issue card for any issue kind, an epic
  component that takes epic data and child references and composes those cards
  or rows, plus sections, dependency lists, boards and task briefs; coverage
  rules that keep ordinary pages complete; typed reasons and evidence; bounds,
  routes and stable rejection codes.
- Supply offline references, a synthetic dataset, a deterministic ordinary
  epic page, a composed example over the same records and positive and negative
  fixtures, and run them in existing CI.
- Keep the approved `guide-records/1.0` bytes unchanged.

## Capabilities

### New Capabilities

- `epic-guide`: Epic-based Guide records and the reusable component catalog shared by the browser and later Ask views.

### Modified Capabilities

None. `guide-records` 1.0 stays as approved for its current consumers.

## Impact

Definition artifacts and tests under `docs/work-guide/contracts/epic-guide/`,
plus the CI step and maintenance guidance. No collector, browser, deployment,
Project change, label creation, issue edit, Jev endpoint or model call. Human
approval of the exact definition precedes adoption; consumers stay blocked until
acceptance.
