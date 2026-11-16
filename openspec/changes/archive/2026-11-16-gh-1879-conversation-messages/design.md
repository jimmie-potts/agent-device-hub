## Context

The workspace lays out the history scroll area, composer and Details independently. The history reader tracks the first visible saved row and its offset.

## Decisions

- Share a width limit between the inner transcript column and the composer. Keep the scroll area at the workspace width so a change in available space still triggers the existing anchor restoration.
- Preserve line breaks and wrapping with CSS on the saved text nodes. Keep Tool result as a native disclosure keyed by the saved message ID.
- Derive the empty invitation from the successful read, live state and existing start guards. Keep task completion separate from transcript rows and operation receipts. Display live success in a compact line and keep the existing task details available for inspection.

## Risks and tradeoffs

Check narrow text wrapping with a long literal example and open tool output. Exercise the reading anchor during disclosure and pagination. A short line of completion status remains beside the composer so readers can see the outcome as soon as it arrives.
