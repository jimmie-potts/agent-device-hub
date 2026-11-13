## Why

A standby core needs current settings from the lead without waiting on it at startup or running device work. [Issue #1806](https://github.com/jimmie-potts/agent-device-hub/issues/1806) owns the source follower.

## What changes

- Follow committed settings at startup, after reconnect, and on eligible SDK signals or overflow.
- Validate the private peer and resume from the receiver's last durable checkpoint.
- Exercise the complete follower through an injected receiver. Shipped standby reports follower unavailability until its durable receiver is integrated.

## Capabilities

- `bunny-runtime` gains the opt-in standby settings follower.
- `bunny-sdk` gains a caller-owned lifetime for remote subscriptions.

## Impact

The runtime composition, standby core and outgoing SDK reader change. The existing settings history and inbound admission remain in use.
