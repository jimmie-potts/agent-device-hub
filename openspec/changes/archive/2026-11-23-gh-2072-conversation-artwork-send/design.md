## Context

The browser stages artwork through the existing authenticated upload route. Art validates the bytes and derives the durable artwork ID from the stage request. Companions owns the original task, turn and transcript. The core already publishes configured artwork destinations and guards the device identity used by a show command. The Pixoo confirmation pilot on main records a pending watch and reconciles a later, correlated result in the original exchange.

## Goals and scope

One submitted attachment and one configured playback destination are sufficient for the first implementation. Keep media bytes in Art and use the existing public authenticated content route. Continue using explicit approval for unrelated Conversation tools and generated artwork.

## Decisions

- Own Send in Companions. Persist the authenticated submission identity, the staged artwork reference and the intended effect with the turn before calling Art. Keep Art promotion idempotent by artwork identity and use a stable request ID per effect. The browser could issue save and show separately, as it does today. A browser-led chain cannot reliably finish the original exchange after a closed tab or a lost receipt. Record pending work before dispatch and resolve it against owner evidence after restart. An expired stage can request a fresh attachment with zero display writes.
- Reuse the existing owner message and private attachment reader. Extend message metadata to distinguish uploaded library attachments from generated attachment requests wherever their read paths differ. Persist the message identity and attachment relationship together. Read older message formats and generated artwork as before.
- Resolve the direct playback instruction at the trusted owner-message boundary. Accept a narrow whole-message form with an explicit play/show verb, a reference to this attachment and exactly one matching configured destination. A model-driven interpretation could cover broader language. For first delivery, a narrower local interpretation gives a verifiable authorization boundary. Text in quoted passages, media or assistant replies supplies no authority. Missing or ambiguous display names get clarification. The owner's subsequent explicit choice authorizes only that saved attachment and that target.
- Bind the destination and configuration identity at Send, save the artwork, then dispatch the existing guarded show using that saved binding. If identity or eligibility changes, report refusal instead of choosing a substitute. Show acceptance, preparation and presentation evidence come from the existing tracked requests. Associate timely and later evidence with the same exchange through the shared #1989 result path. A restart, reload or delayed result may reconcile evidence and must issue no duplicate device write. [Agreed ownership](https://github.com/jimmie-potts/agent-device-hub/issues/1989#issuecomment-7115777266)

## Risks and trade-offs

- Store boundaries allow partial outcomes. Keep the original exchange and a stable library identity even when display fails. Retrying a definitive no-effect display failure uses the existing library item. Uncertainty requires outcome reconciliation.
- Playback names can be ambiguous even with an explicit imperative. Resolve against the current configured display inventory and preserve the binding until the core rechecks it.
- Wemo's confirmation pilot changes the shared engine, receipt and composer files. Develop the attachment-specific seams separately. Integrate #2071 before shared engine and reply changes. Coordinate the result path with #2069 so artwork supplies evidence to the existing shared owner.

## Migration and installation

Use additive storage and contract changes, including reader tests for older messages and existing saved art. Review the actual persisted-format changes and startup recovery in the selected qualified Mac batch. Check the installed Conversation Send path with synthetic media. Carry forward the physical Pixoo and Tidbyt checks under the owner's explicit target and sequence authorization.
