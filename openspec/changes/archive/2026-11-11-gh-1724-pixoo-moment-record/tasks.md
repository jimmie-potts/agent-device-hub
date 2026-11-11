## 1. Behavior

- [x] 1.1 Write failing tests on the manual clock: a 1 s and a 3 s moment over a playing item reported from the acknowledged frame until each ends, and an unanswered moment write never reported (`modules/pixoo/tests/module/module.test.ts`), and the unit report over a held item (`tests/unit/moment-presentation.test.ts`). Show them failing without the fix.
- [x] 1.2 Publish the display record when the Pixoo acknowledges a moment's picture, without the coalescing wait, and report a moment only from that acknowledgment. Verify with the tests above and the Pixoo suites.

## 2. Documentation and delivery

- [x] 2.1 Update the Pixoo README's command and outcome paragraph.
- [x] 2.2 Run build, typecheck, lint, the Pixoo suites, the `pixoo-moment` runtime scenario and the workflow checks; record the actual results.
- [x] 2.3 Sync and archive this change on the delivery branch. Independent review and installation follow outside this change.
