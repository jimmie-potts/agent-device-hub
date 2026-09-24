## Why

[Hub #175](https://github.com/jimmie-potts/agent-device-hub/issues/175) gives BUNNY its first music source. The owner's iPhone plays Apple Music to a Sony HT-A9 over AirPlay. The HT-A9 qualification from #158 (`docs/iphone-apple-music-qualification.md`) showed that a Linux process can read the receiver's now-playing metadata and send pause, next and previous. The hub has no playback service yet, and the earlier plan waited for a Windows connector (#36) that is now deferred. #228's shared playback service is consolidated into #175 as a separate module.

## What Changes

- Add a shared playback module to the standalone hub. It owns the normalized snapshot, observation freshness, command validation, results and duplicate suppression. It accepts observations and delegates commands through a small typed source interface and never imports a source protocol.
- Add a separate Sony HT-A9 source module. It owns the configured receiver endpoint, polling of `getPlayingContentInfo`, Sony field normalization and the qualified pause, next and previous calls.
- Add optional private `playback` configuration with one explicitly selected source, and authenticated `GET /api/playback/v1/snapshot` and `POST /api/playback/v1/commands` routes.
- Correct the Windows-first playback wording in ADR 0004, the architecture guide and the qualification record's delivery note. Historical observations are unchanged.

## Capabilities

### New Capabilities

- `hub-playback`: shared playback snapshot, freshness and source-bound commands in the standalone hub, with the Sony HT-A9 as the first source.

### Modified Capabilities

None.

## Impact

Standalone hub source, package version, tests, owning guides and ADR 0004. No shared package, controller contract or CI workflow changes; the existing hub test glob runs the new suite. The receiver address stays in private configuration. Track metadata is returned only to authenticated local clients and is not exported with agent state. Source delivery installs nothing, starts no service and contacts no receiver. UI and MCP (#37), display cards (#38), song-change lighting (#39), artwork (#229) and Docker hosting (#42) remain separate.
