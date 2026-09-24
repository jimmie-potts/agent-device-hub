# BUNNY integration dashboard

The React/TypeScript frontend reads the shared hub and submits explicit integration
commands to its existing services. It creates no collector or device writer.
Activity, component and connection views remain useful without an active task.
Hub #151 adds Pixoo general controls and Hub #153 adds Nanoleaf general
controls to the same component view. Exact previews and full editor migration
remain separate work.

## Build and access

Use Node 24 at the repository root. `npm ci` and `npm run build` produce the fixed
HTML, JavaScript and CSS assets in `apps/hub/public`. `npm run package:hub` includes
these assets in the reproducible offline-installable host archive. The configured
hub serves them at its numeric-loopback origin. There is no separate frontend
server or CORS grant.

The normal installed opening path uses the Hub owner's `open` command. It passes
one short-lived code through a
URL fragment, removes the fragment before exchange, and returns a memory-only
browser session with read/control on configured aliases. Reload requires another
launcher invocation. A direct URL still shows the manual-token option. See
[the Hub launcher procedure](../hub/README.md#open-bunny-without-typing-a-token).

For manual access, provision a dedicated hub browser credential with `read`,
optional `control`, and only the intended registered device aliases. Give the
user its token through the existing private provisioning process. Never use a
native controller token. The login holds the token in memory only;
disconnect/reload clears it. The hub continues enforcing scopes, device
permissions, Host, Origin and Fetch-Metadata before commands or replay.
Controller-native tokens remain in private server configuration. A read-only
credential sees disabled controls with explanations.

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

The component view offers power, brightness, saved-playlist selection, the
declared playback actions and saved-scene activation from the controller v1
capability object. Every control submits one guarded controller v1 command
through the existing hub route with the observed request ticket, configuration
revision and generation. A disabled control names the missing capability, the
read-only scope, stale or external-control evidence, or the device mode.
Components without a declared capability, such as the synthetic sensor fixture,
show the same disabled controls with reasons.

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

Power and brightness use the draft pattern below. The brightness slider starts
from desired evidence, then observed evidence, and says when the current
brightness is unknown. Playlist start, playback actions and the Media switch are
one-click commands. Like every command, they read the device again just before
sending (see below) and stay busy until the refreshed snapshot arrives. Only an
accepted ticket is watched for its terminal outcome; a rejected ticket may be
consumed by another client. A typed rejection is shown and the action stays
available. An uncertain result locks the group until "Reload current values".

Pixoo can be configured for Monitor without presenting it, for example after the
app restarts or the screen turns off and on. The Pixoo mode form then offers
"Start Monitor". It sends one integration Monitor mode command with that
extension's guards and no media command. It is disabled while desired screen
power is known to be off, because Pixoo `main` `01da65d` starts presentation only
while the screen is on. Physical acceptance on the display is
[Hub #154](https://github.com/jimmie-potts/agent-device-hub/issues/154).

Nanoleaf declares power, brightness 0–100 and discovered saved scenes on
controller v1, checked at Nanoleaf `main`
`80628498136203a8f5fcb06ab5fa306e961e2def` ([Nanoleaf #64](https://github.com/jimmie-potts/codex-nanoleaf/issues/64)),
the revision the hub's Nanoleaf fixtures pin; media, zones and preview stay
unsupported and the browser fixture declares the same. Power and brightness work
in Work, Quiet and Free. A brightness command is a user override: the view shows
a known desired brightness as an override that persists until the next explicit
mode command, which reapplies that mode's brightness policy, and shows no
override as unknown rather than as a value. While power is off the wall keeps
tracking tasks and writes nothing until the next mode command. The mode form
offers "Reapply <mode>", one controller v1 mode command for the observed mode.
Nanoleaf `main` `08b6b83` ends power and brightness overrides on any mode
command, including the same mode. When there was nothing to reapply, the
controller admits and then cancels the command with no effects, and the view
says the mode is already in effect. Admission still advances the configuration
revision, so other open drafts on that device show a conflict. Only this action
reports a cancel as already in effect; any other cancel is shown as not applied.
The action is disabled while a mode change is pending.

Scene activation is disabled while the wall is in Work or Quiet, while a mode
change is pending or while the mode is unknown, with the reason and one explicit
"Switch to Free" command through the existing controller v1 mode control;
returning to Work or Quiet uses the same control. The scene list comes only from
the controller v1 `scenes` capability, labelled by the user-chosen Nanoleaf app
names the `nanoleaf.integration/1.0` snapshot supplies and by ID otherwise;
browser and hub configuration contribute no scene identities or names. Activating
a scene is one guarded command that starts no polling and changes no mode. A
scene the controller rejects because its mode changed after the browser observed
Free is a typed failure that stays available for a fresh explicit action.
Physical acceptance on the installed wall is
[Hub #155](https://github.com/jimmie-potts/agent-device-hub/issues/155).

## Intent and observation

Drafts pin the revision they started from. Just before sending, every command
reads the device again through the same per-device queue. It uses that read's
server-issued ticket, configuration revision and generation, and re-checks the
control's availability. A failed read or a control that is no longer available
sends nothing and names the reason. General-control, controller v1 mode and
Pixoo integration drafts conflict only on the configuration revision. A
generation retires output work and advances without any client edit, for
example on every Pixoo playlist item or when Pixoo suspends its presentation.
The Nanoleaf integration forms keep their content revision guard.
A `stale-generation` race after the fresh read has no effects. It is shown with
an invitation to press the control again, and nothing is resubmitted.

Refreshes preserve focus, selection and drafts. A submitted control keeps
keyboard focus: while a command runs its group is disabled, and once the command
settles focus returns to that control, or to the group's first enabled control
when the control is locked or no longer rendered. An accepted result that is not
uncertain clears the draft once the refreshed snapshot arrives, so the form is
ready for the next change. A changed revision blocks stale submission, and a
rejection keeps the edit. An uncertain or partly applied result, including one
observed later, locks the form or group and is never retried. "Reload current
values" is the separate explicit action that unlocks it. Status text says
whether a command was queued, sent, saved, already in effect, not applied or
unknown, names the typed code, and never presents transport success or a saved
setting as physical output.

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
candidate requires its own explicit human approval. The Hub #151 and Hub #153
general-control candidates require renewed approval, recorded in their PRs.

`npm run test:dashboard` checks command guards and links.
`npm run test:dashboard:browser` starts disposable hub and fake-controller fixtures
and checks control, no-write inspection, heterogeneous components, reconnect,
expired cursors, slow devices, concurrent edits, terminal and uncertain outcomes,
known observations, external control, focus, keyboard, reduced motion, responsive
layout and automated accessibility. The Hub #151 matrix scenarios add guarded
general commands in Media, Monitor gating with the explicit switch and a pending
mode, concurrent edits with typed conflicts and locked uncertain actions, and
read-only or undeclared capabilities with named reasons. The Hub #153 scenarios
add Nanoleaf power and brightness in Work with the override hint, Work gating
with the explicit Free switch, one guarded scene command with a preserved
selection and focus across reconnect, keyboard focus kept through the Free
switch, a scene activation and a locked draft form, and a controller-side scene
rejection, revision conflict and uncertain result with no retry. `DASHBOARD_RECEIPTS` selects an external
receipt/screenshot directory. Samples include event-to-rendered-snapshot latency
for Hub #30; a small synthetic sample is not full performance qualification.
Hub tests additionally check protected context, native credential exclusion,
static-asset protections, invalid links, packaged installation and that general
commands are validated and scoped before any controller request. Source/browser
checks do not establish installed-client or physical acceptance.
