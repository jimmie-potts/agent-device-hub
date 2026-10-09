---
name: Epic
about: Define a bounded outcome and its required and optional delivery work.
labels: ["epic", "enhancement", "status:backlog"]
---

## [Describe what this work will deliver]

- [One concrete behavior or outcome.]
- [A second useful detail.]
- [A third useful detail.]
- [A fourth useful detail.]
- [A fifth useful detail or practical limit.]

<!--
Define a finishable outcome for one operator, the selected Hub installation and its configured devices.
Complete outcome, release scope, required/optional work and epic acceptance.
State exclusions, unresolved decisions and reassessment triggers. Do not choose
Phase or Commitment merely by filing an epic. See docs/issue-conventions.md.
Replace the opening headline and five bullets; keep unknowns explicit.
-->

## Outcome and real setup

<!-- Required: the benefit, selected setup and who will observe it. -->

## Smallest useful implementation

<!-- Required: smallest useful release, exclusions and unresolved decisions. -->

### Required children

<!-- List existing issue URLs and each child's contribution, or state which decomposition decision remains. After filing, add native sub-issues; this list alone creates no relationship. -->

### Optional children and related work

<!-- List extensions separately. Shared prerequisites keep one parent; link other consumers. Optional work cannot hold the required release open. -->

## Behavior and protections to preserve

<!-- Fill when relevant; preserve existing ownership, permissions, user data and controller behavior.
Boundaries and outcomes, for work that crosses a component boundary (see docs/sdlc.md "Scope defaults"):
name its entry points and hand-offs; its refusals and its succeeded, failed and uncertain outcomes (with expired where a command can wait), with the effects each may leave;
its codes and retry policy; its diagnostic records and trace continuity; and its fault cases.
Link the rules in docs/decisions/0012-bunny-event-platform.md and docs/observability-contract.md; do not copy them.
Answer here, with a ### subheading at most. -->

## Observable acceptance and planned evidence

<!-- Required: the epic's own end-to-end scenario and evidence, beyond closed children. Distinguish source, installed/client, human and physical acceptance. A required child closed as not planned does not satisfy its obligation without an explicit scope decision. -->

Delivery target: [source / installed / physical; specify the intended evidence]

## Meaningful deferrals

<!-- Required: exclusions or None; unresolved decisions or None; the event that triggers reassessment. Record approved Phase on the Project, or leave unassigned. -->
