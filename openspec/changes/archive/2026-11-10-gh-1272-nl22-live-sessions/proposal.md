## Why

Live Music sessions run only on the Lines ([#1272](https://github.com/jimmie-potts/agent-device-hub/issues/1272), phase 2 of delivery handoff #1617, epic #720). A Start on the original NL22 Light Panels is refused `unsupported-capability`. The issue asks for every effect family on both lights. The owner's #40 decision table (2026-11-10) applies the first-trial policy unchanged to the NL22: an explicit Start per light, only in Free, with the same endings and restoration as the Lines.

The NL22 takes a different external-control protocol from the Lines. Nanoleaf's OpenAPI documentation gives the Light Panels version 1: the entry's answer names the streaming port, and each datagram carries one-byte panel IDs. The Lines take version 2 on a fixed port with two-byte IDs (#1598).

## What Changes

- **NL22 sessions.** The module admits a live Music Start on the NL22 by the Lines' rules (`music-session.ts`): Free with no pending mode, no hold, power on, no other session or content, a saved preset the renderer accepts with the saved triangle layout, and a readable base.
- **Version 1 stream.** The Start's journaled write enters external control version 1. Frames go to the configured address only, never to an address the light's answer names, on the port that answer names. A version 1 datagram carries one-byte panel IDs and a one-byte frame count. A layout with a panel ID above 255, or more than 255 panels, is refused before any device request. An answer that names no streaming port fails the Start as transmitted, with no frame and no hold.
- **Same session rules.** Pacing, the once-per-second external check, manual takeover, alert, Stop, source loss, restoration guards, restart and records are the Lines' code, unchanged. The Lines and the NL22 each keep their own session, worker, journal, queue and record.
- **Five effect families.** Saved presets of all five families were already admitted on the Lines; this adds fake-device tests for every family on both lights.
- **Simulated controllers.** The simulated Panels enter version 1, answer with their port and apply version 1 datagrams. The simulation rejects a wrong version, port, layout or zone, and records datagrams under 100 ms apart and the time of an app choice.
- **Audio card.** Each light already has its own Music lighting section. Its capability hint no longer says only the Lines play, and the browser journey starts and stops the NL22 from its own section.
- **Unchanged:** the Lines' entry write, datagram bytes, port and behaviour; the core part; the `music-lighting-*` 2.0 families; prepared timelines (#1273); the flash-cap guard (#1255, not activated); the microphone (#1616).

## Capabilities

### Modified Capabilities
- `nanoleaf-module`: live Music sessions on the Lines and the NL22, each through its own external-control version.
- `runtime-dashboard`: the Audio Music lighting card drives each light's session from its own section, the NL22's included.

## Impact

- `modules/nanoleaf`: `stream.ts` (both versions), `music-session.ts` (admission and entry by kind), the link, worker and remote registration carry the datagram's port, the simulated controller, tests and the README.
- `apps/runtime/dashboard`: the capability hint, the unit test, the browser journey and its harness option for a simulated NL22.
- No contract package, core, schema, migration, store or installation change. The installed NL22's behaviour remains unqualified; #725 qualifies it under owner-approved terms.
