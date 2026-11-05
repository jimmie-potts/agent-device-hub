## Context

The existing module already routes commands and journals writes per device.
Requested animations still select the Lines layout and encode logical Lines
zones. The saved favorites table contains frozen recipes shared within the
Nanoleaf module. See the proposal for motivation.

This design is required by the schema's ambiguity and device-command safety
criteria because the older issue describes a retired integration API.

## Goals and boundaries

The selected device supplies its geometry and writer. The existing command and
state families carry the extension. Combined layouts, live music scheduling and
favorite editing on additional command addresses belong to separate work.

## Decisions

Use the existing journal rather than a second Panels queue. Admission resolves
the selected saved layout, verifies Free and the device's one-animation bound,
and queues on the device key. Execution renders the recipe for that device's
loaded geometry and encodes the appropriate display flag.

Keep the existing shared favorites table and its Lines edit owner. Either device
can resolve its frozen recipe by name and check it against its own geometry.
Animation state publishes one record per device. A favorite edit republishes all
animation records, while modes, queued requests and remembered scenes remain
scoped to their device. This avoids a storage migration and preserves saved
favorite identities.

Keep the existing module-owned payload shapes and profile 2.0 families. The
routing ID already identifies the target. Validation, durable admission, terminal
outcomes, expiry, cancellation, native-control holds and trace continuity use the current
module and journal paths under ADR 0012 and the diagnostic contract.

## Risks and checks

A Lines flag or layout applied to Panels could address the wrong zones. Synthetic
NL22 fixtures check all preset encodings and spatial placement. Module tests
exercise the normal request path and inspect the selected simulated transport.

A shared favorite update could leave another device's animation copy stale.
A sync test checks publication to both records. Device tests check independent
queue capacity, mode changes, scene identity, expiry and uncertain outcomes.
Requested animations preserve the existing no-retry, no-hold behavior after an
uncertain write; native controls keep their per-device holds.

## Delivery

Existing saved layouts and recipes require no conversion. Source delivery uses
normal PR review and disposable acceptance. The selected installation and
physical timing/appearance checks belong to the authorized acceptance task.
