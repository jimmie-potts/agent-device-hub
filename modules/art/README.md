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
idea. Without OpenAI, nothing new is drawn.

## Jobs and results

One admitted request is one durable row, committed with a `succeeded`, `observed`
outcome in one transaction, because a provider call can outlast the device deadline. The
outcome says the row was saved. The art's result appears in the `art` state. A job never
re-runs after a restart.

Each job gets one artwork and one image call per target. Each target succeeds or fails
alone, and the record's rules derive the artwork's outcome.

| Target | Model, size and quality | Local result |
| --- | --- | --- |
| Tidbyt | `gpt-image-2.6-flare`, 512×256, low, 8-frame GIF | One 64×32 GIF with at most 32 colors |
| Pixoo | `gpt-image-2.6-flare`, 512×512, low, 8-frame GIF | One 64×64 GIF with at most 32 colors |
| Browser | `gpt-image-2`, 1536×1024, medium | Two WebP renditions |

A returned GIF is decoded under bounded limits and checked for its size, its frame count
and timing inside Pixoo's observed envelope, then reduced frame by frame with Lanczos and
rebuilt with one palette and uniform timing. A wrong or undecodable GIF still costs its
call. That result or a definite provider failure falls back to free
local motion with no resend, from the artwork's browser still when it has one and otherwise
procedural art; the target names why. A moderation refusal stands, and an unknown outcome
stays uncertain. The state counts accepted and rejected GIFs, which is how installed use
measures the rejection rate. A variation builds on its source's idea and sends no input
image: GIF output works on generation only, and no input image has a price entry.
Generic provider refusals do not identify a preview-access problem; the result reports
`provider-refused` unless the provider establishes a more specific supported reason.
Sunburst is permitted for owner requests but is not selected by this implementation.
Procedural art is available only as a failed display call's free fallback.

## Spending

The ledger follows the record's rules in integer micro-dollars. OpenAI and Claude each
have their own ceiling and pace. The 30-call loop guard is one count across both. The
price table is `src/prices.ts`: a call with no entry is refused, so adding a size,
quality or model starts there. Nothing retries. A lost response keeps its reservation as
uncertain spend, and a later month starts new without erasing it. Every call's row stays
in the ledger.

## Prompts and privacy

A prompt holds only the owner's typed text, an imagined scene, time, season and weather
condition words. Weather copied from the live source retains its expiry privately and
is rechecked before every provider call. Stale or missing observations are left out.
Weather explicitly supplied in a request is labelled requested inspiration, rather than
an observation of current conditions. The job row has no field for a location or personal data. Art is never presented as
fact: provenance always says `factual: false`. Prompts, responses and keys stay out of
state and logs. Images and prompts stay in the module's private store, outside Git and
GitHub.

Automatic starts in `art-auto/2.2` can choose `weatherUse: current` or `omit`.
`current` reads fresh condition words again before each paid call, ignoring supplied
weather inspiration. `omit` makes no job weather reads and includes no weather
context. An omitted policy and owner requests keep their existing behavior. The
same spending ledger, pace, loop guard and no-retry rules apply to both choices.

## What it offers others

- **State:** `art/2.1` on `bunny.state.art.art`, read with `sdk.sync(['art'], …)`. It holds
  spent, reserved, uncertain and remaining amounts per provider, recent jobs and
  artworks, staged candidates and retained copies.
- **Content**, at `/modules/art/content/<ref>`, for an authenticated reader:

  | Reference | Answer |
  | --- | --- |
  | `catalog` | Saved artworks, newest first; query `after` and `limit` (at most 100) |
  | `ledger` | Every call, oldest first; query `after` and `limit` (at most 100) |
  | `artwork.<artworkId>` | One artwork's result, creation time and calls |
  | `rendition.<renditionId>` | The bytes of one rendition |

- **Span:** `bunny.art.call`, diagnostic profile 1.8.

## Retention and deletion

