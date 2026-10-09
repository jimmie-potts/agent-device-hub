# Architecture diagrams

[Current runtime boundaries](../runtime-architecture.html) remain owned by
[architecture](../architecture.md). The following sequences explain selected
flows at source revision `ea45a7762a2bc212dc386c2892d09f345b33f838`, reviewed
October 9, 2026. They describe source behavior; the [accepted cutover
record](https://github.com/jimmie-potts/agent-device-hub/issues/840#issuecomment-6086298585)
owns installed and representative physical evidence.

| View | Source owners and reading limits |
| --- | --- |
| [Connect, sync and reconnect](current/runtime-sync.html) | [SDK sync](../../packages/sdk/src/sync.ts), [remote client](../../packages/sdk/src/remote-client.ts), [gateway](../../apps/runtime/src/gateway/). The SDK subscribes before requesting state, replaces membership, applies newer buffered messages and restarts on overflow or a lost stream. No old command or occurrence is replayed. Owner arrows cross the authenticated gateway; they are not another client transport. |
| [Command responsibility and outcome](current/runtime-outcomes.html) | [Core tracker](../../apps/runtime/src/core/tracker.ts), [operations](../../apps/runtime/src/core/operations.ts), [SDK outbox](../../packages/sdk/src/outbox.ts). Admission accepts responsibility, not success. A still-queued request expires with no effect (`expired`); a handler-started deadline/exception, lost reply or absent outcome yields `uncertain-result`. Cancellation ends waiting, not prior effects, and `retryable` never authorizes command resending. The module persists its result before reporting it. Core commits state/tracker/inbox/history together and deduplicates outcome messages by source and ID; it then acknowledges them. Publication retry never sends the device command again. |
| [PROMPTI guarded input](current/prompti-input.html) | [Retained bridge router](../../apps/chompi-bridge/src/routing/router.ts) and [adapter contract](../../apps/chompi-bridge/README.md). Selection navigates and verifies a session; Send checks the qualified foreground client at press time rather than navigating a remembered target. Unknown foreground, composer or approval state refuses input. A big-wheel click on a card follows the separately guarded card action; Play never does. Stale/disconnected bridge input clears pending input and invalidates ongoing work. Uncertain Send is never retried. This is not acceptance of deferred runtime CHOMPI integration. |

The runtime sequences follow [ADR 0012](../decisions/0012-bunny-event-platform.md)
and the [diagnostic contract](../observability-contract.md). Registry codes and
retryability stay in the shared error body; logs use fixed safe text and retain
request/trace correlation without private payloads. The stored outcome retains message ID, time and trace context across publication/restart; its request ID ties it to the tracked operation. Review the diagrams when
transport, sync membership, buffer overflow, admission/outcome ownership, retry
policy or input targeting changes. A semantic review may record “reviewed; no
architecture change” without rendering again.

## Edit and verify current sequences

Edit the corresponding JSON under `current/`. Use the installed Archify skill's
`validate sequence`, then `deliver sequence`, with `--quality showcase --json`.
Each must report nine checks with no errors or warnings. Run `visual-check` on
the exact delivered HTML and inspect both themes; retain browser screenshots and
receipts privately outside Git. Artifact checks, browser measurements and source
review prove different things. `current/provenance.json` records source pins and
specification/HTML hashes, not a live semantic correctness claim.

```bash
python3 docs/diagrams/check.py
python3 docs/diagrams/test_independence.py
python3 docs/system-design/build.py --check
python3 docs/system-design/check.py
node docs/system-design/check.cjs
node docs/skins/check_places.cjs
```

The browser commands use the existing installed Playwright/Chromium; see
[development](../development.md#system-design-documents). No Work Guide build is
needed. The independence test copies only retained documentation into a temporary
disk directory and checks it with the entire Work Guide tree absent.

## Retained September views and extraction map

`architecture_diagrams.py` owns nine dated definitions. `legacy/specs/`,
`legacy/rendered/`, `legacy/source-receipts.json`, `legacy/sources/` and
`legacy/diagram-receipts.json` retain their source snapshots, classes, SVGs,
standalone HTML and generation evidence. Their source dates and revision pins
are unchanged. Navigation was updated for this location; this does not make the
historical diagrams descriptions of today's runtime.

| Consumer | Retained input |
| --- | --- |
| Atlas `build.py` and `check.py` | This directory's definitions, SVGs, classes and receipts; `design.json` owns atlas links |
| Shared Places browser checks | `legacy/rendered/*.html` plus atlas/reference pages |
| Separate public export | Retained diagram viewers and atlas/reference only; staging grants no publication authority |

For an intentional revision to a dated diagram, use the installed Archify skill
through `ARCHIFY_DIR=/path/to/archify python3 docs/diagrams/architecture_diagrams.py`,
then rebuild the atlas and run the checks above. Preserve historical provenance
unless the revision explicitly changes that baseline. Current diagrams use their
own JSON rather than silently rewriting those snapshots.
