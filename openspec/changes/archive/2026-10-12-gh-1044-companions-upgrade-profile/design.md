## Context

See proposal.md. `companions` is statically shipped, starts without a configuration section and owns a private SQLite record plus SDK outbox. Existing upgrade tooling recognizes the earlier fixed owner sets, rejects its inventory/health and compares post-start ownership with the original inventory. The module and its feature defaults are already delivered separately.

A design is required because this change affects durable recovery, admission and health across the runtime/operator boundary. No new contract or storage owner is introduced by this change.

## Goals / Non-Goals

**Goals:** extend the existing explicit profiles for this owner, require complete evidence before effects, preserve latest data and ordinary health, and permit only its evidenced initial creation.

**Non-Goals:** change companion behavior or enablement, select #643, add a discovery/profile framework, alter certificate fields, install or operate devices, weaken other owners' coverage or repeat initial runtime adoption.

## Decisions

- Keep the four existing exact owner sets and add their four companions variants. Match names and complete phase coverage, not cardinality alone; BB-8 remains an inseparable module/helper pair.
- Determine the known always-shipped owner from the verified artifact's fixed companion package path. This is a conservative rule for the delivered registration, not dynamic module discovery. Missing artifact inventory is unknown and refuses. Any future registration/packaging change needs fresh qualification.
- Require a companion-capable recovery artifact whenever selected releases or retained/configured state require it. A current artifact lacking its reader is allowed only before the owner has any state/configuration. Preserving an unread file is insufficient evidence of reopened latest state.
- Enforce ordinary companion health only in roles whose verified artifact ships it. A legacy initial baseline has no fabricated row. Unexpected companion rows in a moduleless role still refuse.
- Derive expected post-start durable owners from the approved inventory and the explicitly qualified companion startup. Permit that addition only, require its state once started, and preserve strict configuration, path, source, admission, receipt, health and drift checks.
- Reuse inventory-only inspection and production module/store/outbox fixtures. Prove candidate writes, compatible recovery reads and re-upgrade retention with no command/reaction replay. Do not open installed databases.

## Risks / Trade-offs

- New owner state invalidates an older recovery that lacks its code → refuse it before effects and qualify exact capable recovery bytes; no opaque-state exception.
- Package presence can be more conservative than a future unshipped registration → refuse unsupported future combinations rather than infer a new profile.
- Coverage shapes share cardinalities → validate exact names and every phase, retaining unknown/duplicate/partial negatives.
- First-start ownership could hide unrelated drift → derive only the named addition and require exact remaining inputs/owners.
- Source qualification could be mistaken for startup authority → keep installation and feature enablement unselected; the exact future plan needs its own applicable authority and private admission.

## Migration Plan

Deliver through independent reviews, applicable CI and normal protected merge. Prepare clean exact artifacts and complete private compatibility/admission afterward. Use the established routine procedure only after its complete plan, authority and lock/recheck gates; no service, configuration or device change follows from this source work. Preserve historical certificates and evidence. Recovery uses verified capable bytes and latest state, never a restored older database.
