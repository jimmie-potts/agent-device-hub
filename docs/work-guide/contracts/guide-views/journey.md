# Cross-interface view journey

This example traces the proposed contracts. It is not a browser or live-model
test. The request (#544), outcome (#546), Jev decision (#547) and view-state
(#548) definitions are not approved yet, and none gets an invented version here.
The records come from the approved `guide-records/1.0`
[`fixtures/valid.json`](../fixtures/valid.json). The view is
[`fixtures/composed.json`](fixtures/composed.json). A fake provider returns that
view in place of #547's decision conversion.

| Step | Input and validation | Observable result and owner |
| --- | --- | --- |
| Open | Fresh open; no question | `fullGuideView()` renders the ordinary guide with its normal collapsed regions and every browsing feature. No records binding, catalog selection or provider call. #511 owns the renderer. |
| Explicit query | Owner submits “Show work for this guide” | #544 checks the request. The provider receives the question, the catalog projection and the guide-records public projection. |
| Compose | The fake provider returns `composed.json`, bound to the dataset and catalog IDs | `validateView` passes. `resolveView` shows #900001 as a highlighted candidate with template reasons, the work-guide panel (collapsed) containing #900002, and a collapsed prerequisite list computed from native `blockedBy`. |
| Refine | A follow-up removes the relationships section and changes the transition to `rearrange` | Surviving instance IDs (`answer`, `next-card`, `context`, `guide-panel`, `done-card`) resolve to the same records and reasons. The records are unchanged. #548 owns which IDs survive, plus pins and undo. |
| Full guide | Owner selects Full guide | `fullGuideView()` again, with no provider call. #548 clears the composed state and invalidates pending responses. |

| Alternative | Expected handling | Evidence here |
| --- | --- | --- |
| Timeout before a response | No candidate reaches validation. The current view or Full guide stays, and #546 shows the timeout. Nothing is invented or replayed. | Obligation only |
| Missing data | Missing acceptance or workflow status withholds `ready-candidate` with a source-linked reason; the card stays browsable. An incomplete `blockedBy` page shows the prerequisite list as partial. | `missing acceptance…`, `missing workflow label…`, `incomplete prerequisite pagination…` cases |
| Stale evidence | Expired observations withhold readiness and prerequisite completeness at use. A stale relation collection marks the relation reason `stale`. | `expired observations…`, `stale relationship evidence…` cases |
| Source mismatch | A response built for replaced record content is `dataset-mismatch`. The current view stays, and a new explicit request is needed. | `view bound to replaced record content` case and journey test |
| Catalog mismatch | A response built for another catalog is `catalog-mismatch`, handled the same way. | `catalog mismatch` case and journey test |
| Invented content | Free-text headings, URLs, unknown kinds, reasons or presets, unverified relations and non-public evidence are rejected, never partly rendered. | Rejection cases |
| Late response after reset | Validation alone cannot detect it: a late response can still match the dataset and catalog. #548's request generation must reject it, so it can never replace Full guide. | Obligation only |
| Reduced motion | The same nodes, order, reasons, disclosure, emphasis, links and actions, with every preset `none`. | Reduced-motion test |

These fixtures prove neither provider quality nor browser behavior. They check
reference resolution, validation, evidence gates and reduced-motion equivalence.
Downstream acceptance exercises the real request, decision, state and rendering
interfaces.
