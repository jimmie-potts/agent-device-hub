## Context

The Conversation page owns the mounted history, draft, command and speech
sessions. The workspace puts the transcript and composer in a shared grid
column and provides a sibling slot for Details.

## Decisions

- Use one native dialog in the Details slot. Show it beside the conversation
  at wide widths and as a modal at narrow widths. Its header remains visible
  while the sections scroll. Switching the dialog mode keeps the existing
  nodes and their disclosure state.
- Keep Details and Voice visibility in the mounted page. The selected panel
  handles its own dismissal. Return focus after closing Details without
  scrolling the transcript.
- Render the existing Stop speaking action in the narrow drawer during
  playback. It calls the page's existing speech session, and remains in its
  normal location when the drawer docks beside the conversation.

## Risks and tradeoffs

Changing the desktop column width can rewrap saved text. The transcript's
existing resize observer restores the saved row. Browser checks exercise
open, resize and dismissal, with a long identifier and active playback.
