## Context

The #1272 live Lines session (`modules/nanoleaf/src/music-session.ts`) runs inside the device's locked worker. Its first frame is the Start's journaled HTTP write, and later frames are the module's own HTTP paints. Before each frame it reads `/effects/select`; every second it also reads `/effects` and `/state` for external changes. A pick applied between a poll and the next frame is overwritten and leaves no trace (#1598), and the request load is about 20 HTTP requests a second, each on a new connection.

Nanoleaf's external-control mode, version 2, takes frames as UDP datagrams instead. According to third-party protocol notes, which the installed trial must confirm:
- The light enters the mode on a `display` write with `animType: extControl, extControlVersion: v2`, answered 204 with no body.
- It then reports `*ExtControl*` as its selection, and takes datagrams on UDP port 60222.
- Choosing a scene leaves the mode.
- The mode drops after about 10 s without datagrams.

The module already reads the Lines' zone IDs from the controller's reported `panelId`s (`configuration.ts`, `pairLines`). These are the IDs a datagram addresses.

## Goals / Non-Goals

**Goals:**
- An app pick during a live session ends the session `manual`, with no restoration, and the pick stays on the light.
- A playing session's device HTTP traffic is bounded by the once-per-second check.
- Admission, pacing, interruption order, restoration guards and session records keep their current behavior.

**Non-Goals:**
- Streaming for moments, animations, Panels or prepared cue timelines (#1273).
- Re-entering streaming after a takeover. A takeover ends the session; nothing resends or resumes.
- Qualifying the device behavior. #725 does that on the installed Lines.

## Decisions

### D1. Entry is the Start's journaled write

After the existing base checks (the light still shows the named Free base, read just before), the Start's `Execution` sends `PUT /effects {"write": {"command": "display", "animType": "extControl", "extControlVersion": "v2", "logicalPanelsEnabled": true}}`. The flag matches every Lines display write, which addresses the same logical zone IDs.
- A lost answer keeps today's uncertain outcome and hold. An answered refusal fails the Start as a device ending.
- Once it is answered, the session marks the device playing and finishes the Start as `sent`. The first datagram then waits behind the playing loop's ending checks, like every later frame, so a Stop, newer choice, alert or source loss admitted during the entry write ends the session before any frame.

The short gap between the base read and this write remains, once per session; that is the only place an app pick can be painted over. *Alternative:* keep the first frame as a static display and enter streaming afterwards. Rejected, because it adds a write and a second gap.

### D2. Datagram frames

Each frame is one v2 datagram:
- **Header:** a 2-byte big-endian count.
- **Per zone, 8 bytes:** the zone's `panelId` as 2 bytes; red, green, blue and white (always 0) as 1 byte each; and the transition time as 2 bytes, in units of 100 ms.

The transition stays 1 (100 ms), as in today's frames. The renderer produces the zones (one color per Line group, applied to each of its zone IDs). The HTTP `display` payload and its capacity check remain for preview and admission; the datagram is at most 2 + 8 × zones bytes.

### D3. Datagram transport

The module takes a `LightDatagram` transport, `(address, packet) => Promise<void>`, beside its `LightRequest`.
- **Real transport:** opens a UDP socket, sends to port 60222 at the device's configured address, and closes. It settles when the send completes or fails, within the light timeout.
- **`DeviceLink.stream(packet)`:** sends to the device's configured address. This keeps addresses and tokens out of the worker as `request` does. No answer is expected, so a datagram neither reaches nor fails the link's availability, and no span is opened per datagram.
- **Failure:** a failed send ends the session `device` with code `unavailable` and no restoration, as a failed HTTP frame write does today. Nothing retries.

### D4. Takeover detection

The playing loop drops the per-frame selection read. Every `EXTERNAL_CHECK_MS` (1 s) it reads `/effects`. If the selection is `*ExtControl*`, it also reads `/state` and requires the base brightness with power on. Anything else ends the session `manual` with no restoration. Between an app pick and the next check, the light ignores datagrams (to be confirmed by #725), so they cannot paint over the pick. Stop, alert and source-loss checks still run before every frame, from the store and the input, with no device read.

### D5. Restoration and silence

Restoration keeps its guards, with the music selection now `*ExtControl*`. Its brightness and base-scene writes leave streaming mode. The session sends a frame for each new fresh feature, silence included, so the gap between datagrams stays near 100 ms, far below the light's reported 10 s timeout. If input stops, source loss ends the session within its 400 ms validity. If the light leaves streaming on its own, the check reports `manual`, which is truthful, and nothing is restored.

### D6. Simulated controller

The simulated controller enters `*ExtControl*` on the entry write. It records decoded datagrams only while the selection is `*ExtControl*`, and ignores them otherwise, as the light is expected to. Runtime scenarios and module tests use it, and the unit fakes model the same rule.

### D7. Events, errors and logs (ADR 0012)

Datagrams are device protocol, not bus messages. They add no message format, error shape or polling path. Session endings keep their reasons and codes, the entry write keeps the command's span through `DeviceLink`, and no log line is added per frame.

## Risks / Trade-offs

All of the device behavior below comes from third-party notes, not Nanoleaf's specification. #725 checks each on the installed Lines before acceptance:
- **[Zone addressing on Lines]** Datagrams may not address the logical zone IDs, or the light may refuse or ignore `logicalPanelsEnabled` on the entry; a refused entry fails the Start with the light's code and writes nothing more. → #725 checks that every Line group shows its color. If they don't, the change does not qualify and a new decision is needed.
- **[App pick still painted]** The light might keep applying datagrams after an app pick. → The check still ends the session `manual` within about 1 s, and #725 records whether the pick stayed.
- **[Brightness while streaming]** Whether `/state` brightness scales streamed colors is unconfirmed. → #725 records it. The check's brightness rule is unchanged.
- **[Detection latency]** A takeover is noticed within about 1 s instead of before the next frame. It is acceptable because the frames sent meanwhile are ignored.
- **[Light left streaming after a device ending]** A failed send or read restores nothing, so the light keeps its last frame until its streaming timeout or a scene choice. The scene restorer treats `*ExtControl*` in Free as someone else's choice and leaves it. → #725 records what the light shows; recovery stays manual, as for any `device` ending.
- **[No per-datagram receipt]** UDP has no answer, so a frame's delivery is not observed. Later frames already carry no command outcome, so receipts stay truthful.
