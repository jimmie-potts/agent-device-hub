## Context

#2024 added the `assistant_spend` ledger in the companions module. Each paid call reserves its dearest cost before dispatch and settles from reported usage. Prices came only from the private section; an unpriced model's turns and calls were refused. The Anthropic adapter maps error statuses to registry codes without reading the error body.

## Goals and non-goals

Goals: built-in prices so nothing needs entering; Anthropic's monthly limit as the hard ceiling, with its refusal mapped clearly; the local month shown and described as an estimate.

Non-goals: no Admin API key, no price-fetching job, no new credential beyond the workspace-scoped API key, no retry, no change to the ledger interface or its table.

## Decisions

### 1. Built-in table

`BUILT_IN_PRICES` in `spend.ts`, dated `BUILT_IN_PRICES_AS_OF = '2026-11-22'`, holds Anthropic's list prices in US dollars per million tokens, read from `platform.claude.com/docs/en/about-claude/pricing` on that date:

- `claude-opus-5-5`: input 4, five-minute cache write 5, cache read 0.20, output 20.
- `claude-haiku-5-5`, for a prompt up to 100,000 tokens: 0.10, 0.125, 0.01 and 0.50.
- `claude-haiku-5-5`, for a prompt over 100,000 tokens: 0.50, 0.625, 0.05 and 2.50.

A price change needs a release or a configured price. The price list is not an API.

### 2. Price lookup

The ledger uses the configured entry, else the built-in entry, else the dearest known rate. The dearest rate is each class's highest price across the configured table and every built-in tier. Lookups use own entries only, so `constructor` and similar names find nothing inherited. `source(model)` reports `configured`, `built-in` or `dearest` for display. No model is unpriced any more, so the #2024 missing-price refusal is gone. Its scenario is renamed "No configured prices" (review round 1 on PR 2049).

### 3. Haiku tiers

Anthropic prices a Haiku request by its prompt, counting cache reads and writes. A reservation uses the tier of the call's input bound. The bound is the request's bytes plus framing, never below the real prompt, so the reservation is never lower than the cost. Settlement uses the tier that `input + cacheWrite + cacheRead` falls in. Reserving every call at the higher tier would also be safe, but it would hold five times the needed amount for ordinary calls.

### 4. Spend-limit refusals

On a 400 or 429, the adapter reads the error body, bounded like an answer, and checks Anthropic's documented shapes (rate-limit documentation, 2026-11-22):

- A 400 `invalid_request_error` whose `error.message` starts with "You have reached your specified API usage limits" or "You have reached your specified workspace API usage limits".
- A 429 `rate_limit_error` with `error.details.error_code` `enforced_spend_limit_reached`.

Either raises `ProviderFault('capacity', false, SPEND_LIMIT_REACHED)`. Any other body keeps the status mapping. The engine already ends a task on a definitive provider fault. It now also saves the fault's `detail` as the conversation message, through the same path as the local limit messages. The refused call reported no usage, so its reservation keeps counting in the estimate. That is conservative, and the Console holds the real figure. Title calls (#2040) receive the same fault and fall back to the persona.

### 5. Estimate wording

The local monthly check keeps refusing as before, with its messages reworded as a "local estimate" against a "$150 guard". Details labels the figure "Spend this month (estimate)" and adds that the Anthropic Console holds the real monthly limit and spend.

### 6. Default workspace

Anthropic's rate-limit documentation of 2026-11-22 says a spend limit cannot be set on the default workspace on two platforms (Claude Models on Google Cloud, Anthropic managed, and Claude Platform on AWS). It also says that elsewhere a default-workspace limit might not count or stop some usage. The setup therefore requires a dedicated workspace and states both reasons.

## Risks

- Prices in the table go stale. The Console's limit still bounds the month, and a configured price corrects the day's pacing.
- Anthropic could reword its refusal. The task then ends with the status's usual code, still without a retry.
