## Context

The existing inventory-only inspector refuses ONN configuration and retained
state. Its private admission certificate binds seven durable owners and four
phases; BB-8's independently reviewed change adds a fixed paired profile.
ONN controls, history and outbox already share the runtime's private database
facilities. See proposal.md and #1044 for the selected delivery scope.

Design is required because this changes retained-state admission, privacy and
compatible recovery across the runtime/ONN/SDK boundary.

## Goals / Non-Goals

**Goals:** Extend the current fixed owner sets by one ONN owner; require its
coverage only when configured or retained; preserve all absent and unsafe-input
refusals. Prove latest-state behavior with separate synthetic processes.

**Non-Goals:** A generic provider/profile framework, a new installer, migration,
device fallback, replay, new metadata source or deliberate installed three-leg
trial. This source slice does not activate the device or close #1044.

## Decisions

- Keep the fixed legacy owner set and add the fixed ONN extension. Assemble with
  BB-8's accepted paired extension, allowing only the concrete seven/eight/nine/
  ten-owner sets. Arbitrary owner lists would weaken coverage and add an
  unnecessary framework.
- Inventory ONN configuration and its existing private SQLite/directory shapes
  without opening databases. Reuse stopped-writer backup and private-file checks;
  unknown entries and ONN owner-lease files remain refused.
- Return covered owner names from the existing verified admission binding, and
  require ONN coverage when configured or retained. A legacy certificate cannot
  authorize ONN merely because the current operator recognizes its files.
- Configured ONN must satisfy the ordinary running/healthy/reason-free check.
  Keep absent ONN's exact refused/not-found/unhealthy rule. Collection gaps and
  source position/duration stay evidence, not playback or watched-time claims.
- Use real ONN stores and SDK outbox in separate processes for synthetic four-
  phase checks. Reuse existing restart/outcome tests for no replay; do not add a
  second command queue or broad fault harness.
- Complete inventory already includes module/native source inputs. Any new
  required source anchors must also exist in the actual absent-ONN baseline;
  later history/native files cannot become unconditional prerequisites for it.

## Risks / Trade-offs

- Installed `52ee8f28` cannot parse `historyEnabled` → qualify absent-ONN upgrades
  separately; after activation select a concretely compatible history release
  for recovery. Never remove settings to manufacture compatibility.
- BB-8 integrates concurrently → prepare in our own worktree, assemble against
  its accepted revision, preserve both requirements and renew affected evidence.
- Certificates bind private actual-artifact evidence → synthetic source tests
  qualify behavior, not an installed release. Fresh actual release/admission/
  plan evidence remains mandatory before a routine installed operation.

## Migration Plan

Deliver the reviewed source normally. Prepare and qualify exact release bytes
through UPGRADE.md, verify resource releases and current state, then use standing
authority for the applicable routine upgrade. ONN activation, pinned-reader
deployment and physical controls remain parked for a fresh approved owner-
observed sequence. Compatible recovery follows only an actual failure and keeps
latest private state; no configuration removal or backup restoration is selected.
