## 1. Presentation

- [x] 1.1 Rearrange the home and collapse secondary session details; verify the layout assertion fails before the change and passes afterward.
- [x] 1.2 Add accessible status information and known-brightness meters; verify hover, focus, Escape and touch in the synthetic browser fixture.
- [x] 1.3 Preserve command behavior; pass the full dashboard browser matrix, typecheck and package checks.

## 2. Delivery preparation

- [x] 2.1 Update the application guide and synchronize the dashboard specification; pass workflow validation and record desktop/mobile preview artifacts for renewed owner approval.

Evidence: full dashboard browser suite, build/typecheck, controller TypeScript/Python and package checks, Hub package check, dashboard unit tests, LIFX/local-controller suites and workflow checks/tests passed. Synthetic desktop/mobile/hover previews are in the coordinator’s `.local/evidence/gh-424-session-titles/dashboard-compact/`. All 18 main specifications validate. UI approval, merge, publication and installed acceptance remain separate pending gates.
