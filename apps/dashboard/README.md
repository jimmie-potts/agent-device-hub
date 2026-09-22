# BUNNY integration dashboard

The React/TypeScript frontend reads the shared hub and submits explicit integration
commands to its existing services. It creates no collector or device writer.
Activity, component and connection views remain useful without an active task.
Hub #151 adds Pixoo general controls to the same component view. Nanoleaf
general controls, exact previews and full editor migration remain separate work.

## Build and access

Use Node 24 at the repository root. `npm ci` and `npm run build` produce the fixed
HTML, JavaScript and CSS assets in `apps/hub/public`. `npm run package:hub` includes
these assets in the reproducible offline-installable host archive. The configured
hub serves them at its numeric-loopback origin. There is no separate frontend
server or CORS grant.

Provision a dedicated hub browser credential with `read`, optional `control`, and
only the intended registered device aliases. Give the user its token through the
existing private provisioning process. Never use a native controller token.
The login holds the token in memory only; disconnect/reload clears it. The hub
continues enforcing scopes, device permissions, Host, Origin and Fetch-Metadata
before commands or replay. Controller-native tokens remain in private server
configuration. A read-only credential sees disabled controls with explanations.

Add an existing configured monitor consumer if notice acknowledgment is needed.
The UI lists configured consumers; acknowledgment changes only that consumer's
monitor notice state. It never marks a Codex chat read or asserts task success.
No setup command changes an existing installation, starts personal services,
launches an agent or contacts devices.

An optional hub `editorLinks` object maps registered aliases to advanced editor
URLs. Only credential-free `http://127.0.0.1:<port>/<path>` links without a query
or fragment are accepted. Configure the existing wall/playlist editor's actual
address; the dashboard neither guesses destinations nor proxies these links.

## Common component view

`client.ts` defines the component identity and authenticated transport.
`ComponentView` in `src/main.tsx` supplies the common navigation target, evidence,
settings and unavailable-operation explanations. Nanoleaf and Pixoo use typed
integration views over their delivered versioned extensions. Unknown component
kinds receive a read-only view, with no invented controls.

Future frontend integrations join this registry and navigation pattern. Their
owning issues supply the production API, permissions, typed settings/controls,
specialized view if necessary, and browser/owner-contract tests. Adding a display
name does not qualify a new device. A third synthetic sensor fixture verifies
that the shell supports a component with different capabilities without adding
production hardware support.

Mode controls preserve Work/Quiet/Free and Monitor/Media. Nanoleaf settings include
layout, coverage, element/project/task mapping and project colors. Pixoo controls
include monitor filters and cadence. Advanced editors remain links. The UI never
translates these into a global mode or exposes raw commands.

## General controls

The component view offers screen power, brightness, saved-playlist selection and
the declared playback actions from the controller v1 capability object. Every
control submits one guarded controller v1 command through the existing hub route
with the observed request ticket, configuration revision and generation. A
disabled control names the missing capability, the read-only scope, stale or
external-control evidence, or the Pixoo mode. Components without a declared
capability, such as Nanoleaf today, show the same disabled controls with reasons.

Pixoo declares screen power, brightness 0–100 and media with pause, resume, stop,
next, previous and clear plus discovered playlist IDs, checked at Pixoo `main`
`c81bc31c59068e00bf9d15a81577863ba9446931`. Controller v1 modes are unsupported
there, so the Pixoo Monitor/Media mode control uses the delivered integration
extension's mode operation with its own ticket, revision and generation guards.
The browser fixture declares the same capabilities. Playlist selection and
playback actions are disabled while Pixoo is in Monitor or a mode change is
pending. The view names the reason and offers one explicit "Switch to Media"
command through that mode control; returning to Monitor uses the same control.
No command changes the mode as a side effect, nothing restores automatically,
and the hub stores no baseline and runs no timer. Screen off pauses playback and
screen on does not resume it. Playlists are listed by ID until
[Pixoo #67](https://github.com/jimmie-potts/divoom-app-upgrade/issues/67)
supplies user-entered names.

Power and brightness use the draft pattern below; the brightness slider starts
from desired, then observed evidence, and says when the current brightness is
unknown. Playlist start, playback actions and the Media switch are one-click
commands that use the latest observed snapshot and stay busy until the refreshed
snapshot arrives, so a following activation carries fresh guards. Only an
accepted ticket is watched for its terminal outcome; a rejected ticket may be
consumed by another client. A typed conflict is shown and the action stays
available; an uncertain result locks the group until "Load current / unlock". Physical acceptance on the
display is [Hub #154](https://github.com/jimmie-potts/agent-device-hub/issues/154).

## Intent and observation

Drafts pin the observed controller revision/generation and server-issued ticket.
Refreshes preserve focus, selection and drafts. A changed revision blocks stale
submission; server rejections retain edits. An uncertain result is locked and
never automatically retried. Loading current values is a separate explicit action.
Transport success and saved settings do not establish physical output.

The bounded authenticated change feed requests current monitor snapshots on state
or resync events. A stream reconnect uses its last cursor and backs off up to ten
seconds. Periodic reads recover observations; reads and writes share a bounded queue per
device, with pending explicit writes ahead of polling. Devices remain independent.
Definite pre-admission rejection retains an editable draft; partial receipts retain
completed operations and known effects. Terminal integration outcomes update the
submitted form. Target selection loads that target's current mapping or color
without making an edit. Failed reads retain prior evidence with a
stale warning. Observation age grows independently of successful transport reads.
Opening, selecting, filtering, reconnecting and receiving snapshots issue no
commands.

## UI provenance and validation

The starting point is Nanoleaf `main` at
`f12ac6653a9f3267fa9ef62a2d6667072183d8b3`, including approved Prism renderer
[PR #58](https://github.com/jimmie-potts/codex-nanoleaf/pull/58) and numbering
[PR #60](https://github.com/jimmie-potts/codex-nanoleaf/pull/60). The dashboard carries
forward cyan selection, magenta pending states, compact controls, a quiet grid,
local Bahnschrift/Segoe UI typography and focus-preserving interaction. It does
not copy wall geometry, physical Locate controls or animation rendering. This new
candidate requires its own explicit human approval. The Hub #151 general-control
candidate requires renewed approval, recorded in its PR.

`npm run test:dashboard` checks command guards and links.
`npm run test:dashboard:browser` starts disposable hub and fake-controller fixtures
and checks control, no-write inspection, heterogeneous components, reconnect,
expired cursors, slow devices, concurrent edits, terminal and uncertain outcomes,
known observations, external control, focus, keyboard, reduced motion, responsive
layout and automated accessibility. The Hub #151 matrix scenarios add guarded
general commands in Media, Monitor gating with the explicit switch and a pending
mode, concurrent edits with typed conflicts and locked uncertain actions, and
read-only or undeclared capabilities with named reasons. `DASHBOARD_RECEIPTS` selects an external
receipt/screenshot directory. Samples include event-to-rendered-snapshot latency
for Hub #30; a small synthetic sample is not full performance qualification.
Hub tests additionally check protected context, native credential exclusion,
static-asset protections, invalid links, packaged installation and that general
commands are validated and scoped before any controller request. Source/browser
checks do not establish installed-client or physical acceptance.
