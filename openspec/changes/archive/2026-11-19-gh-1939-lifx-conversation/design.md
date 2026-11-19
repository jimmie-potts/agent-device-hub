## Context

The Conversation engine saves approvals before execution. The core already follows admitted device owners for automation and forwards approved Hub-mode commands through its tracker. The LIFX writer already validates configuration revisions and generations.

## Decisions

- Follow the admitted LIFX owner's device records through SDK sync. Present observed values with their evidence time and distinguish absent, ambiguous, stale, and unavailable records.
- Keep device-specific operations typed and grant them through the existing Conversation allowlist. Save confirmed target and guards in the approval. Check eligibility at approval and at the core boundary before forwarding to the existing writer.
- Extend the existing assistant dispatch family additively. Preserve Hub-mode and coding proposals already stored. Use the same operation identity for an approved action and its result.
- Exercise both bulbs in the disposable runtime with the synthetic provider. The Conversation browser uses the existing approval UI and validates the additional proposal variants.

## Risks and trade-offs

An approval can outlive a manual change or device restart. LIFX advances the existing generation sequence when observed availability changes. The writer checks the original guards before accepting a command, even when the core still has the previous device record. Commands that omit the guard keep their existing admission behavior. A lost reply leaves the action uncertain, with no automatic replay. Conversation identifies readings outside the LIFX refresh interval as stale. Device names and observations stay on the authorized private Conversation path.

## Migration plan

Existing configurations retain the same tools unless the owner enables the LIFX tools. The installation check is tracked in #1940.
