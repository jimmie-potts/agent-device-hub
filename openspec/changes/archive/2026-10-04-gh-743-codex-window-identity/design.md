## Context

The router accepts a key press only after the fixed link brings the expected package family to the front. The adapter reads the family with `GetPackageFamilyName` on the foreground window's process. Codex Desktop 26.930.3930.0's window process runs from its package folder but without package identity, so the family read as null, and every Codex press failed closed with `foreground-mismatch`.

## Decisions

- **Fallback, not replacement.** The image-path family is used only when the process has no package identity. A process that does carry one is identified by it, even if its image path suggests another package.
- **Trust.** `<Program Files>\WindowsApps` is writable only by the package installer, so a process image inside `WindowsApps\<PackageFullName>\` belongs to that installed package. Only the folder directly under `WindowsApps` counts. It must parse as a full package name: a 3-50 character name, a four-part version, an architecture, an optional resource ID and a 13-character lowercase publisher ID. Traversal segments, other drives, look-alike roots and paths outside `WindowsApps` yield none.
- **Root.** `ProgramW6432`, else `ProgramFiles`, which is the 64-bit Program Files for the 64-bit bridge, or an explicit adapter option in tests. A relative or missing root yields none.

## Failure and recovery

If the root or path cannot be read, the family stays null and focus fails closed, exactly as before.

## Acceptance examples

| Example | Test |
| --- | --- |
| Codex and Claude image paths yield their families; resource IDs and case-insensitive roots work | `windows-package-path.test.mjs` |
| Outside `WindowsApps`, look-alike root, other drive, traversal, malformed names, no or relative root yield none | `windows-package-path.test.mjs` |
| Adapter: null identity plus a `WindowsApps` path gives the Codex family; another path gives none; a real identity wins | `windows-adapter.test.mjs` |
