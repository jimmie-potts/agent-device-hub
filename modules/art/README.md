# Art

This shipped module creates B.U.N.N.Y.'s generated art and keeps its private catalog and
spending ledger. It calls OpenAI's Image API to draw and Claude to write ideas, with its
own fetch, so it needs no worker, CLI or sign-in. [The qualification
record](../../docs/art-generation-qualification.md) owns the route, the limits and the
handoff. This guide says how the module applies them. Source tests use fake providers;
real generation and the physical panels belong to
[#687](https://github.com/jimmie-potts/agent-device-hub/issues/687).

## Private configuration

Give `modules.art` this section in the runtime's private configuration. Every member is
optional, and the values below are the defaults, apart from the key files:

```json
{
  "limits": {
    "openai": {"monthlyCeilingUsd": 150, "dailyPaceUsd": 5},
    "anthropic": {"monthlyCeilingUsd": 150, "dailyPaceUsd": 5}
  },
  "recentLimit": 200,
  "secrets": {
    "openai-api-key": "/run/secrets/bunny/openai-api-key",
    "anthropic-api-key": "/run/secrets/bunny/anthropic-api-key"
  }
}
```

Edit a limit here; it takes effect at the next start. The Anthropic key file is the one
companions names. A key is read once at start and sent only as its request header. A
provider with no key refuses its calls, and the module still starts, so saved art keeps
playing. Without Claude, a request uses the owner's words or an imagined scene as its
idea. Without OpenAI, nothing new is drawn apart from procedural art.

## Jobs and results

One admitted request is one durable row, committed with a `succeeded`, `observed`
outcome in one transaction, because a provider call can outlast the device deadline. The
outcome says the row was saved. The art's result appears in the `art` state. A job never
re-runs after a restart.

Each job gets one artwork and one image call per target. Each target succeeds or fails
alone, and the record's rules derive the artwork's outcome.

| Target | Size and quality sent | Local result |
| --- | --- | --- |
| Tidbyt | 1536×768, low | One 64×32 PNG, or a GIF, with at most 32 colors |
| Pixoo | 1024×1024, low | One 64×64 PNG, or a GIF, with at most 32 colors |
| Browser | 1536×1024, medium | Two WebP renditions |
| Animated display | 1536×1024, medium | Six-frame GIF from a sprite sheet |

A sheet with misaligned cells or too much change between frames is rejected. It still
costs its call, and the art falls back to local motion. The state counts accepted and
rejected sheets, which is how installed use measures the rejection rate. A variation
builds on its source's idea and sends no input image, since no input image has a price
entry. Procedural art reaches no provider.

## Spending

The ledger follows the record's rules in integer micro-dollars. OpenAI and Claude each
have their own ceiling and pace. The 30-call loop guard is one count across both. The
price table is `src/prices.ts`: a call with no entry is refused, so adding a size,
quality or model starts there. Nothing retries. A lost response keeps its reservation as
uncertain spend, and a later month starts new without erasing it. Every call's row stays
in the ledger.

## Prompts and privacy

A prompt holds only the owner's typed text, an imagined scene, time, season and weather
condition words. Stale or missing weather is left out, so the art claims nothing about
it. The job row has no field for a location or personal data. Art is never presented as
fact: provenance always says `factual: false`. Prompts, responses and keys stay out of
state and logs. Images and prompts stay in the module's private store, outside Git and
GitHub.

## What it offers others

- **State:** `art/2.0` on `bunny.state.art.art`, read with `sdk.sync(['art'], …)`. It holds
  spent, reserved, uncertain and remaining amounts per provider, recent jobs and
  artworks, staged candidates and retained copies.
- **Content**, at `/modules/art/content/<ref>`, for an authenticated reader:

  | Reference | Answer |
  | --- | --- |
  | `catalog` | Saved artworks, newest first; query `after` and `limit` (at most 100) |
  | `ledger` | Every call, oldest first; query `after` and `limit` (at most 100) |
  | `artwork.<artworkId>` | One artwork's result, with its calls |
  | `rendition.<renditionId>` | The bytes of one rendition |

- **Span:** `bunny.art.call`, diagnostic profile 1.8.

## Retention and deletion

Recent art past `recentLimit` is pruned oldest first, unless it is a favorite or a device
may hold a staged copy. Favorites stay until deleted. Deleting removes art from selection
at once. If a device may still hold a copy, the row and bytes stay until that copy's
lifetime ends, and the state's `retention.retained` reports it. The module cannot reach
into a device's own store. Feedback is explicit: `more` raises a candidate, `less` and
`dismiss` remove it, and silence changes nothing.

## Seams to wire

`src/seams.ts` holds what is not on `main` yet. Each has an unwired default, so the shipped
module admits no command and offers nothing until it is wired in `src/registration.ts`:

| Seam | Owner | What it binds |
| --- | --- | --- |
| `ArtCommandSeam` | [#679](https://github.com/jimmie-potts/agent-device-hub/issues/679) | `art-request` and `art-auto` to the owner and automatic handlers |
| `ArtDispatchSeam` | #679 | `art-dispatch`, for `art-stage` and `art-ambient-set`, and the core's operation record back |
| `WeatherSeam` | [#1418](https://github.com/jimmie-potts/agent-device-hub/issues/1418) | Condition words from the `weather-state` record, and when they go stale |

The family that admits a job decides whether it is the owner's or automatic, never its
payload. Refusing `art-auto` from a client and `art-request` from anything but the
dashboard happens in the gateway and tracker, under #679. Two unfinished tests in
`tests/traces.test.ts` name those traces.

## Checks

Use Node 24. Run `npm run test:art`, or build once and run `npm run test:art:built`. See
[Art checks](../../docs/development.md#art-checks).
