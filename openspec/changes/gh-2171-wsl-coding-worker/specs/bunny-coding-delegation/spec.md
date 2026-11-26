## ADDED Requirements

### Requirement: Qualified PC Codex worker

The PC worker SHALL offer Codex through its existing source-bound coding-only
endpoint on the selected WSL2 distro. It SHALL check the pinned CLI,
subscription and runtime boundary before work. The worker SHALL write the
selected checkout only and preserve the existing network and credential
restrictions.

#### Scenario: A WSL2 owner qualifies the PC worker

- **WHEN** the owner runs the signed-out preflight with a private configuration
  and supported local tools
- **THEN** the worker proves the confined checkout write, required Git and
  Node commands, denied outside access and the blocked local listener without
  opening the worker bearer or starting a model turn
- **AND** the installed worker reports its own PC identity and active Codex
  readiness only after local qualification and verified sign-in

#### Scenario: An unsupported Linux sandbox refuses the turn

- **WHEN** the CLI version, kernel, worktree, toolchain or confinement cannot be
  verified
- **THEN** the PC adapter reports unavailability and refuses before submitting a
  model turn

#### Scenario: The owner controls a PC attempt from Jobs

- **WHEN** an owner-authorized PC attempt supports live messages and has no
  qualified native takeover
- **THEN** Jobs offers named steering and stop on that attempt, explains why
  native takeover is unavailable, and leaves unrelated attempts available
- **AND** no native launch command is sent
