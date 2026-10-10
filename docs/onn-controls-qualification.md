# ONN controls qualification

This record selects a controls design for one owner-configured ONN. It reserves
the minimum interfaces for implementation; it installs no module or schemas.
GitHub [#1038](https://github.com/jimmie-potts/agent-device-hub/issues/1038) owns
acceptance and readiness. Original qualification observations, approvals and
recovery records stay private. Product source, installed-client and physical
acceptance remain separate.

## Route and observed setup

| Route | Evidence and decision |
| --- | --- |
| Home Assistant Android TV Remote | Its [documentation](https://www.home-assistant.io/integrations/androidtv_remote/) provides pairing, keys, focused text and app launch, but no reliable title/progress record. Ordinary Remote was tested first: navigation, both app shortcuts and playback worked; Stremio's focused text did not appear after the approved attempts, including a fresh IME context and one A key. It does not satisfy required controls on this setup. |
| Home Assistant ADB | Its [integration](https://www.home-assistant.io/integrations/androidtv/) supplies an established comparison for ADB control and an external ADB server. Installing a second Home Assistant/Python service supplies no needed runtime boundary; reuse the ADB route inside the ONN TypeScript module instead. |
| Google ADB plus TypeScript client | Selected after approved ADB text appeared in both apps and the required controls were observed. Google's [ADB procedure](https://developer.android.com/tools/adb) owns host tools and manual Wireless debugging pairing. A [maintained TypeScript client](https://github.com/yume-chan/ya-webadb) speaks to the host server. The owner explicitly approved this native host dependency; see ADR 0012's amendment. |

The observed target is an ONN 4K Pro Streaming Device on Android TV OS 14,
build `UR03.260203.035.A1.15640252`. Standard YouTube's installed version-code
observation is `725302320`, matching the reported `7.25.302` entry; the package
dump also contains the retained factory `5.30.304` entry. Standard Stremio is
`1.11.2`; the owner reports the usual player appears to be EXO. Qualification
used Google platform-tools `37.0.1`. Device address, ports, pairing identities
and credentials are private configuration, never publication evidence.

Manual setup uses the actual address and connection port shown on the main
Wireless debugging page. The pairing dialog has a separate port and code.
Pair only in an approved setup sequence, through a private owned host ADB
server and key directory. Record the exact host tool and app versions. A changed
connection port requires an explicit configuration update; do not discover,
guess, repoint another owner's server or change device settings automatically.

## Physical controls evidence

Approved sessions used the official host ADB client. Android acknowledgment
and the owner's TV observation were recorded separately.

| Control | Observed behavior |
| --- | --- |
| Home; Up, Down, Left, Right | Home returned to the TV home screen. Individual directions moved focus. An immediate Right after Home was initially not seen; a separate Right was observed. |
| Select and Back | Select opened the highlighted Search control in both apps. Back left playback and returned to browsing. |
| YouTube and Stremio shortcuts | Both standard apps opened. An implicit Stremio activity launch returned zero without leaving YouTube; it is rejected as evidence. Resolving the installed LEANBACK launcher and launching `com.stremio.one/com.stremio.tv.MainActivity` returned Android status `ok` and visibly opened Stremio. |
| Focused text | The unsubmitted neutral text `bunny test` appeared in the active search field of both apps. This proves the tested text, not arbitrary Unicode or an unfocused field. |
| Play/pause | Individual toggle presses paused and resumed each app. Transmission alone is not proof of playback. |
| Supported seeking | With the timeline physically focused, Left/Right made small steps. YouTube required a separate Select to apply the marker and resume. Stremio changed picture and position immediately while staying paused. Direct Forward/Rewind keys and fixed-second seeking remain unqualified. |
| Physical remote and reconnect | Each app remained paused at the same position through one disconnected command refusal and reconnect. Reconnect sent no command. The physical remote still worked and the next deliberate software toggle resumed normally. |

Sleep/wake, power, volume and HDMI-CEC effects were excluded from the approved
sessions and remain unqualified. Declare those capabilities unsupported until
qualified. The selected controls send no power/volume key and create no TV or
audio writer. Qualification does not claim that unrelated Android/TV settings
have no CEC effects.

Seeking is ordinary focus navigation, followed by a separate Select when the
app requires it. The controls explain that prerequisite; they do not infer focus,
send a macro, promise a time delta or silently turn a navigation command into
playback. A shortcut opens an app, not a selected title.

## Client and failure qualification

Published `@yume-chan/adb@2.6.4` was exercised with a fake private Unix socket.
The published `@yume-chan/adb-server-node-tcp@2.5.2` connector failed a body-read
deadline after acknowledgment: a 100 ms abort did not settle the read within
1,500 ms. Its source forwards `end` but not socket error/close to the reader.
Do not use that connector unchanged or assume the current upstream export and
behavior match its published package.

A small fixed Unix socket adapter using Node's `Readable.toWeb` passed the same
six cases: coalesced acknowledgment/UTF-8 payload, fragmented acknowledgment and
body, explicit refusal, silence before acknowledgment, silence after
acknowledgment, and partial acknowledgment followed by disconnect. Every case
sent one request with no retry; all owned sockets and the fake server were
closed. The source remains qualification scratch, not production code.

A follow-up fake server exercised the unchanged client through serial selection
and its shell-v2 subprocess service. The earlier adapter's separate connection
bounds allowed a fake command to finish at 210 ms despite a 150 ms operation
deadline. A small wrapper supplies the same cancellation signal to every
connection, including convenience methods. The same check then rejected at
150 ms before writing the command. Thirteen focused cases passed: representative
key and neutral text services, fragmented responses, nonzero Android exit,
server/target refusal or silence, an already expired operation, lost replies and
the deadline spanning server validation and target selection. Lost-reply cases
wrote the service once and did not repeat it. All traffic used a private fake
Unix socket and synthetic serial; its sockets and server were closed.

This supports the bounded client approach. It does not prove a production shell
action, command tracking, persistence, installed client or physical TypeScript
control. Those checks belong to implementation and installed acceptance. Supply
one operation-wide cancellation signal to every connection, including client
convenience methods whose signature omits a signal. Use no automatic retry or
server selection fallback.

The selected ADB route's physical client/server restart remains pending. The
earlier ordinary-Remote restart and ADB disconnect/reconnect checks do not
substitute for it. AC3 and the controls prerequisite remain unaccepted until
that approved check has protocol and owner-observed evidence. One retained
foreground read returned no package and an ambiguous result; it establishes an
unavailable current-app observation. A later YouTube observation does not turn
that gap into a known state. The 15-second stale threshold below is still a
production bound to validate, not a physically measured guarantee.

## Minimum implementation contract

### Ownership and configuration

`modules/onn` exports its own SDK `ModuleRegistration`, schemas, factory,
simulation and module-owned React frontend. It owns one target, ordered action
queue, private SQLite store and SDK outcome outbox. Existing runtime registration
and dashboard collection compile those contributions; no discovery manager or
protocol-provider registry is introduced. The core dispatcher remains the only
gateway/MCP command entry; the module owns device effects.

One manually entered module section names a neutral routing ID, configuration
revision, exact private ADB Unix socket path and exact device connection serial.
The setup record pins the qualified host executable/version and key ownership.
No command accepts an IP, port, path, package, URL or shell string. Refuse missing
configuration and an unowned or incorrectly protected dependency. Do not start,
stop or replace another owner's ADB process. Device access is lazy; module start
opens local stores and bus resources without waiting for the ONN.

### Actions

Each profile-2.0 command uses the shared command guards, routing subject,
request ID and registered error/outcome shapes. Additional payload members are
refused. The following families are reserved, not installed:

| Family | Type | Payload beyond shared guards | Effect |
| --- | --- | --- | --- |
| `onn-key-press` | `org.bunny.onn-key.press.requested` | `key`: `up`, `down`, `left`, `right`, `select`, `back`, `home`, `play-pause` | One ordinary key press. |
| `onn-app-open` | `org.bunny.onn-app.open.requested` | `app`: `youtube` or `stremio` | Resolve and launch that fixed installed LEANBACK app once. No Home, force-stop or alternate launch attempt is appended. |
| `onn-text` | `org.bunny.onn.text.requested` | `text`: nonempty focused input, at most 256 characters | One text insertion, without submission. Implementation must validate representability and escape shell data; unqualified characters are refused visibly before effects. |

An unknown or missing launcher is `unsupported-capability` or `not-found` before
launch. Resolver output is validated against the selected fixed package; it
cannot supply another target or arbitrary shell. Text goes over the private
protocol socket, never a host subprocess argument, environment variable or file.
The initial verified text is ASCII with spaces. Extend that input qualification
through source fixtures and physical acceptance before claiming other forms.

### Current state, deadlines and outcomes

Use the shared `device/2.1` record for neutral identity, configuration revision,
generation, availability and qualified capabilities. Reserve `onn-state/2.0`
(`org.bunny.onn-state.updated`) for `id`, `revision`, connection generation,
connection status (`unknown`, `available`, `unavailable`), and current app.
Current app is either `{status: "unknown"}` or a timestamped known value
`youtube`, `stremio`, `other` or `none`. Do not publish other package names,
private addresses or a last observation as a current fact. A command's app
selection does not become an app observation.

Use the existing device reply deadline of five seconds and outcome deadline of
30 seconds. The module accepts only after its durable fence commits. Its one
in-flight action has a whole-operation limit of five seconds or the remaining
command expiry, whichever ends first; socket connect, version/target selection,
write and reply all share it. At most 16 accepted pending actions are held in
memory. Expired queued work has no effect. Poll only the configured target for
current-app observations every five seconds, with the same five-second read
bound; mark observations stale after 15 seconds. These are selected production
bounds to validate, not measured physical latency guarantees.

Recheck target, configuration/generation guard, expiry and the persistent fence
immediately before the effect. A lost device answer after a possible write is
`uncertain` with `uncertain-result`; do not guess failure or send again. A known
pre-write dependency refusal is `failed`/`none` (or an immediate `unavailable`
refusal before acceptance). A validated successful Android command response
permits `succeeded`/`transmitted`, not observed TV success. A validated Android
launch status can establish its reported launch result; visible app/playback
still needs observation. Ambiguous status remains uncertain.

Invalid shape/value, wrong target/guard, expiry, unsupported action and full queue
use existing `invalid-message`/`invalid-request`, `not-found`,
`revision-conflict`, `expired`, `unsupported-capability` and `capacity` codes.
Admission storage failure refuses before acceptance and effects. A later outbox
failure retains the fence and actual effect evidence; it never becomes a claim
that nothing was sent. Device failure changes
device availability and the outcome, not module health. Shared diagnostic events
carry continuity and fixed safe details, never raw vendor errors or input text.

### Persistence and sensitive text

Retain command fences, requested action identity, outcome evidence and state
privately. Keep credentials excluded. Focused input may itself contain a
credential, so **all input text is memory-only**; do not try to identify secrets
after saving it. The current core tracker saves command payloads. Implementation
must add a narrowly scoped admission path for the exact ONN text family before
text can ship through either browser or MCP.

The durable text row retains its normal caller/request/target/type identity,
omitted-payload marker and a domain-separated HMAC of the canonical semantic
request (caller, request ID, key/target, type, schema, guards and input), using one
stable independent private key. Exclude transport timestamps and trace context
from retry comparison. Pin the key identity privately so a replacement refuses
before effects. Never save plaintext in core
or module rows, WAL, history, inbox, outbox, diagnostics, process arguments or
browser storage. A matching request returns its retained result without sending;
a changed caller, target or input conflicts. A missing/changed HMAC key refuses
effects; it cannot erase the fence or reconstruct the old input.

Inbox Send again refuses an omitted text payload before handling the old item.
The owner can enter fresh text and make a new request. Ordinary non-sensitive
commands keep the existing deliberate Send again behavior. Restart settles
unfinished fences truthfully and sends no saved command, including after a late
outcome or outbox republication. Retain latest state through compatible runtime
recovery; a backup is not an instruction to replay or overwrite it.

## History boundary and verification

Private structured samples matched changed YouTube titles/channels, Stremio
series/episode titles and a movie, pause/resume, duration/position and app exits.
They did not supply stable media IDs, genre or numeric season/episode fields.
A YouTube ad reported the selected main title with a short ad duration and
playing state, while its explicit advertisement field was absent. That absence
also occurred during main playback. Duration change alone does not qualify
reliable ad classification or main-content watched time.

The temporary Java/Dex reader was qualification-only and was removed after the
approved session. No production Android metadata companion is selected.
History design must retain original selected observations privately and
indefinitely, with credentials excluded, and resolve reliable playback/ad
classification before accepting watched-time totals. Missing topic fields stay
unknown; inferred politics/AI labels must be marked as inference. Automatic ad
Skip remains a feasibility question and has no action authority from this record.

Implementation verification must cover typed actions and safe input, target
selection, lifetime cancellation, refusal before write, ambiguity after write,
duplicates, queue/expiry/storage failure, reconnect/restart without replay and
credential exclusion across all durable surfaces. Use existing SDK/module test
facilities, fake protocol services and disposable runtime/browser/accessibility
checks. Then qualify the installed TypeScript client through the authenticated
dashboard and a real MCP client, with a separately approved physical sequence.
Keep every source, protocol, client and physical result distinct.
