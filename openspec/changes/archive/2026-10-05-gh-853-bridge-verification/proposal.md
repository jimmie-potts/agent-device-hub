## Why

Since PR #849, every PR with observable behavior needs an independent Acceptance review: the reviewer runs the exact head in a disposable verification run with simulated devices and uses it as a person would (docs/sdlc.md, "Acceptance review"). The CHOMPI bridge had no such run, so bridge PRs could not merge (PR #847 and PR #852 were held). [#853](https://github.com/jimmie-potts/agent-device-hub/issues/853) adds one, on the WSL host, with no real controller, Windows desktop, installed bridge or installed Hub.

## What Changes

- A simulated desktop implements OS adapter interface version 3 over an in-memory Codex, Claude and other-app desktop. `chompi-bridge run --desktop sim` selects it; the bridge never imports it otherwise.
- A synthetic Hub feed serves the released sessions snapshot (1.3 and 1.2) and change stream with a run-generated token, in memory or over loopback HTTP. No new message format.
- A scenario catalog, written as data plus small step functions, runs in memory in CI (Tier 1) and in disposable runs (Tier 2): Send in the window in front and refused elsewhere, Record, a Claude question card answered with the wheel, a Codex card answered by structure, reconnect with no replay, and a profile reload.
- An app-verify plug-in (`npm run -s verify:chompi -- <operation>`) serves the bridge, the synthetic feed and a control page on one loopback port, with boundary checks for HID, Win32 and UI Automation, and installed-service contact. `@jimmie-potts/app-verify` is unchanged.
- The control page shows and drives the simulated controller, desktop and Hub, and passes keyboard and axe checks.

## Capabilities

### New Capabilities

- `chompi-bridge-verification`: disposable verification runs and the shared scenario catalog for the CHOMPI bridge.

### Modified Capabilities

- `chompi-bridge`: the flag-gated simulated desktop adapter.

## Impact

- Source only; a run is evaluation infrastructure, not an installation. The installed Windows bridge is unchanged, and the CLI without `--desktop sim` loads none of the simulation modules.
- The router tests' snapshot builders now come from the synthetic feed module.
- CI: the contracts job runs the Tier 1 catalog, and the App verification job runs the bridge's boundary tests, capture steps and page browser check. Normal CI keeps its eight jobs.
- Windows client fidelity (UI Automation trees, focus timing, Wispr, file hashes) stays with the native check and the owner's installed checks.
