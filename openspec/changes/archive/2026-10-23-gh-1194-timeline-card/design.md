## Context

See proposal.md for motivation and Hub #1194 for acceptance. The core retains
compact change events, whole occurrences/outcomes and operation steps. Its
history GET returns oldest-first rows and supports exact filters. Home already
owns persistent placement; cards need no new state family.

## Goals / Non-Goals

Share presentation and read behavior across two consumers. Preserve the core's
evidence distinctions. Change neither capture nor device/state authority.
This design is included because read concurrency and truthful interpretation
of several record shapes benefit from explicit decisions before coding.

## Decisions

- Separate a pure history model, cancelable latest-read helper, React read
  adapter and presentation card. Do not create another connection, backend or
  universal card framework. A page-only rewrite would prevent Home reuse.
- Read on entry and deliberate actions only. Keep earlier rows during refresh
  or failure with a concise visible status. Abort superseded/unmounted reads
  and guard completion by identity even if a transport ignores abort.
- Use local calendar boundaries for Today/Yesterday; Recent reads existing
  retained history without a time bound. Date changes read the owner; category
  selection filters the current snapshot locally. Exact filters keep the
  existing API semantics and expose Custom period when applied.
- Map only recognized evidence. A sent/accepted operation is not a device
  result; succeeded+transmitted is not observed. Compact changes describe
  changed fields only, never reconstruct unrecorded state or current labels.
  Keep original identities and technical evidence behind selection.
- Use the existing skin tokens and native disclosure/controls. Home wraps the
  shared card in its existing Widget frame; the page supplies the same frame.
  Timeline is picker-only by default to preserve saved/default composition.

## Risks / Trade-offs

- Retained history can be large → render a bounded initial slice with explicit
  Show more; keep filters and all returned records available without a new API.
- A category cannot be identified from a record → include it in All with a
  neutral Hub category; never infer a device result from its identity.
- Exact filter dates differ from quick dates → applying exact filters selects
  Custom and preserves their actual query; switching a quick date clears exact
  dates while retaining exact kind/source/session filters.

## Migration Plan

No migration. Register one catalog ID and preserve existing Home layouts and
history. Delivery uses the existing current-runtime upgrade procedure; rollback
uses that procedure and retains history and Home placement metadata. Installation
ownership and qualification are refreshed before the installed operation.