Recent art past `recentLimit` is pruned oldest first, unless it is a favorite or a device
may hold a staged copy. Favorites stay until deleted. Deleting removes art from selection
at once. If a device may still hold a copy, the row and bytes stay until that copy's
lifetime ends, and the state's `retention.retained` reports it. The module cannot reach
into a device's own store. Feedback is explicit: `more` raises a candidate, `less` and
`dismiss` remove it, and silence changes nothing.
Ambient selection names one durable stage request. A late result or renewal cannot
restore deleted or superseded art, and a receipt never extends the staged copy's lifetime.
The last issued tile selection is stored separately, so deletion can clear it while
a renewal or replacement is pending, including after restart. Issuing a tile command
does not prove that a physical display showed it.
Stage conflicts identify that exact issued stage, so old evidence cannot clear a
newer renewal. A definite dispatch refusal preserves the preceding selection;
an unknown dispatch remains unknown and is not retried.
Ambient admissions run one at a time and recheck selection before dispatch. Stop
drops unsent work; restart does not replay it. Generation and staging remain concurrent.
Conflicting stage evidence withdraws its candidate.

Browser selection retains one exact artwork and composition independently of the
recent catalog window. It survives pruning and restart until replaced or explicitly
deleted. Selection commits no display effect and does not claim that a browser
decoded the image. The private `art_browser_selection` table holds this pointer.

## Commands and boundaries

`src/seams.ts` holds the module's boundaries. A responder admits only `bunny/core`
(`artCommandRefusal`), and the gateway and tracker refuse earlier.

| Family | Sender | What it does |
| --- | --- | --- |
| `art-request` | The dashboard, through the tracked route | Starts a job, or cancels any job |
| `art-auto` | The core's automation only | Starts an automatic job; 2.1 prepares saved art or selects its browser composition; 2.2 also selects saved Tidbyt ambient art |
| `art-catalog-edit` | The dashboard, through the tracked route | Favorite, feedback, delete, or reuse saved art |
| `art-dispatch` | This module, to the core | Forwards `art-stage` and `art-ambient-set` |

The family that admits a job decides whether it is the owner's or automatic, never its
payload. Generation outcomes report durable job admission. A stage is offered only after the core's
`operation` record says it succeeded, and a restart resends nothing: the record can still
settle a stage left uncertain.

`art-auto/2.1` preparation names the saved artwork, exact composition and configured
display ID. It performs no provider call and starts no moment. Admission commits a
private preparation before staging; its successful outcome waits for the tracked
child stage to succeed. Failure and uncertainty retain their separate meanings.
Conflicting staging evidence gives the parent both definitive outcomes, so its
operation remains in conflict. Restart marks pending preparations uncertain and
never stages again. The additive `art_preparations` table retains at most eight
pending rows and 1,000 terminal rows; retained rows keep ownership of their request
IDs after the ordinary 30-day admission receipt expires.

The `ambient` action in `art-auto/2.2` stages an exact saved Tidbyt composition
for its exact configured target, without calling a provider, changing modes or
starting a moment. The core supplies a one-use opportunity reference, retained
only in memory. After staging succeeds, Art sends the initial selection through
`art-dispatch/2.1`; the core checks and consumes that reference at forwarding.
Admission alone is not success. The parent's successful outcome waits for both
staging and the tracked ambient child to succeed. It establishes the issued
selection, never physical visibility. Refusal, failure and uncertainty remain
distinct; child operation IDs stay in the private preparation record.

A pending replacement does not replace the renewable intent. A definitive
selection refusal restores the preceding intent; an accepted or uncertain issued
selection retains its exact composition and target across restart. Failed
predecessors are removed from later rollback records before retention can discard
their evidence. If the preceding artwork was explicitly deleted while a replacement
was pending, failure of that replacement clears the deleted selection, guarded
against a newer issued command. A refused clear is not retried.
Restart drops unused opportunity references and never replays an
initial selection. Existing half-life maintenance uses saved bytes and
`art-dispatch/2.0`, without a grant, provider call or retry of the initial attempt.
The additive private `art_stage_targets` table binds scheduled copies and their
maintenance to the configured target; it does not invent targets for older rows.

The same version's `present` action names a saved artwork and exact browser
composition. Its successful outcome means the selection committed. The state
contains `selection: {artworkId, compositionId}` or `null`, while authenticated
content supplies metadata for a selected artwork outside the recent state window.
The 2.0 command and state contracts remain supported unchanged.

Art state keeps display kinds (`pixoo` and `tidbyt`). Before forwarding a stage or
ambient selection, the module resolves that kind to the configured device ID from
the exact display owner's current `device` sync. Missing, ambiguous or stale copies
refuse without forwarding. The selected device must declare `moments.art`; staging
also checks its supported formats and byte limit. A sync gap withdraws routing until
a complete replacement arrives, and removals withdraw the removed ID. Physical
availability does not gate this local-copy handoff; the display owner decides whether
it can admit the command. No refused command is retried automatically.

