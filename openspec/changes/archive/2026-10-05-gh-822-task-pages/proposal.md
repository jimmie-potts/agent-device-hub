## Why

PROMPTI (the owner's name for the CHOMPI agent controller) has 15 task slots on its white keys. During the #743 trial, all 15 were in use and the bridge reported overflow repeatedly, so later tasks had no key. The owner decided on 2026-10-05 that small knob 4 pages through task pages ([#822](https://github.com/jimmie-potts/agent-device-hub/issues/822); pickup comment issuecomment-6004355804).

## What Changes

- **Slot store:**
  - Slots come in pages of 15, up to 8 pages (`pages.count`, default 4, so 60 tasks). Page p holds slots 15(p-1)+1 to 15p.
  - New tasks take the lowest free slot across all pages, and assigned slots never move.
  - Overflow is reported only when every page is full.
- **Slot file:**
  - The file becomes `schemaVersion: 2`. A version 1 file loads unchanged onto page 1 and is rewritten as version 2 at the next change.
  - Older bridges refuse version 2, so the README documents the rollback: back up the file and prune slots above 15.
  - Fewer pages never drop or move a task: such slots keep their tasks without visible keys and are reported.
- **Knob 4:** a turn (control 43) changes the visible page, one page per software detent with the big-wheel card steps' reversal rule, stopping at the ends. Paging is never input. The click (control 31) stays unassigned.
- **Keys:** slot keys, the release gesture and lights act on the visible page. The bridge starts on page 1, and a profile reload clamps the visible page.
- **Lights:** knob 4's LED shows the visible page in a per-page color (`colors.pages`). It alternates with the attention color while a task on a hidden page has attention.
- **Docs:** the bridge README (profile, controls, lights, rollback) and the qualification report (control map, installed checks).

## Capabilities

### Modified Capabilities

- `chompi-task-routing`: stable slots across pages, release on any page, the page indicator light, the page profile fields and a new requirement for task pages with small knob 4.

## Impact

This changes the bridge package only, including its private slot file. The OS adapter is unchanged. Installation is a bridge reinstall on the trial host. The first slot change after the upgrade turns the file into version 2, so a rollback to an older bridge needs the README step.
