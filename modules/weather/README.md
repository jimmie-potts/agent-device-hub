# Local weather

This shipped module gives B.U.N.N.Y.'s art a truthful view of one location. It reads
the National Weather Service API, which needs no key, and publishes one synced
record. It has no other provider and takes no command. Weather alerts may inspire a
labelled piece of art, but this is not a safety alert system and never replaces an
official warning channel.

## Private configuration

Give `modules.weather` this section in the runtime's private configuration:

```json
{
  "latitude": 12.3456,
  "longitude": -65.4321,
  "contact": "operator@example.invalid"
}
```

This is a synthetic example. Enter the actual values privately. The coordinates go
only to the service, in its URLs, and `contact` goes only to the service, in the
User-Agent it asks clients to send. Neither enters state, logs, prompts or the
module's database. A location outside the service's coverage is reported as
`outside-coverage`. Without a section the module reports the ordinary absent state
and contacts nothing.

## What it publishes

The family is `weather-state`, schema `https://bunny.invalid/events/weather-state/2.0`,
on the routing key `bunny.state.weather-state.local`. Consumers read it with
`sdk.sync(['weather-state'], …)` and follow live state from there. A record is one
of two shapes:

- `available`: `observedAtMs` (when the module read it), `staleAtMs`, `ageMs`,
  `forecastUpdatedAtMs` (the service's own update time), `current` and up to 12
  following hours in `forecast`, `alerts`, and `words`.
- `unavailable`: `reason` (`starting`, `outage`, `rate-limited`, `outside-coverage`,
  `malformed` or `stale`), `observedAtMs` and `ageMs` of the last observation or
  `null`, and no weather values.

`current` is the service's forecast for this hour, not a station measurement. `ageMs`
is the age when the record was written or a sync served it; `observedAtMs` gives the
age at any later time. An hour's `condition` comes from a closed vocabulary (`clear`,
`clouds`, `fog`, `haze`, `rain`, `thunderstorm`, `snow`, `mixed`, `wind`, `other`), and
`likely` is false when the forecast gives only a chance of it. An alert carries its
event, severity and end, never its area, headline, sender or description. The event
comes from a closed list of the service's national names, and an unlisted name is
published as `Weather Alert` rather than quoted.

Build a prompt only from `promptWords(state, nowMs)`, which returns words such as
`rain`, `48°F`, `evening` for this hour, and `forecastWords(state, nowMs)`, which
returns the same words for each forecast hour. Both return nothing for an unavailable
or stale record. No words means no factual claim: art labels what it invents as
fiction. A labelled piece inspired by an alert may also use `alerts[].event`, from a
record `promptWords` still has words for.

When the conditions really change, the module also publishes one occurrence on
`bunny.event.weather-changed.local`, schema
`https://bunny.invalid/events/weather-changed/2.0`, naming which of `condition`,
`temperature` (10°F or more since the last signal) and `alerts` changed, with the
current words. Polling the same conditions, an outage, a restart, the first observation
and wording outside the vocabulary signal nothing. Occurrences are not replayed, so a consumer that was down
reads the current state instead.

## Polling and failures

One loop reads every 15 minutes, with each read bounded to 30 seconds. A failure backs
off from one minute to at most an hour, and honours the service's `Retry-After`
within that cap. A vendor fault is `unavailable` state, never a module failure. A
repeated fault publishes nothing further, and it logs one degradation, minute-bounded
summaries and one recovery. A record is stale 45 minutes after its observation. A
forecast the service itself last updated more than a day ago, or that does not cover
this hour, is `stale`.

A failed alert read makes the whole read unavailable, because an empty list would
claim there are no alerts. A restart publishes `starting` until its first read, so no
old weather is republished as current.

## Verification

See [Weather checks](../../docs/development.md#weather-checks). Source tests use
synthetic coordinates and responses through a fake transport and never reach the
service. The real-service check and any installed result belong to #687.
