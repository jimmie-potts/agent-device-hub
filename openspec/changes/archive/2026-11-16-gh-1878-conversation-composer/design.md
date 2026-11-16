## Context

The workspace provides the bottom composer slot. AssistantPage owns command lifetime, drafts and the speech session. The composer omits the text input when the saved proposal or delegation requires another decision.

## Goals

Keep controls for the current task visible and consolidate routine text and speech actions in the composer.

## Decisions

- Keep a single visual boundary around the text and toolbar. Send and Answer explicitly submit the input form. Voice stays outside that form and retains independent readiness, so keyboard use in Voice cannot submit a draft and an assistant command cannot prevent Stop.
- Keep panel visibility in AssistantPage. The Voice panel owns dismissal and focus. Closing it clears any unchecked or incomplete recovery acknowledgement in the panel, while the mounted speech session retains the endpoint and prior playback.
- Count UTF-8 bytes with the same measurement and limit used to refuse submission. The 80% threshold only controls the ordinary count. Drafts remain in page memory and Conversation settings explains what is saved and shared after submission.

## Risks

A bottom panel can overlap long content. Give it a bounded scrolling area, keep essential actions above the routine disclosure, and check short and narrow viewports. Constrained workspaces retain document scrolling for long proposals.
