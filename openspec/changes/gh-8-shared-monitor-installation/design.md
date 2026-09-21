## Context

See proposal.md for scope and owning contracts. Host #5 supplies supervised quiesce/export/import, private route intent and fenced activation. Nanoleaf #29 supplies configuration, preflight, explicit shared/legacy selection and pure status. Design is required by the schema because this work crosses configuration, authentication and migration boundaries.

## Goals / Non-Goals

**Goals:** Reusable setup operations packaged with the existing hub, reviewable source-specific hook edits, durable ownership and reversible credential/consumer changes.

**Non-Goals:** Personal installation, automatic discovery, native Windows services, trust-policy edits, direct controller database access, device operations or claims of live-client qualification.

## Decisions

- Export setup operations as a local SDK, composed by the named installation owner with its host and credential authority. Avoid a new unauthenticated administration listener or arbitrary command proxy. Provide actual host credential composition with private persisted configuration, plus a runbook for Pixoo's owning credential management commands.
- Use a separate private receipt directory per installation and explicit target files. Match owned hook entries exactly and remove them from the latest configuration. Keep original backups for inspection, never restore entire user settings. A pending receipt is written before effects and supports idempotent recovery. Unknown edits fail closed.
- Use one private producer file per source; derive each event's hook name from input, then call the shared normalizer. Preserve the migration route schema. No raw provider fields enter receipts or output. Use the hook's own hard deadline and silent success even when disabled or offline.
- Generate Codex hooks.json or Claude settings.json entries, keeping unrelated top-level settings. Windows clients receive an explicit wsl.exe argument construction for the declared distribution and Linux executable; this is source-tested construction, not native installation qualification.
- Keep qualification explicitly supplied, default false. Fixture coverage never automatically marks an installed route qualified. User trust review remains required by the client; managed-only policies are preserved.
- Compose Nanoleaf's installed command interface through bounded, explicit executable arguments. Never open its SQLite from Hub. Reuse host migration fencing and exact current state export for owner movement. A consumer-policy mismatch remains a preflight failure; never edit durable exports to bypass it.

## Risks / Trade-offs

- Multiple files cannot commit atomically: durable private intent precedes writes; producer emission remains disabled until completion, and failures retain intent for retry.
- User edits can race setup: exact plan/file preconditions and owned-entry checks refuse ambiguous updates; installation requires configuration editing to be quiesced by its owner.
- Credential persistence and a running host must agree: the host adapter persists before replacement and verifies access; failures leave explicit pending recovery. Removal revokes first.
- Installed versions and Windows forwarding remain unverified: documentation identifies the exact evidence class and requires future named-owner qualification before enablement.

## Migration Plan

Inspect and review the plan, provision owned access, write the disabled producer and owned hook entries, then enable only explicitly qualified sources. Select Nanoleaf shared input only after its own preflight. For an owner move, quiesce and verify source exit, import into a fresh fenced store, stage routes and verify consumers before activation. On failure preserve the fence and private intent. Rollback uses the current state and the consumer's explicit legacy selection; it never restores a stale user settings file or starts competing writers.
