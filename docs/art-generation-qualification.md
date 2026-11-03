# Art generation qualification

This record selects how B.U.N.N.Y. pays for and requests generated art, and
reserves the minimum interfaces for implementation. It installs no module or
schema. GitHub [#678](https://github.com/jimmie-potts/agent-device-hub/issues/678)
owns acceptance, and the owner decisions of 2026-11-03 on
[epic #677](https://github.com/jimmie-potts/agent-device-hub/issues/677) own the
policy. Trial images and observations stay private. Source, installed and physical
acceptance remain separate.

## Selected route

The owner replaced the subscription route with API credits on 2026-11-03. A new
shipped `modules/art` calls OpenAI's Image API with its own fetch, the way
`modules/companions` calls Anthropic. It needs no Mac worker, CLI or sign-in, and
it runs wherever the core runs. Claude may write the idea through the Messages API
with a separate named key. Providers sit behind one small interface, so either can
be replaced.

| Candidate | Authentication | Unattended | Output | Cancellation | Call accounting | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| OpenAI Image API, direct | API key file | Yes | Native raster bytes in the response | Abort the request; an effect may stand | One HTTP request per image request; usage to confirm in the trial | **Selected** |
| Anthropic Messages API, direct | API key file, already in the core's secrets | Yes | Text and structured JSON, no images | Abort the request | Reported tokens per request (`modules/companions/src/assistant/anthropic.ts`) | **Selected for ideas only** |
| Codex CLI `image_gen` on the ChatGPT login | Host login | Yes, from a Mac worker | Native raster, saved under `$CODEX_HOME` | Stop the process | Per-call item in the app-server schema; unobserved at runtime | Rejected: uses the plan rather than the selected credits, and needs a host worker and a new byte path to the core |
| Claude Code on the Max plan | Host login | Yes, from a Mac worker | Code and text; no image tool found in its CLI help | Stop the process | Turns only in the existing worker (`apps/runtime/src/worker/coding-worker.ts`) | Rejected: no native image output |
| Codex CLI logged in with an API key | Replaces the host login | Yes | Native raster | Stop the process | As the first Codex row | Rejected: changes the login other Codex work uses |

OpenAI requires
[API Organization Verification](https://developers.openai.com/api/docs/guides/image-generation)
before GPT Image models work, and the owner completes it in the developer console.
Blocked prompts return `moderation_blocked`, which is never retried automatically.
A complex prompt may take up to two minutes.

## Art jobs and results

One request is one row in the module's own SQLite store. It is durable before any
provider call and is never re-run after a restart.

```json
{
  "requestId": "req-1",
  "purpose": "request | ambient | appearance | variation",
  "origin": {"kind": "owner | schedule | weather", "reference": "optional"},
  "context": {"time": "evening", "season": "autumn", "weather": "rain, 48°F"},
  "targets": ["ui", "tidbyt", "pixoo"],
  "variationOf": "optional artwork id"
}
```

The location, personal data and credentials never appear in this row or a prompt.

A result is one artwork with separate provider calls and renditions:

```json
{
  "artworkId": "sha256 of the original bytes",
  "calls": [{"callId": "call-1", "provider": "openai", "model": "gpt-image-2", "status": "settled", "costMicros": 53000}],
  "renditions": [{"target": "tidbyt", "renditionId": "sha256", "width": 64, "height": 32, "frames": 1, "durationMs": 0, "format": "webp", "bytes": 1840}],
  "provenance": {"generatedBy": "openai", "promptHash": "sha256", "factual": false}
}
```

Provider calls never change an artwork's identity. Local renditions cost nothing.

| Case | Refusal or outcome | Spend | Effect |
| --- | --- | --- | --- |
| No key or unverified organization | Refused before any call, or `failed` with `unavailable` | None or settled from evidence | Saved art keeps playing |
| Over the daily pace or monthly ceiling | `rejected` before any call | None | Saved art keeps playing; the owner sees why |
| Moderation block or rate limit | `failed`, never re-sent | Settled at zero unless usage is reported | Nothing stored |
| Lost response or restart mid-call | `uncertain` | Reservation kept | Nothing stored; no resend |
| Invalid, missing or oversized output | `failed` before storage | Settled from usage, or reservation kept | Nothing stored |
| Extra model call for styling or an idea | Its own call row | Counted separately | Same artwork |
| A provider without image output | Refused by capability check | None | Nothing stored |

Codes come from the registry, records follow the
[diagnostic contract](observability-contract.md), and every provider call has a
span. Prompts and responses stay out of logs.

## Spending limits

The module owns one ledger in integer micro-dollars, per provider, per host-local
calendar month.

1. Before each call, reserve the worst-case cost of its model, quality and size
   from a price table in the module. An unknown price refuses the call.
2. Refuse when the reservation would pass the monthly ceiling ($150 by default,
   editable). Automatic work is also refused past the daily pace (about $5).
3. Refuse automatic work past about 30 images an hour.
4. Settle from the response's reported usage. A lost answer keeps its reservation
   as `uncertain`, and a later month starts new without erasing it.
5. Nothing retries automatically.

The reservation commits in one transaction, so concurrent requests cannot pass a
limit. Worked traces, each a required test:

| Trace | Result |
| --- | --- |
| Two concurrent requests with room for one | One reserves; the other is refused before any call |
| Idea call, then image call | Two rows and two costs |
| Provider failure after dispatch | Settled from evidence, with no resend |
| Restart with a call in flight | `uncertain`, reservation kept, no resend |
| Daily pace reached at noon | Automatic refused; owner requests continue; saved art plays |
| Monthly ceiling reached | All generation refused; saved art plays |
| Next local month | Limits restart; earlier uncertain rows remain visible |

## Exact-artwork handoff

The closed `moment-play/2.0` schema carries mood and palette, and no image. A module
may import only the SDK and contracts, so no module reads another's content, and
there is no shared asset store. The core already forwards allowlisted commands for
one named module (`apps/runtime/src/core/companion-part.ts`). The smallest handoff
uses that shape:

| Step | Producer | Consumer | Owner of the delta |
| --- | --- | --- | --- |
| Stage on Pixoo | `art` sends a core-forwarded `pixoo-asset-change` `import`, up to the existing 160 KiB inline limit | Pixoo library; no display effect; duplicates reuse the asset | [#1288](https://github.com/jimmie-potts/agent-device-hub/issues/1288) returns the native IDs |
| Stage on Tidbyt | `art` sends a new `tidbyt-art-stage` with a bounded WebP | Tidbyt store; no push | [#681](https://github.com/jimmie-potts/agent-device-hub/issues/681) |
| Show | `moment-play/2.1` adds an optional `art: {artworkId, renditionId}` | A device that cannot resolve it refuses before any effect | [#679](https://github.com/jimmie-potts/agent-device-hub/issues/679) |
| Ambient | `art` asks the owning module to replace its art tile | Tidbyt rotation; no takeover | [#681](https://github.com/jimmie-potts/agent-device-hub/issues/681) |
| Browser | Authenticated `content` refs on `art` | Dashboard | [#682](https://github.com/jimmie-potts/agent-device-hub/issues/682) |

Consumers of `moment-play/2.0` keep their behavior, because a moment without `art`
is unchanged and each module declares its support in its capabilities. Tracked
operations keep their payload, so inline art bytes would grow the tracker. #679 must
keep those bytes out of the stored operation, reusing ONN's omitted-payload approach
if it fits. An artwork referenced by an in-flight moment or a favorite cannot be
deleted, following Pixoo's existing `asset-referenced` refusal.

## Compositions

Each surface gets its own composition from one idea. A low target resolution says
nothing about the provider's minimum size: the API's documented minimum is 655,360
pixels, so device art is always downscaled locally.

- **Tidbyt, 64×32:** a bold subject on a plain ground, readable at a glance, no text.
- **Pixoo, 64×64:** a square scene with a large central subject and few colors.
- **Browser:** a richer, wide composition of the same idea that also suits a narrow
  card.

Gentle animation is generated locally from a still, costs nothing, and stays within
each device profile. The trial decides each surface's quality setting.

## Live trial

- **Owner and account:** the owner's OpenAI API account, with a dedicated key held
  outside Git.
- **Allowed effects:** private images under the main checkout's `.local/evidence/`,
  and local downscaling. No device contact, runtime change or installed secret.
- **Observe:** response fields for cost accounting, latency, moderation behavior and
  readability at 64×32 and 64×64 for low and medium quality.
- **Stop when:** the organization is unverified, a request is blocked twice, or the
  trial reaches $2.
- **Evidence:** this record states the findings; images stay private.

**Status:** not run. The key is not yet available.
