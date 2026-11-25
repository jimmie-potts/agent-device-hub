## MODIFIED Requirements

### Requirement: Shared spend limits

Anthropic SHALL enforce the monthly ceiling through a dedicated Console workspace's monthly spend limit, whose amount the owner chooses and sets once at installation; the companions module SHALL pace the spend of every profile's paid model calls together at $20 a day and SHALL keep a local estimate of the month with a guard, by the runtime host's local day and month starting at local midnight. The guard SHALL be $150 unless the section's optional `assistant.monthlyLimit` sets it in US dollars, a number from 0.01 to 10000, to match the owner's Console limit ([Hub #2102](https://github.com/jimmie-potts/agent-device-hub/issues/2102)); any other value SHALL refuse the section with the invalid-request code and a detail naming `assistant.monthlyLimit` and its range, and the synthetic provider SHALL take no monthly limit. The month's total, its refusals and the page SHALL use the configured guard, and the daily limit SHALL stay $20. Prices SHALL come from the section's price table, else from a dated built-in table read from Anthropic's price list (2026-11-22: `claude-opus-5-5`, and `claude-haiku-5-5` with its dearer tier for a prompt over 100,000 tokens, counting cache reads and writes), else from the dearest known rate for each price class; a tiered model SHALL be reserved at the tier of its input bound and settled at the tier its reported prompt falls in. In the transaction that saves a paid call's receipt, the module SHALL reserve in its own SQLite ledger the most the call can cost: every input unit at the model's dearest input price and every output unit at its output price, at the model's prices (configured, else built-in, else the dearest known rate). It SHALL refuse the call with the capacity code before dispatch, and record nothing, when that reservation would pass the daily limit or the month's guard, and the conversation SHALL show a message that names the limit. Reported usage priced by class SHALL replace the reservation in the transaction that saves the answer, including an answer that arrives after the call's deadline while the module runs. A call whose usage is never reported SHALL keep counting its reservation, never zero, across restart. A call SHALL count on the day and month it was reserved. A new turn of a paid profile SHALL be refused with the capacity code and a detail naming the limit when what remains of today's limit or of the month's estimate is below the smallest reservation of its first call, 8,192 framing units at the model's dearest input price plus 16,384 output units at its output price; a call already sent SHALL finish. Synthetic calls and coding-worker runs SHALL not be counted. A model call outside a task SHALL record its spend through the same ledger. The module SHALL serve the day's and month's counted amounts, their limits and the count and amount of reservations without reported usage on a private content route without text, call or task identity, together with the paid model, where its prices come from with the built-in table's date, and its smallest call, and the page SHALL read it after each assistant-state revision, show today's spend against the daily limit and the month's figure labelled as an estimate with a line that the Anthropic Console holds the real monthly limit and spend, show where the paid model's prices come from, and show beside the composer why a paid profile's new message would be refused.

#### Scenario: Reservation then reported usage
- **WHEN** a hosted task's model call is in flight and then answers with reported usage
- **THEN** while in flight the day's spend counts the call's reservation as one call without reported usage, and afterwards it counts the reported usage priced by class and no unreported call

#### Scenario: Unreported and late usage
- **WHEN** one hosted call answers without usage and another passes its deadline, answers late with usage, and the runtime restarts
- **THEN** the first keeps counting its reservation, the second counts its late reported usage, and both amounts survive the restart

#### Scenario: Limit reached
- **WHEN** a conversation-level call has brought today's spend to $20.00
- **THEN** a new message to the hosted profile is refused with the capacity code and a detail naming the daily limit, no request is sent, a synthetic profile still starts a task, and after local midnight the day reads zero while the month keeps the amount

#### Scenario: A call already sent finishes
- **WHEN** other spend brings the day near its limit while a hosted call is in flight
- **THEN** that call's answer and its tool result are kept, the next model call is refused before dispatch, the task ends with the capacity code and the conversation names the daily limit

#### Scenario: No configured prices
- **WHEN** the hosted provider's section has no prices and the runtime starts
- **THEN** a hosted turn runs, its reported usage counts at the built-in price of 2026-11-22, a model the table does not know, even one named after an inherited member such as `constructor`, counts at the dearest known rate, and Details names where the prices come from

#### Scenario: Haiku prompt tier
- **WHEN** a `claude-haiku-5-5` call's input bound is 100,000 units and another's is 100,001, and their reported prompts, counting cache reads and writes, are 100,000 and 100,001 tokens
- **THEN** the first is reserved and settled at the lower tier and the second at the higher tier

#### Scenario: Remainder below the smallest call
- **WHEN** today's counted spend leaves one millionth of a dollar less than the smallest first call
- **THEN** a new message to the hosted profile is refused with the capacity code and a detail naming the daily limit, and no task starts

#### Scenario: Day and month boundaries
- **WHEN** a call is reserved at 23:59:59 local time and settles after midnight, and later the month turns over
- **THEN** the call counts on the earlier day and in its month, the new day starts at zero, and the new month starts at zero

#### Scenario: Configured monthly guard
- **WHEN** the hosted provider's section sets `assistant.monthlyLimit` to 200 and this month's counted spend on earlier days is $150, and later $200
- **THEN** the spend route and Details name a $200.00 monthly guard and the $20.00 daily limit, a new message at $150 is admitted and runs, and at $200 a new message is refused with the capacity code and a detail naming the $200.00 guard, and no request is sent

#### Scenario: Default and invalid monthly guard
- **WHEN** the section sets no monthly limit, or sets one of 0, 0.009, 10000.01, a string, null or an object
- **THEN** without one the guard is $150.00 and a month counted at $150 refuses a new message naming it, and each invalid value refuses the section with the invalid-request code and the detail naming `assistant.monthlyLimit` and its range from 0.01 to 10000
