## Open my Hub status with one shortcut

- Press a chosen keyboard shortcut to open my Hub status page.
- Use the Hub address I already configured.
- Reuse the page's existing sign-in checks.
- Tell me when the configured address is missing.
- Leave my other keyboard shortcuts unchanged.

## Outcome and real setup

One operator can open the existing Hub status page from one chosen desktop
keyboard shortcut. Use the configured Hub address on that desktop; exclude
remote desktops and device commands. This is a local sample, not delivered work.

## Smallest useful implementation

Bind the chosen shortcut to the existing browser-opening action. Read the
configured Hub address and show a missing-address message when it is absent.
Use the existing page and its sign-in checks. Required issues: none.

## Behavior and protections to preserve

Keep other shortcuts, page access checks and device-writer ownership unchanged.
The shortcut grants no extra permission and sends no device command.

## Observable acceptance and planned evidence

Delivery target: source-only

Planned checks use a fake browser opener to verify the chosen shortcut opens
the configured address once, a missing address produces a message, and other
shortcuts are unchanged. Existing page access checks remain in place. Desktop
installation and a real-client trial require separate authorization and evidence.

## Meaningful deferrals

Opening remote desktops and selecting multiple Hub installations are excluded.
Use the existing browser bookmark for other installations; revisit if needed.
