## Context

SpeechControls currently owns the browser session, qualification read and live copies alongside its controls. Conversation needs a compact disclosure that can close during playback.

## Decisions

- Call one session hook from the mounted Conversation page. Keep its existing API lifecycle, synchronous policy refs and final checks. The Voice control renders that session's facts and actions; toggling Voice or Details, resizing and switching profiles leave the session at the same boundary. Reachy and Home call the same hook from the existing SpeechControls wrapper.
- Anchor a bounded labelled panel to the header so opening Voice does not move the composer. Keep Stop separately available while local output is active. Use current local playback for Speaking. Use the shared remote copy to identify another selected tab, uncertain playback and recovery. Preserve a local and remote playback report separately from the assistant command receipt.
- Keep requested Enable and recovery gated on current authority, qualification and operation availability. Stop and Mute retain local cancellation. Recovery continues to send its existing operation and revision after explicit acknowledgement. Reuse the driver's qualification, voice and Quiet checks.
- Use the existing transcript renderer and tracked command owner for Read aloud. An over-limit assistant message explains that its saved text remains written only.

## Risks and migration

Verify the browser endpoint stays selected across presentation changes and releases on the existing connection and page lifetime boundaries. Exercise fake browser speech and disposal, including second-tab exclusion and recovery. No data migration or installed changes are required.
