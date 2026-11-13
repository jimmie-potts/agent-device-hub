## Why

A standby needs the current settings from the serving core and a way to read
later committed edits. History alone omits defaults and some preexisting
definitions. [Refs #1803](https://github.com/jimmie-potts/agent-device-hub/issues/1803)

## What Changes

- Add snapshot and page modes to the authenticated history HTTP read.
- Project core-owned settings with existing family validation and a fixed
  allowlist. Return sealed transaction boundaries for catch-up.
- Anchor local history rows so a restored store cannot silently reuse a
  checkpoint. Require a replacement snapshot when continuity fails.

## Capabilities

### Modified Capabilities

- `bunny-runtime` defines continuity metadata for the local fact log.
- `shared-inbox-history` gains the core settings snapshot and catch-up read.

## Impact

Core owner reads, the history store and the gateway. The follower and receiver
consume the documented contract in later work. This delivery covers source.
