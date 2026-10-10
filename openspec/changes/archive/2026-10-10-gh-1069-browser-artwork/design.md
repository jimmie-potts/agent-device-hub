## Context

See `proposal.md` for the requested outcome. The current card is shared by Home and Music, and its SDK copies already retain each owner. Playback owns the acquired normalized image; the browser has no receiver authority. The SDK's module API 1.2 content contribution and authenticated gateway already serve bounded non-executable content with read authority, no-store and nosniff. The dashboard CSP allows same-origin images.

This design is required by the schema's cross-component and security/timing criteria. The accepted readiness proposal used main `94eb4281029b0aaca277d1eb5fd0574541513b14`. The branch first advanced to display merge `6ae53a98e6900b7bf2f1d522686a5bf986eed685`, then to shared browser-harness merge `93f64819b8a591371e8f890b305dd0e157a23a20` before implementation. The owner content and shared-card seams remain the same. No architecture ownership change is proposed.

## Goals / Non-Goals

**Goals:** bind reads and browser display to the owner's current observation, preserve text and one-shot command evidence, and qualify lifecycle races through real authenticated content and synthetic browser interactions.

**Non-Goals:** change acquisition, publish a receiver URL or source identity, introduce a browser image cache, redesign Home, change gateway grants/CSP, or establish installed/physical acceptance from synthetic tests.

## Decisions

1. **Passive owner content.** Declare playback module API 1.2 and keep a per-instance content-read closure that exists only during a live start. References are `artwork.<canonical-generation-UUID>.<positive-record-revision>`. Read only a committed available, known playing/paused ready Sony record whose generation, normalized bytes and dimensions match the current controller snapshot and presented metadata. Stop/abort retires the closure. Decode canonical bounded base64 locally, verify PNG header and declared dimensions, and return `image/png`; no fetch, worker, evaluate, publication or scheduler effect occurs. Use the existing safe missing-content result for an obsolete or malformed reference. A new descriptor/query API would add another read and owner interface; existing API 1.2 is sufficient.

2. **Generation and revision.** Generation persists across pause and can persist across candidate replacement, so generation alone cannot distinguish every in-flight image. Record revision makes both the URL and the component key distinct. Refuse when the current controller has advanced before publication, or a failed commit restores an older record. This conservatively reloads after some metadata revisions while reusing acquisition; optimizing that would require another descriptor contract.

   The existing module assigns its working record before the outbox transaction settles. Content therefore keeps a separate last-successfully-committed record, updated only after that transaction succeeds. It compares that record with the current presentation and artwork snapshot on every read. The existing working-record revision, rollback, sync and outbox order stay unchanged. Tests must inspect the interval before commit as well as a failed commit; a working record is not commit evidence.

3. **Catalog-derived origin.** Map the SDK playback owner to one running catalog module that declares the served playback record. Unknown or ambiguous ownership retains text. Use owner plus record ID for the card key and owner, ID, generation and revision for the image key. The URL contains only the validated module and reference. Do not infer the owner from a title or hard-code a receiver.

4. **Native same-origin image.** Use a keyed image subtree with its own loading/error state, a fixed square and contain sizing. Native image requests use the existing session cookie. An old subtree cannot change the new subtree's loaded state; remove it immediately on revision, source, eligibility, sync or route changes. Native networking may finish after removal, but the old image cannot become visible. Browser byte fetches, blobs and data URLs would add buffering and policy surfaces without improving this boundary.

5. **Existing card behavior.** Artwork is eligible only for live/synced, available, known playing/paused ready records. Otherwise preserve the existing metadata and uncertainty text. Use decorative empty alternative text and no focusable image. Keep existing token roles, controls, supported-action order, revision guard and operation status. Image events cannot clear or relabel command evidence, enable a control, send a command or retry one.

6. **Qualification at each boundary.** Content tests exercise exact references, current snapshot/publication disagreement, rollback, stop/restart and repeated passive reads. Gateway tests exercise actual read-only authority and fixed error/header behavior. Browser tests use the real owner with synthetic acquisition, held image responses and SDK source changes, then inspect Home/Music, independent known pixels, controls, keyboard, desktop/narrow layout and axe. A disposable negative control that accepts obsolete content or drops the revision key must fail the corresponding race assertion. Keep those mutations outside the delivery source.

## Risks / Trade-offs

- A newer private observation can precede its public record. Refuse the old reference during disagreement and test that interval explicitly.
- Browser requests can coalesce when the URL is unchanged. Include revision in the URL as well as the React key; test same-generation replacement and late A completion.
- Image failure can shift controls or hide text. Reserve the square, keep metadata outside the image subtree and verify loading/error layouts at desktop and narrow widths.
- A read could accidentally refresh evidence or reacquire. Compare acquisition, worker, publication and command counts around repeated authenticated reads; do not call owner update paths from content.
- Current-runtime upgrades remain separately qualified. Merge and synthetic browser checks alone cannot satisfy installed-browser acceptance.

## Migration Plan

No private-store migration, new host or settings change is needed. Deliver source through reviewed PR and exact-revision CI, with API 1.2 and owning documentation updated together. Install only through the qualified established-runtime upgrade procedure after its prerequisite is accepted, then verify running revision, health and served browser build. Recovery follows that owning procedure; do not replace installed state or invoke the legacy Hub installer. Keep all real artwork/listening evidence private and publish synthetic copies only.
