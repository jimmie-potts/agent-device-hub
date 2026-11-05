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
shipped `modules/art`, owned by
[#680](https://github.com/jimmie-potts/agent-device-hub/issues/680), calls OpenAI's
Image API with its own fetch, the way `modules/companions` calls Anthropic. It needs
no Mac worker, CLI or sign-in, and it runs wherever the core runs. Claude may write
the idea through the Messages API. The module's private section names the same key
file that companions already uses, under `secrets.anthropic-api-key`. Providers sit
behind one small interface, so either can be replaced.

A route must report what each request consumed. A route whose calls cannot be
observed or bounded is unsuitable, however good its images are.

| Candidate | Authentication | Unattended | Output | Cancellation | Limits | Call accounting | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [OpenAI Image API](https://developers.openai.com/api/docs/guides/image-generation), direct | API key file | Yes | Native raster bytes in the response | Abort the request; an effect may stand | Credit balance and the organization's rate tier; the tier was not read | `usage` on each response, observed in the trial | **Selected** |
| Anthropic Messages API, direct | The existing API key file | Yes | Text and structured JSON, no images | Abort the request; an effect may stand | Credit balance and the organization's rate tier; the tier was not read | Reported tokens per request (`modules/companions/src/assistant/anthropic.ts`) | **Selected for ideas only** |
| Codex CLI `image_gen` on the ChatGPT login | Host login | Yes, from a Mac worker | Native raster, saved under `$CODEX_HOME` | Stop the process | Plan usage; not stated by the CLI | Per-call item in the `codex app-server generate-json-schema` output; unobserved at runtime | Rejected: uses the plan rather than the selected credits, and needs a host worker and a new byte path to the core |
| Claude Code on the Max plan | Host login | Yes, from a Mac worker | Code and text; `claude --help` shows no image tool | Stop the process | Plan usage; not stated by the CLI | Turns, cost and duration from the final envelope (`apps/runtime/src/worker/coding-worker.ts`), with no per-request count | Rejected: no native image output, and requests are not observed |
| Codex CLI logged in with an API key | Replaces the host login | Yes | Native raster | Stop the process | Credit balance | As the first Codex row | Rejected: changes the login other Codex work uses |

Third-party image tools were not considered, because the owner selected these two
accounts. Procedural art is local code, not a provider: it costs nothing and needs
no route.

OpenAI requires API Organization Verification before GPT Image models work, and the
owner completes it in the developer console. Blocked prompts return
`moderation_blocked`, which is never retried automatically. A complex prompt may take
up to two minutes.

## Art jobs and results

One request is one row in the module's own SQLite store. It is durable before any
provider call and is never re-run after a restart.

```json
{
  "requestId": "req-1",
  "purpose": "request | ambient | appearance | variation",
  "origin": {"kind": "owner | schedule | weather", "reference": "optional"},
  "text": "the owner's typed request, when there is one",
  "context": {"time": "evening", "season": "autumn", "weather": "cold rain"},
  "targets": ["ui", "tidbyt", "pixoo"],
  "variationOf": "optional artwork id"
}
```

The location, personal data and credentials never appear in this row or a prompt.
Weather reaches a prompt as condition words only.

A result is one **artwork**, which is one idea. The module mints its `artworkId`. Each
target gets its own **composition**, whose immutable `compositionId` is the SHA-256 of
the bytes that define it: the generated still, the returned GIF, or a locally animated
result. Each composition has local **renditions**. Three
image calls for one idea therefore give one artwork and three compositions. A
device refers to a composition, never to an artwork alone.

The module decides whether a job is the owner's or automatic from the command family
that admitted it, never from `origin` or `purpose`. Every tracked command reaches a
module from the core, so its source cannot tell them apart. `art-request` is the
owner's, and the tracker accepts it only when `requestedBy` is the dashboard's source.
`art-auto` is automatic, and only the core can send it. A mislabelled request or
another client therefore cannot escape the automatic limits.

```json
{
  "artworkId": "art-1",
  "outcome": "succeeded | partial | failed | uncertain | rejected | cancelled",
  "palette": ["#101828", "#F4A261"],
  "calls": [{"callId": "call-1", "target": "tidbyt", "provider": "openai", "model": "gpt-image-2", "status": "settled", "reservedMicros": 90000, "costMicros": 3000}],
  "compositions": [{
    "target": "tidbyt",
    "compositionId": "sha256",
    "outcome": "succeeded",
    "promptHash": "sha256",
    "renditions": [{"renditionId": "sha256", "width": 64, "height": 32, "frames": 1, "durationMs": 0, "format": "png", "bytes": 1840}]
  }],
  "provenance": {"generatedBy": "openai", "factual": false}
}
```

Each target succeeds or fails alone. An artwork is `partial` when at least one target
succeeded and another did not, whether that one failed or is uncertain. It is
`uncertain` when none succeeded and any is uncertain, and `failed` when none succeeded
and none is uncertain, unless the next rule applies.
An artwork is `rejected` or `cancelled` only when every target was. These are the art
job's own results. The command that admitted the job has already completed with its own
outcome.
Local renditions and playback cost nothing. Palette values are
validated data for [#683](https://github.com/jimmie-potts/agent-device-hub/issues/683).

| Case | Refusal or outcome | Spend | Effect |
| --- | --- | --- | --- |
| No key | Refused before any call | None | Saved art keeps playing |
| Over a spending limit | `rejected` before any call | None | Saved art keeps playing; the owner sees why |
| Cancelled before dispatch | `cancelled` | Reservation released | Nothing stored |
| Cancelled or timed out after dispatch | `uncertain` | Reservation kept | Late bytes are discarded; no resend |
| 4xx answer: unverified organization, moderation, rate limit | Provider call `failed`, never re-sent | Reported usage, otherwise zero | No provider output stored; a non-moderation display failure may use the local fallback below |
| 5xx answer without usage | `uncertain` | Reservation kept | Nothing stored; no resend |
| Lost response or restart mid-call | `uncertain` | Reservation kept | Nothing stored; no resend |
| Invalid, missing or oversized output | Provider output rejected before storage | Reported usage, otherwise reservation kept | No provider output stored; a display may use the local fallback below |
| A display's GIF is wrong or undecodable, or the call definitely failed with a non-moderation 4xx | `succeeded` with local motion, naming why; a moderation refusal stays `failed` | As the rows above; a wrong GIF still counts as spent | Free local animation for that target; no resend. A generic refusal does not establish preview eligibility |
| Extra model call for styling or an idea | Its own call row | Counted separately | Same artwork |
| A provider without image output | Refused by capability check | None | Nothing stored |
| One of three targets fails | `partial` | Each call on its own terms | The others are stored |

Codes come from the registry, records follow the
[diagnostic contract](observability-contract.md), and #680 registers the provider
call's span name there. Prompts and responses stay out of logs.

## Spending limits

The module owns one ledger in integer micro-dollars, per host-local calendar month.
OpenAI and Claude each have their own limit set (owner decision, 2026-11-03), and each
row names its provider. One provider reaching a limit does not stop the other. The
loop guard stays a single count across both.

1. Bound each call before sending it: at most 4,000 characters of prompt, and a fixed
   `max_tokens` for text. A variation uses the saved idea and the owner's requested
   change as text; it sends no input image.
2. Reserve its worst case from a price table in the module, keyed by provider, model,
   quality and size. An image entry is twice the largest output observed for that
   entry, plus its bounded input at the listed price. A text entry is its `max_tokens`
   and its bounded input at the listed price, which needs no observation. An unknown
   entry refuses the call, so an image size, quality or input image no one has observed
   cannot run until it is added.
3. Refuse when the reservation would pass its provider's monthly ceiling ($150 by
   default, editable). Automatic work is also refused past that provider's daily pace
   (about $5). The pace counts everything the provider's calls hold that day.
4. Refuse automatic work past 30 dispatched calls in any rolling 60 minutes, counting
   failed and uncertain ones. Owner requests are not limited by this guard.
5. Settle from the response's reported usage. A kept reservation stays as `uncertain`
   spend and is not refunded; a later month starts new without erasing it.
6. A settlement above its reservation records the true cost. The ceiling can therefore
   be passed by one call's excess at most per concurrent call, and everything is then
   refused until the next month. The excess is shown and logged as a price table fault.
7. Nothing retries automatically.

The reservation commits in one transaction, so concurrent reservations cannot pass a
limit. The dashboard reads spent, reserved, uncertain and remaining amounts per provider
from the module's state. Worked traces, each a required test in #680:

| Trace | Result |
| --- | --- |
| Two concurrent requests with room for one | One reserves; the other is refused before any call |
| Idea call, then three image calls | Four rows and four costs, each against its own provider's limits; one artwork, three compositions |
| Claude and OpenAI spend near their ceilings | Each decides alone; the provider at its ceiling refuses, and the other keeps working |
| Second target refused at the ceiling after the first succeeds | `partial`; the first composition is kept |
| Provider failure after dispatch | Settled as in the case table, with no resend |
| Restart with a call in flight | `uncertain`, reservation kept, no resend |
| Daily pace reached at noon | Automatic refused; owner requests continue; saved art plays |
| A thirty-first automatic call in 60 minutes | Refused; it succeeds once the window has room and the pace allows |
| Settlement above its reservation near the ceiling | True cost recorded, fault logged, later calls refused |
| `art-auto` with an owner label in its payload | Treated as automatic; the pace and guard apply |
| A client sends `art-auto` | Refused by the gateway; nothing is admitted |
| A client other than the dashboard sends `art-request` | Refused by the tracker; nothing is admitted |
| Monthly ceiling reached | All generation refused; saved art plays |
| Next local month | Limits restart; earlier uncertain rows remain visible |

## Exact-artwork handoff

The closed `moment-play/2.0` schema carries mood and palette, and no image. A module
may import only the SDK and contracts, so no module reads another's content, and
there is no shared asset store. The core already forwards allowlisted commands for
one named module (`apps/runtime/src/core/companion-part.ts`). The handoff reuses that
shape, and the core's validator must know each forwarded family, so the families
below live in `packages/event-contracts`.

Devices do not report native IDs back. Each device maps the art module's
`compositionId` to its own media. Pixoo's rendition IDs come from its renderer, so
they never leave the module.

| Step | Producer | Consumer | Owner of the delta |
| --- | --- | --- | --- |
| Contracts and forwarding | `modules/art` sends `art-dispatch` | Core part accepts it from `bunny/modules/art` only and forwards tracked `art-stage` and `art-ambient-set` commands, never `moment-play` | [#679](https://github.com/jimmie-potts/agent-device-hub/issues/679) |
| Request | The dashboard sends `art-request` for the owner, and the core automation path under #684 sends `art-auto` for ambient and appearance art, each through the tracked command route. The owner cancels any job, automatic or not, with `art-request`; a cancel admits no work | `modules/art` commits the row and a `succeeded` outcome with `observed` evidence in one transaction, as `assistant-input` does (`modules/companions/src/assistant/engine.ts`). The tracked effect is durable admission, because a provider call can outlast the 30 s device deadline; job results appear in its `art` state | #679 family, #680 handler |
| Stage | `modules/art` sends `art-stage`: `compositionId`, format (PNG or GIF), dimensions, frames, hash, up to 160 KiB of bytes, lifetime | Pixoo or Tidbyt validates and keeps a private copy, in its own format; no display effect; duplicates reuse it | Pixoo [#1288](https://github.com/jimmie-potts/agent-device-hub/issues/1288), Tidbyt [#681](https://github.com/jimmie-potts/agent-device-hub/issues/681) |
| Stage finished | Core operation record for that `requestId` | `modules/art` shows nothing until it reads `succeeded`; #679's fixture proves a module can read it | #679 |
| Show | Only the core automation path sends it, after arbitration, owned by [#684](https://github.com/jimmie-potts/agent-device-hub/issues/684): `moment-play/2.1` with optional `art: {compositionId}`. `modules/art` offers candidates in its state and cannot start a takeover. An owner's "show now" enters this same path, ahead of the schedule, and still yields to attention and to a pin the owner set | The device plays its private copy, or refuses an unknown or expired reference before any effect | Schema #679; playback Pixoo [#1287](https://github.com/jimmie-potts/agent-device-hub/issues/1287) and #1288, Tidbyt [#337](https://github.com/jimmie-potts/agent-device-hub/issues/337) and #681 |
| Capability | Each device declares `moments.art` in its `device` record | `commandSupported` refuses a moment with `art` for a device without it, so Nanoleaf does not play its mood instead | #679 |
| Ambient | `modules/art` sends `art-ambient-set` with a `compositionId`, or clears it | Tidbyt's art tile in its rotation; no takeover | #681 |
| Browser and theme | Authenticated `content` refs and an `art` state record | Dashboard widget, gallery, spend and theme palette | #680 supplies; [#682](https://github.com/jimmie-potts/agent-device-hub/issues/682) and #683 consume |

Consumers of `moment-play/2.0` keep their behavior, because a moment without `art` is
unchanged. Staged copies have a bounded lifetime and do not enter Pixoo's permanent
library; saving a favorite is an explicit, separate import. A device holds its own
copy and never expires it during a moment, so neither deletion nor expiry can remove
media from an in-flight moment. An expired reference is refused truthfully.

A display composition has exactly one rendition, and `compositionId` is the device's
key. An animated version is its own composition. Staging the same ID and hash again
reuses the copy and renews its lifetime; the same ID with a different hash is refused.
Staging is local and free, so `modules/art` stages saved art again before offering it
and renews an ambient tile's copy, and saved art keeps working when generation pauses.

This replaces the native rendition IDs that #1288's text asks to return. #1288 keeps
its validation, provenance and reference safety, and takes the `compositionId` mapping
instead.

#679 also owns three protections for the art families:

- **Tracker size:** tracked operations keep their payload, and art bytes must not grow
  the tracker. #679 generalizes the omitted-payload path that ONN text uses in
  `apps/runtime/src/core/tracker.ts`. An omitted command cannot be resent.
- **Inbox:** `art-auto`, `art-stage` and `art-ambient-set` are routine background work,
  so their failures do not raise shared inbox items. This needs its own exemption in
  `apps/runtime/src/core/inbox.ts`, beside the one for operator actions, and an
  amendment to ADR 0012, which sends failed and uncertain device commands to the inbox.
  Per-target results appear in the `art` state.
- **Direct access:** the gateway refuses these three families from any client, as it
  does `reachy-auto`. The tracker also checks `requestedBy`, as it does for speech:
  `bunny/core` for `art-auto`, and `bunny/modules/art` for the forwarded `art-stage`
  and `art-ambient-set`.

## Compositions

Each surface gets its own composition from one idea. A low target resolution says
nothing about the provider's minimum size: the API's documented minimum is 655,360
pixels, so device art is always downscaled locally.

- **Tidbyt, 64×32:** a bold subject on a plain ground, readable at a glance, no text.
- **Pixoo, 64×64:** a square scene with a large central subject and few colors.
- **Browser:** a richer, wide composition of the same idea that also suits a narrow
  card.

Displays get a GIF, by owner decision on 2026-11-04, and the browser gets a still. Every
display job uses `gpt-image-2.6-flare` at low quality with `output_format: "gif"`, 8 frames
of 200 ms, at 512×512 for Pixoo or 512×256 for Tidbyt. The browser uses `gpt-image-2` at
medium quality, 1536×1024.

- **Requests:** `POST /v1/images/generations` with `frame_count` and `frame_duration_ms`.
  The API accepted 2 to 16 frames and refused 32, although its guide says 64. `size` is in
  multiples of 16, and the default `auto` returned 512×512. Streaming, partial images,
  `output_compression` and `prompt_rewriter` are not supported. GIF output is a preview and
  no dated model version is listed.
- **One look:** the API cannot animate an existing image, so a GIF is always a separate
  drawing. One idea drives every target. The browser keeps its own still, because a frame
  of a 512-pixel GIF would look soft on a 1536-pixel card. Its palette themes the artwork,
  and it is what a display's free fallback moves, so a fallback keeps the artwork's look.
- **Reduction:** #680 decodes each GIF under its bounded limits, checks its size, its frame
  count and timing inside Pixoo's observed envelope (at most 20 frames, 100 to 800 ms), then
  reduces each frame with Lanczos and rebuilds one GIF with 32 colors and uniform timing.
- **Fallback:** a wrong or undecodable GIF still counts as spent. With a preview refusal or
  another definite failure, it falls back to free local motion with no resend, from the
  artwork's browser still or else procedural art. A moderation refusal stands, and an
  unknown outcome stays uncertain. The state counts accepted and rejected GIFs, which
  measures the rejection rate.

#1288 admits the GIF under Pixoo's existing limits, and the Tidbyt module, under #681,
converts it to animated WebP. Its encoder writes stills today, so #681 adds GIF decoding and
animated encoding.

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

**Result, 2026-11-03:** six `gpt-image-2` requests all succeeded, none blocked, for
about $0.17.

| Purpose | Size | Quality | Latency | Output tokens | Output cost |
| --- | --- | --- | --- | --- | --- |
| Pixoo | 1024×1024 | low | 16 s | 196 | $0.006 |
| Pixoo | 1024×1024 | medium | 39 s | 1,756 | $0.053 |
| Tidbyt | 1536×768 | low | 14 s | 102 | $0.003 |
| Tidbyt | 1536×768 | medium | 24 s | 916 | $0.027 |
| Browser | 1536×1024 | medium | 32 s | 1,372 | $0.041 |
| Six-frame sprite sheet | 1536×1024 | medium | 27 s | 1,372 | $0.041 |

- **Accounting holds:** each response reports `usage` with input and output token
  counts split into text and image. One request produced one image, so spend can be
  settled per call. Input text adds about $0.0006 per request at $5 per million.
- **Quality:** low is enough for both displays. At 64×64 and 64×32, reduced with
  Lanczos to a 32-color palette, the low images read as well as the medium ones, and
  the subject stays recognizable. Nearest-neighbor reduction adds speckle, so it is
  not selected. Medium suits the browser composition.
- **Cost per idea:** about $0.05 for browser, Pixoo and Tidbyt stills. With GIFs for both
  displays it is about $0.08, before the idea call.
- **Animation:** this sheet route is replaced by the GIF result below.

**Result, 2026-11-04:** GIF output on the owner's key. One request was refused, for
asking 32 frames, and four GIFs came back for about $0.10. Each response reported `usage`,
at $5 per million text input tokens and $30 per million image output tokens for both
models, so a call settles from it. The trial reported cost, so each price table entry
reserves twice the output tokens that whole cost would buy.

| Model and quality | Frames and size | Time | Cost | Reduced size |
| --- | --- | --- | --- | --- |
| Flare, low | 8, 512×512 | 9 s | $0.017 | 7.8 KB at 64×64 |
| Flare, medium | 8, 512×512 | 10 s | $0.030 | 7.8 KB at 64×64 |
| Sunburst, medium | 8, 512×512 | 21 s | $0.030 | 8.5 KB at 64×64 |
| Flare, low | 8, 512×256 | 10 s | $0.025 | 6.3 KB at 64×32 |

Flare at low quality serves automatic and owner art alike: the reduced results did not
differ in size, and Sunburst took twice as long for the same price. Its entry stays in
the price table for a later choice. The reduced sizes come from one prompt, and they are
about 5% of the 160 KiB stage limit.

- **Not established:**
  - Picture quality of GIFs on the physical panels.
  - Moderation and rate-limit answers were not exercised. They do not block #680:
    the case table treats them as failures with no resend, and #680 tests them with a
    fake provider.
  - The physical panels, including animated WebP on the Tronbyt firmware, belong to
    [#687](https://github.com/jimmie-potts/agent-device-hub/issues/687).
