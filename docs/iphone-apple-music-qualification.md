# iPhone Apple Music through the Sony HT-A9

Qualification for [Hub #158](https://github.com/jimmie-potts/agent-device-hub/issues/158), observed September 23, 2026. This records a live AirPlay stream from the owner's iPhone to the owner's Sony HT-A9. It selects a source for later implementation; it does not deliver the hub integration from [#36](https://github.com/jimmie-potts/agent-device-hub/issues/36).

## Live check

The owner supplied the exact model and LAN target, started Apple Music over AirPlay, made a timed track change, authorized transport calls, and confirmed their effects on the phone. The target address and track metadata are omitted. No software was installed, no settings were changed, and no other speaker was contacted.

| Check | Observation |
| --- | --- |
| Network and standby | Unicast HTTP and WebSocket connections from WSL reached the HT-A9. `system.getPowerSettings` reported `quickStartMode=on`. Discovery was unnecessary. |
| API | `avContent.getMethodTypes` exposed `getPlayingContentInfo` v1.2, `pausePlayingContent` v1.1, and next/previous v1.0. `guide.getSupportedApiInfo` exposed `notifyPlayingContentInfo` v1.0 over WebSocket. |
| AirPlay metadata | `getPlayingContentInfo` identified `source=extInput:airPlay` and `stateInfo.state=PLAYING`. Title, artist, and album name were populated. `applicationName` was present, but its value did not establish an Apple Music app identity. Position and duration were absent. |
| Artwork | `content.thumbnailUrl` was present on the checked playing snapshots and served JPEG bytes from the soundbar, although its HTTP `Content-Type` was `text/plain`. One immediate sample after a natural track transition lacked the `content` field; a later snapshot of a different track had artwork. Artwork is therefore optional. Its timing relative to metadata on a single track remains unmeasured. The URL must stay out of shared payloads because it embeds the private receiver address. |
| Change feed | An enabled WebSocket subscription delivered `notifyPlayingContentInfo` during track changes. The timed phone action was reported as close to 01:40:30 Eastern. The first push arrived at 01:40:30.822 and the 400 ms polling loop saw changed metadata at 01:40:32.426. The approximate observed delays are 0.8 seconds for push and 2.4 seconds for polling. The phone time was reported to the nearest second, so these are estimates, not latency guarantees. Multiple notifications arrived for a single change. |
| Pause | `pausePlayingContent` returned an empty success result. Within 0.5 seconds the API reported `PAUSED` on the same track. The owner confirmed Apple Music on the iPhone paused, then resumed it from the phone. |
| Next | `setPlayNextContent` returned an empty success result. The API showed a different track within 0.5 seconds. The owner confirmed the iPhone advanced. |
| Previous | `setPlayPreviousContent` returned an empty success result. The API kept the same track identity; the owner confirmed that the iPhone restarted the current song. This confirms command reach but does not prove a second Previous would select the prior song. |

The first timing attempt was inconclusive: a content change appeared three seconds before the owner's reported tap time. A later untimed transition at 01:39:57 showed that tracks could advance without a phone tap. The timed 01:40:30 trial above is the latency evidence.

These observations qualify this HT-A9 and its current AirPlay path. They do not establish behavior for other Sony models, other inputs, network outages, or an installed hub adapter. A Sony method's advertised availability alone would not have proved iPhone control; the phone confirmations above supply that evidence. Sony's [HT-A9 AirPlay help guide](https://helpguide.sony.net/ht/a9/v1/en/contents/TP1000029246.html) describes the phone-to-speaker path, while the local API readbacks establish this model's metadata and control behavior.

## Recommendation and playback contract

Use the HT-A9 Audio Control API as the second playback source after #36 defines the hub service. The Sony check supplied title, artist, album, artwork, push changes, pause, next, and previous. Do not run a Sonos or fallback spike for this decision: the issue makes those conditional on missing Sony fields or control, and those capabilities were observed on the primary target. The source will lack position and duration unless a later live check finds them.

Extend the #36 snapshot model to retain a separate snapshot per source, each with a stable source id, observed-at time, age, availability, playback state, track identity, metadata, supported controls, and optional bounded artwork. The new id should be based on a user-configured neutral receiver id, such as `iphone-airplay-sony:<receiver-id>`; never use the receiver address or a track title as identity. Keep the Windows source id assigned by #36. Mark each source stale or unavailable independently, without turning a missing observation into `PAUSED`.

Use an explicit selected-source setting for the single active presentation and command route. Initialize it to the Windows source when the second source is added, preserving #36's existing behavior. If both sources play, retain the user's selection; do not choose by newest event or silently switch. If the selected source becomes unavailable, show that state and leave the other source separately visible until the user selects it. Route controls only to the selected source when that source reports the control available; a timeout remains uncertain and is not retried automatically. A source change should not be inferred from AirPlay artwork or transient duplicate notifications.

The receiver adapter should poll for an initial snapshot and recovery, then use the WebSocket notification as a change signal and fetch a fresh `getPlayingContentInfo` snapshot. Coalesce duplicate notifications. Its artwork fetch should accept only the configured receiver's local endpoint, bound the response, verify the bytes, and pass artwork through #36's bounded artwork policy rather than exposing the local URL. Treat absent position, duration, or artwork as absent data. Keep the adapter beside the active hub owner; the WSL trial proves unicast and an outbound WebSocket on this network, but not reliable discovery or callback routing across NAT.

[Home Assistant's Sony Songpal integration](https://www.home-assistant.io/integrations/songpal) provides local push and general media actions, so it could reuse the same device API. For this single source, direct integration is the smaller runtime and ownership path: it avoids adding Home Assistant, its entity bridge, and a second source of freshness/command state solely for playback. Reconsider Home Assistant under [#11](https://github.com/jimmie-potts/agent-device-hub/issues/11) if broader device integrations justify that runtime. No Home Assistant installation or comparative live trial was performed.

## Next delivery boundary

[Issue #175](https://github.com/jimmie-potts/agent-device-hub/issues/175) owns the Sony adapter and hub multi-source behavior. It depends on #36's published playback contract and this qualification. Its fake Sony source must cover populated and missing metadata, delayed artwork, duplicate notifications, stale/unavailable transitions, simultaneous Windows and iPhone playback, explicit selection, supported and unsupported controls, and uncertain command results. Local fake tests will not replace a separately authorized installed-client check.
