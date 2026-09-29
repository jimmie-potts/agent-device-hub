# Cross-interface fixture journey

This is a proposed contract example, not a browser or live-model test. The
request, catalog, outcome, Jev and view-state definitions are owned by the other
contract issues under #509. They have no invented accepted version here.
Their approval/adoption remains separate. This root record definition has no
incoming required contract input; the scenario below states consumer obligations.

Use `fixtures/valid.json` and its generated `datasetId`, with issue references
`jimmie-potts/agent-device-hub#900001` and `#900002` (with the same full repository
prefix), and sub-guide `work-guide`. `fixture:catalog:one` is an opaque fake
catalog identity, not a new production catalog shape.

| Step | Input / validation | Allowed observation and contract owner |
| --- | --- | --- |
| Full guide | Valid retained dataset; no question submitted | Ordinary browsing remains available without a provider call. #511 owns renderer integration. |
| Explicit query | User submits “Show work for this guide”; public projection binds the dataset | The protected endpoint checks request context and policy-derived public selection before a fake provider receives it. #544 owns request/authentication. |
| Compose | Fake provider selects issue #900001 and sub-guide work-guide using the same dataset/catalog references | Application validates references and evidence gates before rendering existing objects. #545 owns catalog/view shape; #547 owns provider decisions. |
| Refine | Follow-up narrows selection, preserves a pin and can be undone | References still resolve to the same facts. Changing a view never edits source records. #548 owns state and follow-up transitions. |
| Full guide | Owner resets the composed view | Normal guide is restored; the reset invalidates earlier pending responses. #548 owns that transition. |

| Alternative | Expected handling |
| --- | --- |
| Timeout before response | Retain the last valid view/full guide, expose a timeout under #546; no invented result, replay or source mutation. |
| Missing scope text | Browse the issue with the recorded gap; withhold ready-work claims. `missing acceptance` fixture. |
| Incomplete dependency pagination | Show only explicitly partial observations; withhold complete prerequisite/readiness claims. `partial pagination` fixture. |
| Different dataset or catalog in response | Reject response, preserve the current view, and require a new explicit request against coherent inputs. Dataset mismatch is executable here; catalog validation is a later #545/#547 obligation. |
| Reset, then late response | Ignore the old response; it cannot replace Full guide. No generation/epoch wire field is adopted here; #548 defines it. |
| Reduced motion | Same selected references, reasons, errors, pins and reset outcome; animation changes no meaning. #515 owns browser accessibility evidence. |
| Inaccessible source repository | Retain its prior validated records and dates with failed/stale evidence. No fresh completeness or ready-work claim. |

These examples prove neither provider quality nor browser timing. Their stable
record references and data-gate expectations are checked here; downstream
acceptance must exercise the actual request, catalog and view-state interfaces.

For semantic discovery, the companion `fixtures/search.json` supplies playback,
import and event-reaction sections. The application supplies the full eligible
catalog; the fake-provider scenario selects the desired ID for each question.
Only reference resolution and preservation of distinguishing text are exercised
here. A real Jev selection or ranking is not measured by this fixture.

A fetch-only refresh preserves `datasetId` and can accept a pending selection if
its catalog still matches, its request remains active, and code rechecks current
freshness and operation gates. A content or public-policy change replaces the
identity and rejects the old selection. A reset still rejects late responses even
when content identity is unchanged; dataset identity is not a request generation.
