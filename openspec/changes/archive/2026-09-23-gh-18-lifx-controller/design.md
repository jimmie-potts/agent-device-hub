## Context

See proposal.md. Controller v1 has no color/temperature operation but explicitly permits versioned device profiles. Tidbyt provides the existing in-process precedent. Design is required by the schema because queue timing, uncertainty and a new profile cross module boundaries.

## Goals / Non-Goals

**Goals:** A small embeddable controller, one queue per configured bulb, bounded operation lifetimes, typed v1 receipts and truthful observations.

**Non-Goals:** HTTP hosting/authentication, state-feed policy, effects, installation, live traffic, UI, persistence or cross-process device leasing. The installing host must designate this as the sole writer.

## Decisions

- Use direct Node UDP as selected in #17; no LAN library dependency. Bind transport targets at construction. A fresh socket/source per exchange avoids sequence-wrap and late-reply confusion. Validate peer, type, source, sequence, target and length; close sockets on success, error, abort and controller close.
- Use an in-process multi-bulb owner with unique configured device IDs and addresses, containing independent per-bulb queues. Bound bulbs/batches and outstanding work to 32, receipts to 256 per bulb. Callers use neutral IDs only. Future network hosting authenticates before this trusted boundary.
- Preserve controller v1 envelopes, receipts and snapshots. A strict `lifx-light` 1.0.0 profile owns color/temperature requests and observations; it never widens shared v1 schemas. Profile requests use the same request/revision/generation namespace and full-body replay comparison. Profile color uses integer hue 0–360 and saturation 0–100; temperature is integer kelvin within known capability bounds.
- Serialize read-modify-write within the bulb queue. Brightness, color and temperature read LightState first, change only requested HSBK components, then send absolute zero-duration LightSetColor. Power uses absolute DeviceSetPower. No power change is implicit in color edits.
- Default timeout is 500 ms, one retry; configuration bounds timeout to 10–5000 ms and retries to 0–3. Retries stay within the same queue turn and use the same absolute payload. A dispatched write with no acknowledgment is uncertain, never safe-to-replay. Application request replay returns the retained receipt. A read failure before a Set has no write effects.
- Cancel increments generation and aborts active transport; check generation before every attempt. An uncooperative fake transport cannot hold the queue because the controller races its result against timeout/abort. Close stops admission and drains cancelled entries. Retain last good observation through failures; only LightState refreshes its timestamp. No automatic polling.
- Configure capability evidence from #17: only vendor 1/product 27 with verified firmware 2.90 is enabled initially, including 1500–9000 K. Unknown models/firmware remain unsupported. Effects are disabled. IPs, serials and bulb labels never enter snapshots or receipts.

## Risks / Trade-offs

- UDP acknowledgments are not visible evidence → report sent/uncertain separately from observations and physical acceptance.
- Other installed writers or manual control can race this process → retain external-control unknown; sole-writer designation belongs to installation.
- Absolute-value retries can repeat a write → bounded only, no effects, duration zero; cancellation stops subsequent attempts.
- An in-process owner cannot enforce a cross-process lease → document host responsibility instead of adding installation machinery.

## Migration Plan

No live migration or installation. Add the workspace and source checks through a reviewed PR. Later installation supplies private targets and sole-writer ownership under its own issue.