`weather-state` comes from the weather module by sync. Only fresh condition words reach a
prompt, so a temperature or day part in its words is dropped. A job's validated
`context` is used first as requested inspiration unless an explicit automatic
weather policy selects otherwise. Without either supplied inspiration
or a fresh weather observation, the art says nothing about weather.

## Browser gallery and Home art

The module's `./frontend` entry supplies the Art Gallery page and Home widget.
They share the shell's authenticated module scope and SDK connection. The gallery
reads the paginated private catalog, requests owner art or variations, saves
favorites and records explicit feedback through `art-catalog-edit`. Opening a
saved artwork reads its existing browser rendition; it neither regenerates nor
replays a display. The request form identifies Browser, Tidbyt and Pixoo targets,
selected by default. Creating prepares those compositions; it does not start a
display moment. The job result is separate from command admission.

Show now (Hub #1581) shows one saved artwork on chosen surfaces about 20 seconds
later through the core's `art-show` command: the Selected artwork panel's
button and each card's. The Show on choices list Browser and every configured
art display from `/api/v2/automation/art/targets`, all chosen by default; a show
sends only the chosen surfaces the artwork has a usable composition for. Every
artwork the gallery lists can be shown, on any page: for art past the record's
24 most recent, the core reads this module's `catalog` content (Hub #1584). The shell's tracked attempt locks the
control until the show settles. Each surface's line reads the core's operation
records through the identities `artShowSurfaces` derives: a display's
preparation and appearance, where a successful appearance is transmitted, not
observed on the panel, and the browser's selection, saved but not confirmed
rendered. A surface with no record after the show settled was not sent, and
the Automation page's Recent attempts gives the reason. Show now creates no art
and calls no provider.

The Home widget follows the owner's exact browser selection, including selected
art outside the recent state window. With no selection, it keeps the latest-art
fallback. Authenticated artwork metadata and image bytes must both match the
selected identity; obsolete or failed reads cannot select a newer image instead.
Gallery browsing retains its own local manual choice. Home pinning reserves
layout space and is not a pin on an artwork.

Browser compositions use the rich still rendition. Bytes must match its declared
size and media type and decode to its declared dimensions before replacing the
visible canvas. Failed or obsolete loads never replace it. No browser animation
is started, including with reduced motion enabled. Allowance displays retain
reserved and uncertain amounts and never suggest an automatic retry.

`ArtPresentationProvider` and `useArtPresentation` expose transient evidence for
the currently visible decoded artwork: artwork, composition and rendition IDs
and its palette. `ready` means that image decoded; `loading` or `unavailable`
may retain the last visible image, whose identity stays explicit. `stale` means
the underlying sync is unavailable; it is not fresh theme evidence. When no
image intersects the viewport or the view unmounts, `presented` is null. This context owns no
catalog, preference or durable state. Theme consumers may use only ready visible
art. The runtime shell applies bounded decorative colors from that evidence;
browser-local lock/default preferences remain outside the art catalog.

The existing core Home owner stores optional art shape and pin metadata. A pinned
art row reserves space independently of image arrival. Unpinned art uses only
unused viewport space after functional cards, and disappears when no complete
bounded shape fits. Pointer/focus interaction freezes automatic placement.
Dismiss/restore concern that widget placement; they do not submit dislike
feedback. Gallery favorites are distinct from Home pinning.

## Checks

Use Node 24. Run `npm run test:art`, or build once and run `npm run test:art:built`. See
[Art checks](../../docs/development.md#art-checks). After building,
`npm run test:art:browser` exercises the real owner and synthetic provider through
the browser, including Show now on the simulated Tidbyt and its Recent attempts rows.
The runtime's `art-show` scenario shows saved art on the simulated Pixoo and Tidbyt. The `scenario-art-gallery` disposable capture shows the actual
gallery with visible, labelled synthetic interactions. It contacts no provider
or device.
The `warm-colors` and `cool-colors` simulation actions select fixed synthetic
pixels for later image requests. The real local image processor derives their
palettes. Normal simulation output is unchanged until an action selects one.
`scenario-art-theme` uses these fixtures to demonstrate the shell's local theme
controls without contacting a provider or device.

An older Home save that retains the art placement but omits its optional options
preserves the saved format and pin. Explicit options replace them; removing the
reservation or resetting the arrangement still removes them.
