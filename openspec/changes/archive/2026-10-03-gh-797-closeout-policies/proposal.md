## Why

[Hub #797](https://github.com/jimmie-potts/agent-device-hub/issues/797) completes
the existing shared supervisor's closeout path for its five selected repositories.
The current adapter fixes both the repository and runtime receipt to Hub, so it
cannot truthfully close consumer or tool deliveries using their owning proof.

## What Changes

- Select one of five reviewed repository policies from trusted configuration,
  retaining the existing closeout CLI, acceptance assessment and effect journal.
- Validate Hub, Nanoleaf and Pixoo with their existing semantic
  `install-receipt/1.0` proof and runtime identity. Validate dotfiles and
  agent-skills with their owning `installed-files/1.0` plans and readbacks.
- Bind the owning acceptance instructions, label cleanup and existing Project
  projection to each policy. Tool repositories gain no Hub labels or Project
  membership.
- Extend existing closeout and extracted-package fixtures for wrong-proof
  refusal, tool readback, unchanged acceptance guards and reconciliation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `maintenance-intake`: owning closeout policies and truthful proof selection
  for the five repositories, preserving the existing delivery gates.

## Impact

Changes stay in `apps/maintenance`, its package tests, development guide and
OpenSpec. The shared runtime receipt remains unchanged. Reuse the installed-files
protocol owned by [dotfiles #9](https://github.com/jimmie-potts/dotfiles/issues/9)
and [agent-skills #140](https://github.com/jimmie-potts/agent-skills/issues/140);
neither installer is implemented here. The delivery target is the merged and
installed closeout package. The coordinator owns that installation; source tests
do not establish scheduling or the real delivery retained by
[Hub #734](https://github.com/jimmie-potts/agent-device-hub/issues/734).
