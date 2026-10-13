## Why

The owner hibernated [BB-8 #602](https://github.com/jimmie-potts/agent-device-hub/issues/602) indefinitely after the battery blocker. BB-8 development, physical tests and unit/browser/CI execution must stop while prior source, state and evidence remain retained.

## What Changes

- Exclude the dormant module from generated runtime/frontend registration and normal build/typecheck/lint work.
- Remove BB-8 test/package scripts and CI steps; retain dedicated test sources with a non-executable `.hibernated` suffix. Remove BB-8 cases from shared test matrices and scenario/browser fixtures.
- Preserve private state, stored-format inputs, protocol contracts and upgrade refusal rules.
- Disable installed BB-8 configuration and its helper grant under the existing operation lock; leave the Windows helper stopped.
- Reconcile #602/#606 as deferred/backlog with prior completed increments and unaccepted physical criteria retained.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime`: dormant module registration and default verification exclusion.
- `bb8-module`: indefinite hibernation supersedes active-use and verification requirements.
- `bb8-windows-link`: helper remains stopped; retained source/state is not an active CI obligation.

## Impact

Root scripts, CI selection/workflow expectations, runtime registry and test fixtures, owning guides/specs and selected trackers. Retained compatibility readers and schemas remain unchanged. No new framework, backup, hardware operation or BB-8 test execution.
