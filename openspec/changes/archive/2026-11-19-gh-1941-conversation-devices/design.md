## Context

Conversation stores requests and proposals in the companions module. The pilot uses the SDK to read LIFX state and forwards approved commands to the existing tracker. Mac acceptance in [#1940](https://github.com/jimmie-potts/agent-device-hub/issues/1940) verified that path. It also showed that a long-lived LIFX follower can retain an old reading until an existing owner sync requests a refresh.

## Goals / Non-Goals

- Expose configured LIFX, Wemo, Nanoleaf, Pixoo, Tidbyt and playback controls through their existing owners. Expose Roborock and Volcano status and account for integration gaps using the private installed inventory.
- Preserve Companion permissions, exact approval, device policy and independent evidence. Reuse saved-art presentation and the Nanoleaf show catalog, preview, save and playback interfaces.
- [#724](https://github.com/jimmie-potts/agent-device-hub/issues/724) owns model-generated show drafts. This change implements owner-directed authoring within the current cue schema.

## Decisions

- Keep catalog entries explicit. Each maps a permitted tool to its SDK owner, validated inputs, an approval description and one existing typed command or orchestration route. Use owner-qualified lookup and retain the legacy meanings of LIFX tools and stored proposals. Enable added tools by name.
- Use each admitted owner's existing SDK states and bounded reads. Shape results to show status, observation time, limitations and permitted control names. Keep private configuration and credentials out of tool results. Use the LIFX owner's existing on-demand refresh policy within a read deadline and preserve stale evidence until a newer observation arrives.
- Bind a proposal to the target identity and guards that its owner recognizes. Revalidate the stored action, active allowlist, target and binding before forwarding through the tracker. Keep compatibility with existing assistant envelopes. Derive payloads from existing owner schemas. A new action entry specifies a supported family and payload, so the model cannot select an arbitrary route or schema.
- Start with the common power command for Wemo and preserve its authoritative queue, hold, and maximum-on policy. Extend coverage to the other existing contracts and record any missing device operation with the owning integration. Playback approval identifies the current source and uses the owner revision to prevent a silent switch.
- Resolve saved art from its existing catalog and invoke the core's art-show orchestration with the approved displays. Surface each preparation and presentation operation. Leave display eligibility and protection with the existing owners.
- Reuse Nanoleaf's timeline validation, deterministic authoring helpers, storyboard, catalog save and immutable version reads. Keep the draft across an unsuccessful save. Use tracked Music lighting Start and generation-bound Stop with the owner's existing admission and restore policy.
- Reuse private assistant diagnostics and the original trace and operation IDs across all owner hops. Record registry codes and effect evidence as specified by ADR 0012. A lost reply remains uncertain. Restarts restore recorded responsibility and results without sending another command.

## Risks / Trade-offs

Owner revisions can change while an approval is displayed. An expired or stale proposal needs a new user request and approval. An unchanged LIFX LightGet can leave the original observation timestamp in the published record. Conversation preserves that distinction. A successful transport acknowledgment and an independently observed effect remain separate, including across display recipients. Existing installations keep their current allowlists until the owner enables new tools in the qualified batch.
