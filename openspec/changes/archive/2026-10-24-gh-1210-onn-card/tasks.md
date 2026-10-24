## 1. Presentation and guarded adapter

- [x] 1.1 Add a focused old-page negative control, implement the exported Soft keys card and verify the same render check passes with pure browser-only bundling and observed-app/guard regression tests.
- [x] 1.2 Reuse module status acquisition and shared Command handling with target/capability/lifetime checks; verify stale, unavailable, read-only, conflicting/obsolete state and retained uncertainty prevent dispatch without replay.

## 2. Placement and history

- [x] 2.1 Mount the module-owned adapter on existing Home/component placements and reuse it on the controls page; verify stable image/card geometry, keyboard tabs and hide/re-entry without commands.
- [x] 2.2 Add the module-local History declaration over the existing history UI and preserve the current controls URL; verify route/read-only navigation, filters/detail/continuation and zero inspection effects.

## 3. Integration and delivery evidence

- [x] 3.1 Extend the existing simulated ONN browser journey for all keys/apps/text, guarded unavailable/read-only and uncertain-reload states, memory-only text, both tabs, light/dark desktop/phone axe, focus and document containment; run required owning/shared checks and retain screenshots.
- [x] 3.2 Update owning guides and existing CI coverage mapping, validate the issue-linked OpenSpec change and synchronize/archive the delta; record acceptance coverage and keep revision-specific review/CI/installed receipts outside the commit.
