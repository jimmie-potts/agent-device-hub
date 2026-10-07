---
name: Work item
about: Define a verifiable feature, investigation or maintenance increment.
labels: ["enhancement", "status:backlog"]
---

## [Describe what this work will deliver]

- [One concrete behavior or outcome.]
- [A second useful detail.]
- [A third useful detail.]
- [A fourth useful detail.]
- [A fifth useful detail or practical limit.]

<!--
Use this template for features, maintenance and investigations. Start with one operator, the selected Hub installation and its configured devices.
Outcome and observable acceptance are required. Keep the recognized headings;
fill implementation, protections and deferrals only when relevant. A short work
item needs no model choice or Execution recommendation. See docs/issue-conventions.md.
Replace the opening headline and exactly five bullets with distinct, plain
sentences. Investigations promise findings, not a working feature. This opening
applies only to new stories; do not retrofit existing issues.
Keep this Guide section while the legacy generator runs. Select a topic from
shared-codex, bunny-controls, nanoleaf-presentation, nanoleaf-devices, pixoo-media,
controls-music, desktop-controls, work-guide, assistant-access, hosting-migrations,
development-workflow or steam-deck. Optional lines: **Note:** a short reading note;
**Highlight:** next step | decision | later | idea, <reason>;
**Extends:** H67, N47 (only alongside an idea highlight). These links do not create
native parents or blockers. Preserve existing Guide metadata during migration.
-->

## Outcome and real setup

<!-- Required: the observed benefit, actual setup and exclusions. -->

## Smallest useful implementation

<!-- If needed: reuse existing components; link actual prerequisites separately from related work. -->

## Behavior and protections to preserve

<!-- If affected: preserve one state owner, one writer per device, manual control and private data.
Boundaries and outcomes, for work that crosses a component boundary (see docs/sdlc.md "Scope defaults"):
name its entry points and hand-offs; its refusals and its succeeded, failed and uncertain outcomes (with expired where a command can wait), with the effects each may leave;
its codes and retry policy; its diagnostic records and trace continuity; and its fault cases.
Link the rules in docs/decisions/0012-bunny-event-platform.md and docs/observability-contract.md; do not copy them.
Answer here, with a ### subheading at most. -->

## Observable acceptance and planned evidence

<!-- Required: the observable result and its check or observation. Name the delivery target. Source tests do not prove installation or physical behavior. -->

Delivery target: source-only

## Meaningful deferrals

<!-- If needed: name the omitted capability, consequence or manual alternative, and owner or revisit trigger. -->

## Guide

**Topic:** <topic id>
