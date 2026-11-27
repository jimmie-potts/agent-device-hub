## Context

Messages and Responses share a guarded proposal boundary for Wemo. Lighting has existing allowlisted tools and registered writers. Power and brightness use device records. LIFX color and temperature use the registered LIFX light record.

## Goals / Non-Goals

Allow either supervisor to resolve one configured light and reuse its reference in the active conversation. Preserve exact identity, capability, sharing, revision, mode and controller checks. Keep the installed qualification in [#2184](https://github.com/jimmie-potts/agent-device-hub/issues/2184).

## Decisions

- Keep the configured tool names and route each proposal through the existing dispatcher. The selected supervisor identifies the intended setting, the full numeric quantity when present, and any separate starting quantity. The Hub checks the cited values and units. A plain-language setting such as half brightness can supply a value without a numeric citation. The device's registered bounds decide whether to accept an absolute setting.
- Validate the whole numeric span and its unit together. A numeric value can omit its unit when the surrounding wording clearly ends the quantity. An unsupported unit prompts for a replacement on the same selected device and setting. The authenticated answer must supply the value under the same live guards.
- Resolve requested extremes through the registered bounds. For relative brightness, use the current observation and compute either percentage points or a proportion of that observation. For relative temperature, increasing Kelvin is cooler. Round to a whole device step, limit relative changes to the registered interval, and report the planned setting separately from the effect. Send no command when rounding or the boundary leaves the value unchanged. Refresh and recheck the relative base just before dispatch.
- Bind owner, ID, configuration and generation from SDK state.
- Save source and reference proofs with the model call under the existing Conversation grants. Resolve the target once at admission and apply known read-only, power and missing-setting constraints to the result. Before dispatch, check that the saved owner and ID still identify one eligible device and that the current sources, device references, grants, and guards agree with the saved proofs. Duplicate labels or conflicting IDs require clarification.
- Use tracked request IDs and existing device receipts. Preserve the Pixoo brightness readback and treat an ambiguous dispatch as uncertain without repeating the effect. Keep the original trace context through the dispatcher under ADR 0012.

## Risks / Trade-offs

A changed or unavailable target refuses admission rather than selecting a substitute. A stale observation can still answer a status question with its known freshness. A transport acknowledgment does not establish a physical change.

## Verification boundary

The previous exact-brightness fixture emitted a write proposal even when its
scripted owner asked a status question. It now returns only the read for that
turn, as required of both supervisors. A separate fixture injects a lighting
write into the Hub's structurally read-only history turn and verifies that the
Hub refuses it before dispatch. Ordinary status and action interpretation
belongs to the selected supervisor. The Hub verifies tool allowlists, current
request identity, device scope, settings and dispatch guards.

An ambiguous owner reference remains ambiguous on a contextual follow-up. Only
the owner's explicit ID, unambiguous current reference or owner qualification
can resolve that collision. A model-supplied ID alone cannot resolve it. When
saturation is missing, the pending question binds the original request, selected
light, hue and revision. The answer supplies one whole percentage, either a bare answer or a value with
percentage units in prose. Conflicting numbers, ratios and incompatible units
refuse the completed proposal. A change to the
referenced configuration or Hub mode closes that pending command without a write.
The LIFX read tool can establish contextual scope with no write tool enabled.


A hosted device read with an empty selector uses the existing complete-subject binding only for a single current request. An exact ID or label must resolve to one permitted owner and device. The same supervisor gets one facts-free repair with an explicit selector when that binding is unclear. A saved successful read retains its owner and exact ID for a fresh grant and identity check before replay. A focused question and its answer stay bound to the current request. The supervisor can finish after recognizing a withdrawal without asking the owner to select a device.
