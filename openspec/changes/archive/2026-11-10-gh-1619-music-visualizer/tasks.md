## 1. Model and effects

- [x] 1.1 Add the visualizer signal, resting reasons, interpolation and engine, and the Spectrum bars and Bass pulse effects. `apps/runtime/dashboard/tests/music-visualizer.test.ts` drives both effects with a fake feature stream through the real `CaptureProjection` for silence, a steady level, a single beat, band changes and rest when the stream stops, goes stale or changes generation; it failed before the modules existed.
- [x] 1.2 Add the browser-only effect choice. The same test file covers reload, missing or refusing storage, unknown values and other tabs.

## 2. Surfaces

- [x] 2.1 Add the Audio panel, the `#/audio/visualizer` full view with the Fullscreen API, and the Home card in the Audio category. The unit tests cover the catalog entry and the route; `apps/runtime/dashboard/tests/music-visualizer.browser.ts` covers both effects and the resting state on Audio, the full view and Home, the Home editor's add, move, reload and remove, and that the visualizer sends no command.
- [x] 2.2 Share one capture scope per page, handing it across in-page navigation, replacing a scope the connection closed and resyncing an unsynced view for a later surface. The unit tests cover these cases and failed first, and the browser journey's in-page full-view steps go live without a reload; paired `music-capture.browser.ts` runs on head and base show the measurement card keeps its behaviour.

## 3. Records

- [x] 3.1 Update the dashboard and runtime guides, validate this change strictly, synchronize `runtime-dashboard` and archive the change on the delivery branch before final review.
