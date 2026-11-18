## 1. Devices menu

- [x] 1.1 Project the menu from the directory, with its columns, headings, state notes and key steps, and unit-test it.
- [x] 1.2 Make the Devices row a button that opens the menu, keep it marked as the containing destination, and keep "All devices" as the link to the directory.
- [x] 1.3 Add the menu with its keys, its closing rules and its phone layout over the drawer.

## 2. Pinned pages

- [x] 2.1 Keep the pins in a browser store that survives refused, missing or damaged storage and follows another tab, and unit-test it.
- [x] 2.2 Project the pages that can be pinned now, with their names and marks, and unit-test it.
- [x] 2.3 Add the header toggle to device, lighting-brand, Audio and module pages.
- [x] 2.4 List pinned pages and the temporary row in the rail, scrolling inside it, with the icon rail's marks.
- [x] 2.5 Let a window too short for the rail with its pinned pages scroll it with the page, and remove the shell root's `data-session` attribute.

## 3. Evidence

- [x] 3.1 Add a browser journey for the menu and the pins, and include it in the hosted smoke and full browser entries.
- [x] 3.2 Update the journeys that used Devices as a link.
- [x] 3.3 Remove each guarded behavior once and confirm the journey fails.
- [x] 3.4 Run the dashboard unit tests, every dashboard browser journey, the verification captures, lint and the shared build, type and workflow checks.
- [x] 3.5 Update the dashboard README and the runtime checks guide, and synchronize the `runtime-dashboard` spec.

## 4. Review round one

- [x] 4.1 Keep the lighting-brand heading's name on one line at phone width, with its actions as one group that wraps under it.
- [x] 4.2 Close the menu on a press or a focus move inside a framed module page.
- [x] 4.3 Keep the arrow keys working with focus on nothing, and hand focus on when the menu is removed while it holds focus.
- [x] 4.4 Measure whether the rail fits its window instead of naming a height, since the Linux test container needs more than the Mac, and have the journey measure the height it then checks on both sides.
- [x] 4.5 Leave the box on the Devices row on a page that has no row of its own.
- [x] 4.6 Show a module's state on the row of a pinned page whose module is not running.
- [x] 4.7 Make the temporary row's pin button a full touch target in the phone drawer.
- [x] 4.8 Add a check for each of these and confirm each fails without its fix.
