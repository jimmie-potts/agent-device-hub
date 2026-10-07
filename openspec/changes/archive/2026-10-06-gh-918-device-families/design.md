## Context

See proposal.md, "Why". The schema's criteria for a design apply: this change sets the data model that every device module, the Hub mode owner and the runtime dashboard consume, and it moves notice acknowledgment from a hook observation to a command. ADR 0012 sets the message kinds, the envelope and the blocks, ADR 0005 keeps the general controls, and #695 settled the Hub-mode table. This document records the payload-level decisions.

## Goals / Non-Goals

**Goals:**
- One closed `device` record that the dashboard's general cards and MCP can read for any device.
- One command family per kind of v1's closed command union, with v1's guards and capability rule.
- One notice acknowledgment command that a module can send before the core's responder (#831) exists.
- One status helper with the same ranking and colors on every device, for `session/2.0` records.
- A mapping test that fails on any unmapped field of v1's snapshot, capabilities or command union.

**Non-Goals:**
- No device-specific families: LIFX color and temperature, Pixoo media and catalog, Nanoleaf edits, animations and favorites belong to each module story.
- No per-device Hub-mode overrides (#695) and no LIFX in the Hub mode (#415).
- No runtime behavior: no module, responder or dispatcher serves these families until the module stories land.

## Decisions

1. **One record per device, published by its module.** `device/2.0` carries the full record, and its envelope subject is the device `id`. It adds `kind`, a kebab-case device kind such as `nanoleaf` or `pixoo`, which the Hub-mode table and the dashboard key on; 1.x kept it in the Hub's controller configuration. The module's source names the module, so controller and source IDs become module-internal.
2. **Availability keeps 1.x service health's four values.** `ready` becomes `available`; `unknown`, `degraded` and `unavailable` stay. A device the module cannot reach is `unavailable`, and its errors and timeouts never fail the module (module failure policy A, owner decision 2026-10-06). The alternative, `available` and `unavailable` only, would lose LIFX's and Tidbyt's `degraded`.
3. **Desired and observed stay apart.** `desired` holds tagged power, brightness and native mode. `observed` is unknown, or known with its own evidence time `observedAtMs` and tagged power and brightness. 1.x's controller-monotonic clocks go away, as the moment start's did (coordinator decision, 2026-10-06): modules share the runtime's clock. Evidence age is derived. The validator refuses an observation or an external-control reading after the message time.
4. **Native modes are open kebab-case values the device advertises.** `Work` becomes `work` and `Monitor` becomes `monitor`. A closed enum would need a contracts change for every new device mode. A known desired mode must be one the device advertises (validator), and `device-mode-set` names a native mode, never the Hub's. The Hub's selection lives only in `mode/2.0`, whose enum refuses `monitor` and `media`.
5. **The Hub-mode table maps one way.** `HUB_MODE_TABLE` and `nativeMode(kind, mode)` give Nanoleaf Work, Quiet and Free one to one, and Pixoo Work and Quiet to Monitor and Free to Media (#695). LIFX, Tidbyt and playback get `undefined`. There is no inverse: Pixoo's Monitor serves both Work and Quiet, so an observation can never establish the Hub's mode. A test keeps the README table equal to the code's.
6. **One command family per kind of the union.** `power.set` becomes `power-set`, sent as `org.bunny.power.set.requested`, and so on; `mode.set` becomes `device-mode-set`. The family's last word is the verb, as in `mode-set` and `moment-play`. Each carries `requestId` and optional `expectedConfigurationRevision` and `expectedGeneration`, so v1's configuration revision and generation guards carry over. They are optional because a dispatcher fanning out a Hub mode (#924) must not race each device's revision. The envelope subject names the device; no payload names a device, controller, address or credential. Replies and outcomes use the profile's payloads. A module answers each device's key, `bunny.cmd.<family>.<device id>`, because SDK responders may not overlap.
7. **`commandSupported` carries v1 admission's capability rule.** A command is supported only when its capability is supported and, where v1 checked one, the named scene, zone, playlist, action, mode or mood is advertised; a moment also stays within the device's maximum duration. A module refuses the rest with `unsupported-capability`, and the dashboard disables those controls. A test compares it with every v1 admission case that queued or refused a command for its capability.
8. **The record keeps a pending count, not the queue.** The core's tracker (#782) records each request from sent to completed, and the module keeps its own queue. 1.x's `lastSuccessfulSend`, `limits`, `cursor` and `nextRequestId` have no 2.0 home; MAPPING.md records each disposition. `lastOutcome` keeps the profile's outcome payload of the last completed command; a receipt that the receipt rule turns into a reply refused its request and is not an outcome.
9. **Notice acknowledgment is a core command.** `notice-acknowledge` names the consumer and the notice, and its subject is the session's entity ID. The core (#831) adds the consumer to the notice's `acknowledgedBy` through agent-state's `acknowledge`, which clears the notice for that consumer only, as the ADR 0012 amendment in PR #913 states. It replaces the `lifecycle` family's `notice-acknowledged` event: an acknowledgment is a consumer's request, not a hook observation. The notice ID must be a SHA-256 hash, because the owner names every notice that way. A 1.x acknowledgment naming any other ID could only ever be stale, and 2.0 refuses it. An acknowledgment proves neither readership nor a cleared attention item.
10. **Playback control goes to the playback record's owner.** `playback-control` asks for play, pause, next or previous, with an optional `expectedRevision`, and its subject is the playback record. The owner (#929) sends it once to the source presented at admission and never redirects or retries it. Its actions share one definition with the record's `controls`.
11. **The status helper is a copy with 1.x semantics.** `v2/status` keeps `sessionState`, `highestStatus` and `STATUS_COLORS`: attention over working over done, an active child makes its root working, uncertain freshness never hides the owner's state (#439), read evidence never retires done, and acknowledgment retires done for any consumer unless `acknowledgingConsumers` names some. Its input is the consumer's copy, `{synced, sessions}`: a copy that has not synced, or whose later sync failed, reads as `unknown`, which replaces 1.x's unavailable feed and stopped collector. The 1.x package stays for the old controllers until #839, and a test keeps the colors and the ranking equal to it.
12. **Device families build on the session family.** A device label uses the session family's display text, with its credential checks, so `registerDeviceFamilies` runs after `registerCoreFamilies`; alone it throws.

## Risks / Trade-offs

- [The record must serve the dashboard's general cards and MCP before any module publishes it] → nothing serves it yet, so a module story can revise it in a later minor version before release.
- [The ADR 0012 amendment in PR #913 lists read evidence among what clears a finished turn's unread state, while the status helper's `done` keeps 1.x's rule that read evidence never retires it] → this matches today's devices: Nanoleaf's unread policy accepts read evidence, and LIFX and Tidbyt's status does not (`tidbyt-agent-status`). The coordinator settles the wording in PR #913; a module that wants read evidence to clear its own view applies it before calling the helper.
- [`lastSuccessfulSend` has no home in the record] → the dashboard's "Last successful transmission" row (#922) reads the tracker (#782) instead.
- [A 1.x acknowledgment with a neutral notice ID is refused] → the owner names every notice by a SHA-256 hash, so such an acknowledgment never matched a notice.

## Migration Plan

No runtime migration happens here. Device records are not migrated: each module publishes its devices fresh at the cutover (#840), and module stores migrate in their own stories. Rollback is a source revert, because nothing consumes these families yet.
