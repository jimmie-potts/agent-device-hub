## Why

[#2047](https://github.com/jimmie-potts/agent-device-hub/issues/2047), part of epic [#2035](https://github.com/jimmie-potts/agent-device-hub/issues/2035), follows #2024 (PR 2039). That release enforced $20 a day and $150 a month locally, from prices the owner had to configure. The owner chose a layered design ([decision on #2024](https://github.com/jimmie-potts/agent-device-hub/issues/2024#issuecomment-7082546817), 2026-11-22). A dedicated Console workspace with a $150 monthly spend limit enforces the hard ceiling on real billing. The local ledger paces the day from a dated built-in price table, so nothing needs entering at install.

## What changes

- A dated built-in price table for `claude-opus-5-5` and `claude-haiku-5-5`, read from Anthropic's price list on 2026-11-22. Haiku has a dearer tier for a prompt over 100,000 tokens. A model the table does not know is priced at the dearest known rate. A configured price overrides the table. With no prices configured, the assistant runs with daily pacing.
- The provider adapter maps Anthropic's documented spend-limit refusals to `capacity`. Those are a 400 `invalid_request_error` "You have reached your specified ... API usage limits" and the 429 `enforced_spend_limit_reached` tier cap. The conversation shows a message naming the monthly limit at Anthropic. Nothing more is sent for that turn, and nothing retries.
- Details shows today's spend against $20 and this month's local figure as an estimate, with a line that the Console holds the real monthly limit and spend. The local monthly check stays as a guard, described as an estimate.
- The companions README and `apps/runtime/UPGRADE.md` describe the owner's one-time Console setup.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `bunny-assistant-tasks`: the configured model provider, shared spend limits and conversation panel requirements change.

## Impact

`modules/companions` (spend ledger, provider adapter, engine, page) and the conversation state browser journey. The ledger interface (`reserve`, `settle`, `inputBound`) is unchanged for #2040's title calls. No event contract, SDK, runtime, table or diagnostic change. The Console setup is an owner action at installation with #1869.
