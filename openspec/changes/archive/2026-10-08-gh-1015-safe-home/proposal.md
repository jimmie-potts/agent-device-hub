## Why

[Hub #1015](https://github.com/jimmie-potts/agent-device-hub/issues/1015) removes a process-environment read from disposable verification. Epic #827 prohibits that read, so the supervisor must obtain the same child-observed HOME evidence through its existing private IPC channel before delivery verification can resume.

## What Changes

- The preloaded guard reports only its directly forked main thread's HOME, bounded and validated, through IPC.
- The supervisor binds that observation to its current child and generation, clears it at each spawn, and keeps missing, malformed or outside-run evidence failing the existing private-state check.
- A source regression check rejects process-environment-file reads without performing one; protocol and repaired-run tests cover startup, invalid evidence and restart.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime`: disposable verification observes its child's private home without inspecting process-environment files or serializing environments.

## Impact

Only `apps/runtime/verify` and its guide/specification change. No product wire contract, installed runtime, device, credentials or personal state changes. ADR 0011's private evidence boundary and ADR 0012's diagnostic rules remain. Source-only delivery; Standards, Specification and Acceptance review the candidate.
