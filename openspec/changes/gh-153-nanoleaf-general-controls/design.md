## Context

See proposal.md. The Hub #151 candidate already renders a capability-driven general-controls section in the common component view: power and brightness use the draft form pinned to the observed snapshot, one-click actions use the latest observed snapshot and stay busy until the refreshed snapshot arrives, only an accepted ticket is watched for its terminal outcome, and an uncertain result locks the group. The hub forwards any valid controller v1 request on `/api/controllers/v1/<alias>/commands` after credential, alias and scope checks, and the Nanoleaf #64 hub companion makes the hub's exact-shape `nanoleaf.integration/1.0` validator accept the optional `scenes` list.

Nanoleaf `main` `8062849` declares `power`, `brightness` 0 to 100, `scenes` with the discovered IDs and `modes` Work/Quiet/Free on controller v1; `media`, `zones` and `preview` stay unsupported. Desired power and brightness are known only while an override is active; observation stays unknown. `scene.activate` is accepted only while the controller's mode is Free and otherwise fails typed as `unsupported-capability` before any write; an unknown scene ID fails the same way. A mode command cancels queued general controls as stale generation.

## Goals / Non-Goals

**Goals:**
- Reuse the delivered control components so Nanoleaf and Pixoo share one pattern: one guarded command per control, named reasons, draft and lock behavior.
- Gate scenes on the observed controller v1 desired mode and the pending list, with the explicit Free switch submitting the same controller v1 mode command as the Nanoleaf mode form.
- Present the brightness override policy without inventing evidence: an active override is shown as such; no override is shown as unknown.

**Non-Goals:**
- Hub MCP scene tools, desk presets, Free restoration baselines (Hub #67), hub or contract wire changes, installation and physical acceptance (Hub #155).
- Scene discovery, naming or activation policy; those belong to the Nanoleaf controller under #64.

## Decisions

- Gate Nanoleaf content controls on the controller v1 snapshot's desired mode plus any pending `mode.set` in the snapshot's pending list, because the scene command is guarded by that same snapshot and the controller itself gates on its mode. An unknown desired mode disables scenes with that reason rather than assuming Free. Alternative: gate on the integration snapshot's `mode`; rejected because it is a separate read with separate guards and the Pixoo integration-mode path exists only because Pixoo declares no controller v1 modes.
- The explicit switch is a one-click `mode.set` Free command through the existing controller v1 route, the same command the Nanoleaf mode form submits, using the reviewed one-click component so it stays busy until the refreshed snapshot and never sends a scene command. Returning to Work or Quiet remains the mode form.
- Scene activation is a one-click action with a parameter, like Pixoo playlist start: a select of the controller v1 `sceneIds` and one activate button. Labels come from the integration snapshot's `scenes` entries only when a name is present; IDs otherwise. Integration entries whose ID is absent from the controller v1 `sceneIds` are not offered, because controller v1 is the authority for what can be activated. Nothing else from the integration snapshot is copied into labels.
- The brightness hint for Nanoleaf states the override policy from the controller's specification: a known desired brightness is an active override until the next explicit mode command from any owner; an unknown desired brightness means no override and the mode's own policy, with the slider starting at a placeholder. The power hint states that power works in every mode, changes no mode, and that while off the worker keeps tracking tasks and writes nothing until the next mode command.
- The availability helper gains a `scenes` reason with the existing ordering: missing capability, then scope, then stale or external-control evidence, then mode gating. Pixoo keeps `media` gating; Nanoleaf keeps `scenes` gating; neither affects power or brightness.
- The fake Nanoleaf controller declares the released capabilities and rejects `scene.activate` outside Free or for an undeclared ID with `unsupported-capability` and no state change, so browser scenarios observe the real receipt path. The fixture's integration snapshot lists one named and one unnamed scene so both label rules are exercised.

## Risks / Trade-offs

- [The browser observes Free but the controller has since left Free] → the controller returns the typed `unsupported-capability` failure; the view shows it, the action stays available, and the refreshed snapshot shows the observed mode.
- [A mode command cancels a queued brightness or power override as stale generation] → the pending list and last outcome show it; the view never re-submits.
- [Transport success mistaken for a physical result] → every status keeps the "Physical result is not confirmed" wording.
- [Fixture drift from the real Nanoleaf] → the fixture declaration is pinned to Nanoleaf `8062849`, the revision the hub fixtures pin; Hub #155 verifies the installed wall.

## Migration Plan

No stored state, wire contract or configuration changes. The rebuilt static assets ship with the hub package as before; rollback is the previous source package.
