---
name: Bug
about: Describe a reproducible failure, expected behavior and acceptance evidence.
labels: ["bug", "status:backlog"]
---

<!--
Outcome, reproduction and observable acceptance are required. Report sanitized
evidence: no credentials, private media, live task metadata or device identifiers.
A bug may remain standalone. See docs/issue-conventions.md.
-->

## Outcome and real setup

<!-- Required: actual failure, expected behavior, affected setup and versions. -->

## Smallest useful implementation

### Reproduction and diagnostics

<!-- Required: steps, frequency and sanitized evidence, or the evidence needed when reproduction is unknown. Do not guess a cause. -->

### Scope and dependencies

<!-- If known: affected behavior, actual blockers and limits of the requested fix. -->

## Behavior and protections to preserve

<!-- If affected: name existing behavior, ownership and data that must remain intact.
Boundaries and outcomes, for work that crosses a component boundary (see docs/sdlc.md "Scope defaults"):
name its entry points and hand-offs; its refusals and its succeeded, failed and uncertain outcomes (with expired where a command can wait), with the effects each may leave;
its codes and retry policy; its diagnostic records and trace continuity; and its fault cases.
Link the rules in docs/decisions/0012-bunny-event-platform.md and docs/observability-contract.md; do not copy them.
Answer here, with a ### subheading at most. -->

## Observable acceptance and planned evidence

<!-- Required: expected result and a regression check or observation that distinguishes failure from success. Installation/device checks require a named owner and explicit authority. -->

Delivery target: source-only

## Meaningful deferrals

<!-- If needed: known limitations, workaround and follow-up owner or revisit trigger. -->
