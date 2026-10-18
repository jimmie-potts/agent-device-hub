## Why

When Sonos takes precedence, both displays lose album art because the accepted release acquired images only from Sony. [Hub #1162](https://github.com/jimmie-potts/agent-device-hub/issues/1162) extends the existing playback owner to the configured Sonos Move.

## What Changes

- Retain Sonos albumArtURI privately and admit absolute or relative HTTP references only on its configured origin.
- Reuse the bounded artwork chain and playback/2.1 contract for either source, retaining source/track fences and text fallback.
- Permit current Sonos thumbnails through passive authenticated content reads and attribute media diagnostics to their actual source.
- Exercise both renderers through simulated Sonos artwork and handoffs; install the reviewed result on the established runtime.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-playback`: Sonos acquisition, source association and current-image content reads for both sources.

## Impact

Changes are in modules/playback and its runtime scenarios, tests and guides. The SDK, playback/2.1 wire shape and Tidbyt/Pixoo renderers remain compatible. No dependency, store format, source priority or display-mode change is needed. Legacy Hub behavior is outside scope. Follow ADRs 0011/0012 and the diagnostic contract; private qualification and installed evidence stay unpublished.
