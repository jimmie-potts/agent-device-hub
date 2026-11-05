## Why

[Hub #723](https://github.com/jimmie-potts/agent-device-hub/issues/723) needs a private place to prepare reusable decorative lighting cues. The merged Nanoleaf timeline compiler makes offline authoring useful before playback alignment and physical timing are qualified.

## What Changes

- Add a bounded Nanoleaf-owned show library with immutable named versions and guarded explicit saves.
- Add deterministic starters, cue editing and a labelled timing/palette storyboard through the module's existing frontend and authenticated SDK seams.
- Keep authored data private and preserve it through restart; report capacity, invalid input, stale saves and unavailable reads without changing devices.
- Link Audio to the declared module page. This increment sends no playback or lighting command and collects no media or analysis metadata.

## Capabilities

### New Capabilities

- `nanoleaf-show-library`: Private immutable decorative show versions, guarded metadata-only saves, reads, editing and semantic preview.

### Modified Capabilities

None. Existing timeline, device-writer and music-session requirements remain unchanged.

## Impact

The change affects `modules/nanoleaf` storage, module-owned profile 2.0 schemas, runtime handlers, content reads and frontend, plus a small Audio navigation link and disposable dashboard tests. It reuses the internal timeline compiler, SDK outbox, tracked actions and module content API under ADR 0012. No cross-repository contract or dependency changes are needed. Source and storage review and browser/accessibility evidence are required; installation and physical acceptance remain separate.
