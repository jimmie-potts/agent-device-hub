## Why

The companions module's local monthly spend guard is fixed at $150 in code ([#2024](https://github.com/jimmie-potts/agent-device-hub/issues/2024), [#2047](https://github.com/jimmie-potts/agent-device-hub/issues/2047)). Anthropic enforces the real monthly ceiling through a dedicated Console workspace's spend limit, and the owner set that limit to $200. So the local estimate refuses new messages at $150, before Anthropic's limit applies, and Details shows "of $150.00". The owner chose option A on [#2102](https://github.com/jimmie-potts/agent-device-hub/issues/2102): make the guard configurable, default $150, and leave the $20 daily pacing unchanged.

## What Changes

- The companions section's `assistant` gains an optional `monthlyLimit`: the local monthly guard in US dollars, from 0.01 to 10000. Without it the guard is $150, so an installation that does not set it behaves as before. A value that is not a number in that range refuses the section with `invalid-request` and the detail "assistant.monthlyLimit is the local monthly spend guard in US dollars, from 0.01 to 10000". The synthetic provider takes no monthly limit, as it takes no prices.
- The spend ledger's month total, its refusals of a call and of a new turn, the private `spend` route's month limit and so the page's Details and composer notice all use the configured figure.
- The $20 daily pacing, reservations, settlement and Anthropic's spend-limit refusals are unchanged.
- The companions README documents the setting and its default. `apps/runtime/UPGRADE.md` gains a #2102 section, and its #2047 note treats $150 as the default and the Console limit as the owner's choice.

**No design.md.** The change adds one validated number to an existing section, passes it to the existing ledger, and changes no table, record, contract, message, timing or privacy behavior. The owner's decision and its default are recorded on the issue.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-assistant-tasks`: "Shared spend limits" (the configurable monthly guard and the Console limit as the owner's choice).

## Impact

`modules/companions`: the section parser, the engine's options, the spend ledger and their tests, and the conversation state browser journey's fixture. The companions README, `docs/development.md` and `apps/runtime/UPGRADE.md`. The private `spend` route keeps its `version: 1` shape; only its month `limitMicros` value can differ. No event contract, SDK, runtime, table or diagnostic change, and nothing new reaches a model or cloud service. An earlier release refuses the new key, so the section drops it before a return. Delivery is reviewed integrated source; installation joins the next batch.
