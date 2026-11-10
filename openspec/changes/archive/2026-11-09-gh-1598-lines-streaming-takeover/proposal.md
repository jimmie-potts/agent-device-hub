## Why

The installed #725 retry on 2026-11-10 ([#1598](https://github.com/jimmie-potts/agent-device-hub/issues/1598)) showed that a scene picked in the Nanoleaf app during a live Lines Music session does not take over. In both rounds the pick never appeared and the session never ended `manual`. In round 1, Stop then restored the base scene over the owner's choice.

A live session writes one static display per frame over HTTP, about ten a second, and reads `/effects/select` before each write. If the light applies an app pick after answering that read, the next frame overwrites it, and the light reports the session's `*Static*` again. No poll can then see that the pick happened. A fake light that serves requests in arrival order reproduces this every time, and the #1272 design recorded only a narrow form of it as a known limit. The session also sends about 20 HTTP requests a second, each on a new connection; round 2 lost a frame answer under that load, and the app's pick appeared only after the session stopped.

The owner chose Nanoleaf's external-control streaming for live frames on 2026-11-10.

## What Changes

- **Streaming frames.** A live Lines session enters the light's external-control mode (`extControl`, version 2) with one journaled HTTP write. Its frames then go as UDP datagrams to the light's streaming port. They no longer go as HTTP display writes, and no per-frame HTTP read precedes them.
- **Takeover.** A scene picked in the app leaves streaming mode, so later datagrams can no longer paint over it. The once-per-second external check (`/effects` select, plus `/state` brightness and power) finds the light no longer on `*ExtControl*` and ends the session `manual` with no restoration.
- **Request rate.** Device HTTP traffic during a playing session drops from about 20 requests a second to the external check: one or two reads a second.
- **Transport.** The module gains a datagram transport beside its HTTP transport. Device links send each datagram to the device's configured address. The simulated controller models streaming mode, so runtime scenarios and fakes exercise it.
- **Unchanged:** admission, pacing (at most one frame per 100 ms, latest value, no catch-up), Stop, alert, source loss, restart, restoration guards and the core's session contract.

## Capabilities

### Modified Capabilities
- `nanoleaf-module`: how a live Lines session writes frames and how it detects a manual change.

## Impact

- `modules/nanoleaf`: the session loop, renderer output, transport, device link, worker wiring, the simulated controller and their tests, plus the README.
- `apps/runtime`: Music lighting tests whose fakes record frames.
- No change to contracts, the core, the dashboard, storage or migration. No installation, capture or device command follows from this change; #725 qualifies it on the installed Lines.
