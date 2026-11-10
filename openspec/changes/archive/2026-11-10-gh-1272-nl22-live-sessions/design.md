## Context

The live Music session (`modules/nanoleaf/src/music-session.ts`, #1272 design D4, #1598, #1614) runs in each device's locked worker. Its Start is a journaled `music.play` row. The worker's `Execution` makes the Start's one write, which enters external control, and later frames go as UDP datagrams through the device's `DeviceLink`. `checkMusicStart` refuses every device but the Lines, `wall`, with `unsupported-capability`.

The NL22's saved layout already exists (`panels.ts`, #1258): one zone per triangle, the zone ID being the controller's `panelId`, validated as 0 to 65535. The renderer (#1444) already renders all five families on that layout, and the core part already keeps one session record per configured Nanoleaf light. The Audio card already shows one section per record.

The open question was the NL22's external-control protocol (#41 AC3). The repository held no documentation of it: #41 links Nanoleaf's OpenAPI page, and #1598's design rests on third-party notes for the Lines' version 2.

## Protocol qualification (#41 AC3)

Sources relied on, all read on 2026-11-10, with no device contacted:

1. **Nanoleaf, "Nanoleaf Light Panels Open API Documentation"**, Confluence page 2789310530 in space `nlapid`, read through its REST content view: section 3.2.6.2 "External Control (extControl)" and section 5.7 "External Control (Streaming)". This is the primary source, and "documented" below means this page.
2. **OpenRGB's `Controllers/NanoleafController`** (`NanoleafController.cpp` and `.h`, GitLab `CalcProgrammer1/OpenRGB`, master). This is a secondary, community implementation. It selects version 1 for model `NL22` and version 2 for `NL29`, `NL42` and `NL59`. It sends `extControlVersion: "v1"` and opens its socket to the answer's `streamControlIpAddr` and `streamControlPort`. It writes 7 bytes per panel after a 1-byte count. It corroborates the documented layout and settles nothing on its own.
3. **The module's own code**: `stream.ts` (#1598's version 2), `panels.ts` (NL22 panel IDs from the layout read), `devices.ts`, `link.ts` and `transport.ts`. The light transport returns the parsed JSON body of any 2xx answer.

| Point | Lines (NL59) | NL22 Light Panels | Status |
|---|---|---|---|
| Version the module requests | `extControlVersion: "v2"` with `logicalPanelsEnabled: true` | `extControlVersion: "v1"`, no `logicalPanelsEnabled` | Documented. 5.7: "the Light panels support streaming control version v1 and v2", Canvas needs v2 named, and an omitted key means v1. 3.2.6.2: "Light Panels uses stream control v1". `logicalPanelsEnabled` on Lines is #1598's choice, qualified by the first #725 Lines checkpoint. |
| Entry write | `PUT /api/v1/<token>/effects` with `{"write": {"command": "display", "animType": "extControl", "extControlVersion": …}}` | Same, version 1 | Documented (5.7). |
| Entry answer | No body; port 60222 | 2xx with `{"streamControlIpAddr", "streamControlPort", "streamControlProtocol": "udp"}` | Documented. 3.2.6.2 says the body is "for Light Panels only". The status code is inconsistent: 3.2.6.2 says 200 OK, 5.7's table says "204 OK". The module accepts any 2xx and reads the body. |
| Streaming port | 60222, fixed | The answer's `streamControlPort` | Documented, with inconsistent examples: 3.2.6.2 shows 60222 and 5.7 shows 60221. The module takes the answered port, an integer from 1 to 65535. |
| Streaming address | The configured address | The configured address; the answer's `streamControlIpAddr` is ignored | Documented for the Lines ("same as the IP address of the controller"). For the NL22 this is the module's decision: frames never go to an address a reply names. **Assumed:** the NL22 listens on its own address. |
| Transport | UDP | UDP | Documented. |
| Header | Panel count, 2 bytes, big-endian | Panel count, 1 byte | Documented. 3.2.6.2: v2's count, ID and transition "have been increased from 1B to 2B", so they are 1 byte in v1. |
| Per panel | ID 2 B, R, G, B, W 1 B each, transition 2 B (8 bytes) | ID 1 B, frame count 1 B (always 1), R, G, B, W 1 B each, transition 1 B (7 bytes) | Field order and widths documented; v2 "dropped" `nFrames` "as it was set to 1 in v1". OpenRGB's v1 layout matches byte for byte. |
| White byte | 0 | 0 | Documented: ignored, the panels white-balance themselves. |
| Transition | 1 = 100 ms | 1 = 100 ms | Documented unit, 100 ms. Value 1 is the module's choice, as for every display frame. |
| Multi-byte order | Big-endian | Only single bytes | Documented. |
| Panel ID range | 0 to 65535 | 0 to 255 | Implied by the field widths. **Assumed:** a real NL22's panel IDs fit one byte. The NL22 version 1 stream is refused before any device request for a layout with a wider ID. |
| Panels per datagram | Up to 65535 | Up to 255 | Implied by the count's width; no maximum is documented. The NL22 version 1 stream is refused before any device request for more than 255 panels. |
| Rate | At most 10 frames a second | At most 10 frames a second | Documented: "must not stream data at a rate higher than 10Hz". The session's existing `FRAME_MS` (100 ms, no catch-up) meets it unchanged. |
| Partial frames | Every zone sent | Every panel sent | Documented that a frame need not include every panel. The module still sends every zone. |
| Selection while streaming | `*ExtControl*` | `*ExtControl*` | **Assumed** for both; not in the documentation. #1598 observed it on the installed Lines; it is unqualified on the NL22. |
| Leaving streaming | A scene, effect or colour choice; a timeout of about 10 s | Same | **Assumed**, from #1598's third-party notes and the Lines trial. Neither is documented for any device. |
| Brightness while streaming | Unconfirmed | Unconfirmed | **Assumed** unchanged: the once-per-second check compares `/state` brightness as on the Lines. |
| Version support by firmware | None stated | None stated | Not documented. |

**How the module chooses the version.** By the light's configured kind, already in the registry and the saved layout: `lines` is version 2, `panels` is version 1. Version 1 is documented for the Light Panels without a firmware bound, and version 2 on them is documented without a firmware bound or an answer format. So no firmware read, `GET /` field or probing write is needed or added. The entry's answer is then read for the port, as documented; an answer naming none ends the Start (D3).

**Points only the real NL22 can settle (#725, owner-approved terms):**
- The installed NL22 accepts `extControlVersion: "v1"` and answers with a usable `streamControlPort`, at its own address.
- Its panel IDs fit one byte, so admission does not refuse it.
- It applies 7-byte panels with a frame count of 1 and a 100 ms transition, at up to 10 Hz, with acceptable appearance.
- It reports `*ExtControl*` while streaming, and `/state` brightness and power stay readable and unchanged.
- An app scene leaves streaming, and later datagrams do not repaint over it.
- How long it keeps the last frame without datagrams.
- Restoration of a saved scene and of a plain colour from the streaming mode.

## Goals / Non-Goals

**Goals:**
- Live sessions on the NL22 by the #40 first-trial policy, unchanged: an explicit Start per light in Free only, the endings and restoration of #1614, nothing resumed and no microphone.
- The Lines and the NL22 as independent targets: their own session, worker, journal, queue, record and writes.
- Evidence that all five effect families play live on both lights.
- The Lines' wire bytes, port, entry and behaviour unchanged.

**Non-Goals:**
- Qualifying either light's physical behaviour (#725).
- Combined Lines-and-Panels choreography (#1244), prepared timelines (#1273), microphone sessions (#1616) and the flash cap (#1255).
- Version 2 on the NL22, or choosing a version from firmware.

## Decisions

### D1. One session machinery, parameterised by a stream protocol

`stream.ts` exports a `StreamProtocol` per kind: its entry write, the port its answer leaves frames to, its datagram encoder and whether one datagram can address every zone ID. `playMusic` picks it from the frozen layout's kind. Everything else in the loop is shared, and the Lines' protocol object wraps the existing `ENTER_STREAMING`, `STREAM_PORT` and `streamPacket` unchanged. *Alternative:* a second session loop for the Panels. Rejected, because it would copy every ending and guard.

### D2. Admission by layout, not device ID

`checkMusicStart` no longer refuses every device but `wall`. After the saved-layout check, it refuses `unsupported-capability`, before any device request, when the kind's stream cannot address every zone. Only the NL22's version 1 can fail this: an ID above 255, or more than 255 panels. The order of the other checks and their codes are unchanged.

### D3. The NL22 entry's answer

The entry write keeps its `Execution` and its outcomes: a lost answer is `uncertain` and holds the device, and an HTTP error status is a refusal. A 2xx answer with a valid UDP port starts the session. A 2xx answer without one finishes the Start `answered` with `unsupported-capability`: `failed`, with evidence `transmitted`, because the write reached the light. The session ends `device`, restoration `none`, with no frame, no hold and no further write. The light may then stay in external control showing its last presentation, as after any device ending. *Alternative:* treat it as uncertain and hold. Rejected, because the light answered and nothing about the write is unknown.

### D4. Datagram port through the link

`LightDatagram` takes `{ip, port}`, and `DeviceLink.stream(packet, port)` supplies the configured address. The remote registration carries the port across the scenario link. The real transport sends to the given port, and its sole user, the session, passes 60222 for the Lines as before.

### D5. Simulated controllers model each version strictly

The simulated Lines accept only the version 2 entry with logical panels; the simulated Panels accept only version 1, or an omitted version, without them. Any other entry is refused with HTTP 400 and changes nothing. The Panels answer with `{streamControlIpAddr, streamControlPort: 60221, streamControlProtocol: "udp"}`. While streaming, a controller rejects a datagram on another port, of the other version's layout, with a frame count other than 1 (version 1), or naming a zone it does not light. That catches a wrong version, port, packet layout or panel ID. It counts an applied datagram arriving less than 100 ms after the last as `tooSoon`, on the simulation's clock, which is not wall timing. It keeps `manualAtMs` when a scene or power is chosen as in the app, so tests can show no write followed. Applied datagrams update only the zones they name.

### D6. Events, errors and logs (ADR 0012)

No message format, error shape, log event or polling path is added. Refusals keep their fixed texts, now naming the light rather than the Lines. The Start's ending reuses the existing `answered` end and `unsupported-capability` code. Records carry no address, port or token; the answer's address is never stored or logged.

### D7. Five effect families

Saved reactive presets hold `MusicRecipeV1`, whose five effects the renderer accepts. On the base, a test admitting a saved preset of each family on the Lines passes and streams every Line, so no behaviour changes for them. The same tests on the NL22 failed only on the old device refusal. The new tests check, per family and light: the entry, at least six applied frames, each frame's IDs in layout order, each element's zones sharing a colour, uniform families lighting every element alike and spatial families varying across the layout. Silence renders dark frames and keeps playing, and stale input ends the session as source loss with restoration.

## Risks / Trade-offs

- **[NL22 refuses version 1, or answers without a port]** → The Start fails with the light's code or `unsupported-capability`, with no frame. #725 records it, and a new decision would be needed.
- **[Panel IDs above 255 on the installed NL22]** → Admission refuses with `unsupported-capability` before any device request. Nothing is truncated.
- **[Streaming after a device ending]** → As on the Lines: nothing is written, and the light keeps its last frame until it times out or a scene is chosen. The scene restorer treats `*ExtControl*` in Free as someone else's choice.
- **[The answer's address differs from the configured one]** → Frames still go to the configured address, and the session plays or the light ignores them. The playing check reports what the light shows; nothing follows a reply to another host.
- **[Detection latency]** → As on the Lines: an app takeover is seen within about a second, and the light is expected to ignore the datagrams meanwhile (unqualified on the NL22).

## Migration Plan

None. No stored format changes: a frozen `music.play` row already carries its layout kind, and an older module has no NL22 session to end. The way back is to revert the source change. Installed state needs no change.
