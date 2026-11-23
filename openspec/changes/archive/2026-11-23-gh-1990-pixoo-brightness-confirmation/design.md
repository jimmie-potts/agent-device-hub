## Context

Conversation already dispatches approved catalog actions through the core tracker. Pixoo already serializes brightness writes and can read brightness through its bounded probe. A probe's ordinary device state can be refreshed by other activity and lacks request identity.

## Decisions

- Keep the existing tracked write and its one terminal outcome. Record the acknowledgment with the request identity before following the result. Read in the Pixoo writer turn before a subsequent brightness write can change the setting. Use a two-second owner read budget after acknowledgment and retain a missing read as unavailable.
- Use the device state family for request-linked readback, including an explicit unavailable result. The owner retains bounded recent results through restart so sync can recover a response after a newer update. Conversation also checks the exact core operation. SDK sync and live updates carry the evidence. A refreshed general device snapshot can describe the current setting but cannot associate it with a request.
- Companions owns the saved watch. Bind it to the approved request, original task and device configuration. Use at most the remaining tool deadline and cap the in-turn observation window at one second. When further evidence can arrive, allow a follow-up for up to one day. Once the window expires report that confirmation was unavailable if the original reply promised an update. Process reconnects as reads.
- Keep the final reply and follow-up in the existing transcript. Deduplicate the update by request ID. Follow-up needs neither a model call nor a task transition. Use the existing outcome vocabulary and trace parent from dispatch through the owner publication.

## Risks and Trade-offs

A lost write reply retains uncertainty. An unrelated upload or later write cannot change the saved result for the first request. A conflicting tracker outcome takes precedence over a reported reading. Operations that predate the watch retain their existing behavior.

## Migration Plan

Read existing owner and Conversation stores with the new fields absent. Use additive state contracts and private data. Qualify a forward Mac batch under the existing deployment procedure after the pilots pass.
