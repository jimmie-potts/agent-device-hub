## 1. Backdrop source

- [x] 1.1 Add failing unit tests with a fake `FrontendApi` and decoder for the backdrop loader: one request per rendition, kept previous image on a slow or failing newer one, obsolete loads, none, bitmap lifetime, and combined evidence.
- [x] 1.2 Factor `loadBrowserArt` and `useBrowserArt` out of the widget and implement `backdropLoader`, `ArtBackdropSource`, `useArtBackdrop`, `useShowArtBackdrop` and combined presentation evidence until the unit tests pass.
- [x] 1.3 Mount the source once on Home in the shell while the art module runs, drawing nothing.

## 2. Acceptance

- [x] 2.1 Add a browser journey proving the shell receives the widget's artwork and composition from one content request, keeps the previous image for a slow or failing newer one, reports none with no art or the module stopped, stays on the dashboard origin and keeps the policy.
- [x] 2.2 Pass the art unit tests, the art and art theme browser journeys, and the build, type, lint and workflow checks.
