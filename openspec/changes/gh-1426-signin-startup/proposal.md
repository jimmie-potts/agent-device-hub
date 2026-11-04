## Why

After every Mac reboot the owner has to start the core, the diagnostics stack and the private route by hand, and a missed start leaves a long gap: the stack was down for about 19 hours on 2026-11-02. The diagnostics stack also runs from one old runtime release folder, so its mounts depend on that release and an `up` from a checkout can move them to a disposable path.

## What Changes

- The core starts once per Mac sign-in through a launchd agent that runs the guarded operator of the release matching its image. It keeps no Docker restart policy.
- The diagnostics stack runs from a fixed folder filled by an install command from one revision, and takes `restart: unless-stopped`.
- Two launchd agents with `KeepAlive` run the private route in place of its manual `screen` sessions.

FileVault and manual sign-in stay. Nothing starts before sign-in.

## Capabilities

### New Capabilities

### Modified Capabilities

- `bunny-container-operator`: the stack's restart policy and home, and a new sign-in start for the core and the route.

## Impact

`scripts/mac-signin.mjs`, `scripts/mac-host-install.mjs`, `deploy/diagnostics/compose.yaml`, the container guide, private access and ADR 0008. Installing it is a separate owner-run step on the Mac, and a real reboot is its acceptance. The operator, its restart-policy refusal and the deployment path do not change.
