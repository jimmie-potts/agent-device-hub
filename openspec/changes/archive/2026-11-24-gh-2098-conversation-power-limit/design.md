## Read path

The assistant engine follows the core's existing `power-limit` SDK copy
when a Wemo-capable read is configured. It joins by exact Wemo device ID
after the current device-selection rules resolve a single plug. Both reads
use the same formatter and the spend ledger's time zone. List reads retain
their device inventory behavior.

The SDK invalidates the view on restart or failure and owns replacement
sync. Retryable refusals use the shared capped SDK read backoff. Report
changes in availability through existing diagnostic vocabulary. Only the
process-local copy holds the core records. The existing conversation
transcript receives the bounded rendered read; it includes the policy facts
and times, with no command identity or raw reason text. Existing tool offers,
provider routing and conversation retention apply.

A successful read describes current policy independently of observed power.
A missing record in a complete copy means no configured limit. An invalidated
copy yields unknown. A receipt identifies the last attempt outcome and does
not establish that the plug turned off.
