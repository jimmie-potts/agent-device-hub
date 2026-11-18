## 1. Shared profile and waiting state

- [x] 1.1 Hold the selected profile, whether the page is open, the kinds of the questions that were read and the waiting profiles in one store in the companions frontend, and unit-test it.
- [x] 1.2 Work out which tasks wait on an unanswered question, which of them need the owner and which question the rail should read, and unit-test it.

## 2. Conversations in the rail

- [x] 2.1 Export the rail group and the waiting hook from the companions frontend: three profile links, a read-only state copy and one bounded history read for each pending question.
- [x] 2.2 Mount the group in the rail's bottom group in its own module scope while the catalog declares the Conversation page of a running companions module.
- [x] 2.3 Draw the group in the full rail, the icon rail and the phone drawer, with the marker on the profile's tile.
- [x] 2.4 Mark the phone menu button when a conversation other than the open one needs the owner.
- [x] 2.5 Put Settings and the feed indicator in one row, and name the feed in the indicator's details.
- [x] 2.6 Mark the Devices row lightly on the Conversation page.
- [x] 2.7 Remove the line under the Pinned heading, on the owner's direction, and keep the rail's room for one row when nothing is pinned.

## 3. Conversation page

- [x] 3.1 Read the selected profile from the store and share each question's kind that the page has read.
- [x] 3.2 Remove the profile column, the narrow selector and the "Companion pages" disclosure, and keep one header row.
- [x] 3.3 Raise the shared measure to 920px.

## 4. Evidence

- [x] 4.1 Add a browser journey for the rail group: a fixture part for state changes and reads a healthy runtime cannot produce, and the real dashboard.
- [x] 4.2 Update the Conversation workspace, history, speech, delegation, shell and Devices menu journeys and the Conversation verification capture where this story changes the accepted layout.
- [x] 4.3 Remove each guarded behavior once and confirm a test fails.
- [x] 4.4 Run the companions and dashboard unit tests, every dashboard browser journey, the verification captures, lint and the shared build, type and workflow checks, natively and the smoke run in the Linux container.
- [x] 4.5 Update the dashboard README, the companions README and the runtime checks guide, and synchronize the `runtime-dashboard` and `bunny-assistant-tasks` specs.

## 5. Review round one

- [x] 5.1 Check a conversation row's fit from its own widths, so the journey holds under the Linux runner's wider fonts, where a label moves under its name.
- [x] 5.2 Say in the spec, the design and the code when a failed read is made again, and check each case in the journey.
- [x] 5.3 Say in the spec that the icon rail stacks Settings and the feed indicator.
- [x] 5.4 Keep a short rail's parts together at the top of the page, and check it with and without the conversations.
- [x] 5.5 Run the companions browser entry and the rest of the hosted App verification steps in the Linux test container.
