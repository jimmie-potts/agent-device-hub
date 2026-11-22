## Context

The companions engine owns assistant tasks (`modules/companions/src/assistant/engine.ts`). Every call is admitted in one outbox transaction that checks the task's persisted counters, reserves time and units, and saves the call's receipt before anything is sent (`#call`). A reply settles the receipt; a lost answer leaves it uncertain, and its reservations stay. The Anthropic adapter (`anthropic.ts`) builds one Messages API request per model call through the module's own fetch and sums the reported token counts into `units`. The bounds are pure constants shared by the store, engine and page (`limits.ts`).

## Goals and non-goals

Goals:

- The doubled per-turn limits, with every bound that depends on them, and a named limit-reached result.
- Prompt caching on every hosted call, with usage reported by price class.
- Shared daily and monthly spend limits counted from reported usage, conservative for unreported usage, durable across restart, and visible in Details.
- A small interface that a model call outside a task uses to count its spend.

Non-goals:

- No event contract, SDK, diagnostic profile or runtime change. Public `assistant-state` is unchanged.
- No retry, fallback model, queue or polling path (ADR 0012). Coding-worker runs are not counted.
- No built-in prices, no spend clearing or editing, no configurable limits.

## Decisions

### 1. Bounds

`LIMITS` holds the owner's values. The owner message bound sets three others, each sized for the worst case of JSON escaping (six bytes for a control character): staged input `6 × 32 KiB + 1 KiB` (the previous rule, 25,600 bytes for 4 KiB), checkpoints and pending writes 256 KiB, and pages 512 KiB, so one saved message of the largest size always fits a page. The result and reply bounds stay at 8 and 16 KiB: they bound the model's answer, not the owner's input. Dispatch and coding hand-off request deadlines stay one second under the tool deadline, now 29 seconds.

### 2. Per-call unit reservation

A model call reserves `inputBound(request) + 16,384` units: the JSON bytes of the whole turn input plus 8,192 framing units, and the output bound. Each token encodes at least one byte, so the bytes bound the input tokens; the framing covers the fixed system text, the tool-use prompt and message framing. The adapter's `max_tokens` is 16,000, under the output bound. A fixed reservation large enough for a 1 MiB transcript would have kept the last third of the 1,000,000-token budget unusable and overcounted unreported spend. A reply that reports more units than its reservation is still refused with `capacity`, as before, but its usage is spent and recorded.

### 3. Limit messages

The admission transaction computes which limit refuses the call. After the rollback, a separate transaction saves an assistant message naming it, and it is offered to speech, as the prompt-context bound already does. The question limit does the same in the turn's append.

### 4. Prompt caching

The request carries one top-level `cache_control: {type: "ephemeral"}`, the API's automatic caching. The API places the breakpoint on the last cacheable block and moves it as the transcript grows. Render order is tools, system prompt, messages; within a task the tools are fixed, the system prompt changes only with the Hub mode or a preference edit, and the transcript is replayed exactly as saved. So the second call reads the first call's prefix. Explicit breakpoints would add marker bookkeeping in the adapter for no gain at this prompt size. The five-minute lifetime matches a task's call spacing.

### 5. Prices

`assistant.prices` maps each model to `input`, `output`, `cacheWrite` and `cacheRead` in US dollars per million tokens. All four are required, from 0 to 1000, for at most 16 models. The hosted provider's model must have an entry, or the section is refused. Prices change over time, and the owner keeps them in the private section; there are no built-in defaults that could drift silently. The README states that the five-minute cache write is 1.25 times the input price on the Anthropic price list, checked 2026-11-22, and its example uses synthetic values.

### 6. The ledger

`assistant_spend` in the module's database holds one row per paid call: its id, purpose (`task` or `conversation`), owner, model, local day and month, reservation and, once reported, cost and usage. Amounts are integer millionths of a dollar, rounded up. A row's spend is its cost when reported, else its reservation. The reservation prices every input unit at the dearest of the input, cache write and cache read prices, and every output unit at the output price.

A task call reserves inside the admission transaction, so its ledger row and receipt commit or roll back together. The reply's usage settles the row in the transaction that saves the reply. A failed reply with reported usage settles in the failure transaction. A late reply after the deadline settles in its evidence transaction. Nothing else settles or releases a row: unreported usage keeps the reservation, never zero, and startup leaves the ledger unchanged.

### 7. Day and month

Periods are the runtime host's local day and month (`Intl` with the host zone, `localDay` as the companion rules use), as the art module's ledger already counts its days and months. A row counts on the day it was reserved, so a call admitted at 23:59 that answers after midnight counts on the earlier day. Tests name a zone through `AssistantOptions.timeZone`.

### 8. Refusals

A call is refused when its reservation plus the period's counted spend would pass a limit: the limit is never passed, even by a call that uses its whole bound. A new turn of a paid profile is refused when a period's counted spend has reached its limit. Both use `capacity`. The turn refusal's error detail names the limit; the page also shows the limit beside the composer, because the command receipt shows only the code. A call already sent finishes. A synthetic profile is never refused for spend.

### 9. Calls outside a task

`AssistantEngine.spend` is the ledger. A conversation-level call, such as #2025's title call, uses it as a task call does:

1. `spend.reserve({id, purpose: 'conversation', owner: conversationId, model, inputUnits: inputBound(request), outputUnits: LIMITS.outputUnits})` before the request leaves, inside the caller's transaction when it saves a receipt. A returned string is the refusal message: send nothing and answer `capacity`. The id is unique for all time; a reused id throws.
2. `spend.settle(id, reply.usage ?? null)` when the answer arrives. Null, for a lost answer, keeps the reservation.

### 10. Display

The `spend` content route answers `{version: 1, day, month}`, each with the period, counted and limit amounts and the count and amount of reservations without reported usage. It carries no text, call or task identity. The page reads it once per assistant-state revision, which every saved call change bumps, so it follows the ledger without polling. A failed or malformed read shows Unknown.

## Risks

- A provider that reports more tokens than a request's bytes would fail that call with `capacity`; its usage is still counted.
- An owner who leaves `assistant.prices` out of the installed section refuses the module at start after the upgrade; the upgrade notes call it out.
- Prices in the section can go stale. The provider's own Console limit stays as a second bound.

## Migration

The ledger table is created on first start, empty. Earlier tasks keep their saved counters, which the new limits only relax. No data is rewritten.
