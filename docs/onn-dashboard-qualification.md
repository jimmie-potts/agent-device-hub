# ONN dashboard display qualification

This record covers showing the shared B.U.N.N.Y. dashboard on the owner's ONN
4K Pro Google TV streaming device. GitHub
[#1112](https://github.com/jimmie-potts/agent-device-hub/issues/1112) owns the
acceptance and the owner's observations. The TV is a browser display client of
the existing Mac-hosted runtime; it is not the ONN control/history module, whose
writer and qualification are in
[ONN controls qualification](onn-controls-qualification.md). Actual device,
client and address observations stay private. This record installs nothing and
sends the ONN no command.

## Route and permission

The TV uses the route that
[private access](../apps/runtime/PRIVATE-ACCESS.md) already provides to the
owner's Mac, PC and iPhone: TV browser → Tailscale Serve HTTPS → loopback Caddy
with the owner password → the existing gateway → the dashboard's SDK sync. No
TV-specific entry point, page, broker, reducer, polling path or replay exists.

Permission decision, 2026-10-28: the TV uses the existing read/control browser
session, the same grant the phone uses. The gateway gives every browser session
one fixed grant, `bunny/parts/dashboard` with `read` and `control`
([Callers](../apps/runtime/README.md#callers)), so a read-only television
session would be an authorization change: a new browser session kind or a
second origin with its own grant, plus controls hidden in the shell. Nothing in
this outcome needs it; the TV sits behind the same tailnet membership, owner
password and session expiry as the phone. If a guest-safe TV is wanted later,
that is its own issue.

The route is started by hand on the Mac after sign-in, as the private access
guide says. The TV view is available only while Caddy and Tailscale Serve run;
a Mac reboot or sleep makes the bookmark unavailable until the owner starts
them again. This record does not turn the route into a service.

## Owner setup on the device

Google TV ships no browser. These steps are the owner's, on the owner's own
device and account, outside Git and outside any delivery session:

1. Install one TV browser from the Play Store or a verified sideload, and the
   official Android TV Tailscale client. Sign Tailscale into the personal
   tailnet. Record the browser name and version, the Tailscale client version
   and the ONN build privately; do not publish them.
2. With the Mac route running, open the private bookmark in the TV browser.
   Enter the owner password at the browser's prompt. The dashboard then opens
   its ordinary eight-hour session.
3. Keep the TV's own launcher, YouTube, Stremio and physical remote as they
   are. Nothing here changes the ONN module's writer, pairing or settings.

Do not enable Funnel, forward router ports, change firewall rules or add a
second Tailscale listener to make a browser work. A browser that cannot complete
the password prompt, hold the Secure `SameSite=Strict` cookie or keep the SDK's
event stream open is a compatibility failure to record, not a reason to widen
the route.

## Checks on the actual ONN

Record each observation privately with the date, the browser and the result.
The issue's acceptance items are the owner's; a check that was not performed
stays pending.

| Check | What to observe |
| --- | --- |
| Sign-in | The bookmark prompts for the owner password once, then shows the signed-in dashboard with its Home. Wrong or cancelled credentials show the browser's refusal, not the dashboard. |
| Reading from the sofa | On Home, each agent card shows the session name, the client line (the provider and client it runs in), the state chip and any attention line, and, when opened, the last-evidence age, the attention text and the source (host and provider). The Hub mode and the inbox are legible. Note anything that is too small to read from the normal viewing position. |
| Remote navigation | The directional keys move a visible focus ring between the navigation links, the mode buttons and the cards; Select opens a card and activates a link; Back returns to the previous page. Note any control the ring cannot reach. |
| Disconnect and app switch | Pause the Mac route or drop the TV's network: the cards mark their evidence stale and the page says the feed is not connected. Restore it: the current state returns and the TV sends nothing. Press Home, use another app, return to the browser: the page shows current state and repeats no command. A mode changed from the phone while the TV was away shows once reconnected and is not applied again. |
| Session end | Disconnect in Settings ends the session and offers Sign in; expiry or a runtime restart offers Sign in again. Both are reachable and work from the remote. |
| Return to viewing | Home on the remote leaves the browser; YouTube, Stremio and the remote behave as before. |

A readability or navigation gap is the trigger for a bounded shell change under
the [UI guide](application-ui-style-guide.md) and the owning
[dashboard checks](../apps/runtime/DEVELOPMENT.md#runtime-dashboard-checks).
Until then the shell is unchanged.

## Source evidence

`node apps/runtime/dashboard/tests/tv.browser.ts` runs the existing shell on
the disposable synthetic runtime at a 1,920 × 1,080 viewport and drives it from
the keyboard only, as a TV browser presents the D-pad: Tab, Enter and the
browser's Back. It checks that focus is visible at every Tab stop on its way
to Settings, a mode button, a card and Sign in again, that the agent cards show
name, client, state and attention on their face and last-evidence age, attention
text and the host/provider source when opened, that a dropped stream marks
evidence stale and reconnects without a command, that a mode changed by another
browser appears without being repeated, that a runtime restart offers Sign in
again from the keyboard, and that the page has no overlapping text, no
horizontal scroll and no axe violation in light or dark. It runs in
CI's App verification job and in the full local dashboard browser suite. Its
screenshots, saved under `DASHBOARD_RECEIPTS`, are synthetic.

Playwright's Chromium at that viewport is not the ONN's browser. The journey
establishes the shell's keyboard and layout behavior at television size; it
does not establish rendering, password handling, cookie or stream behavior on
any TV browser, nor readability from a sofa. Those remain the owner's checks
above.
