# Runtime verification runs

The runtime adapter ([#920](https://github.com/jimmie-potts/agent-device-hub/issues/920)) for the
[app verification contract](../../../docs/app-verification.md). The lifecycle comes from
[`@jimmie-potts/app-verify`](../../../packages/app-verify/README.md), unchanged. This directory supplies the plug-in
([`plugin.ts`](plugin.ts)), the process each run serves ([`supervisor.ts`](supervisor.ts)), the runtime child it
forks ([`child.ts`](child.ts)) and the run adapter of the scenario catalog ([`adapter.ts`](adapter.ts)). It is
built into `apps/runtime/dist/verify/` with the runtime.

A run serves the runtime from the checkout on the WSL host, with synthetic data and simulated devices:

| Part | Kind | What it is |
| --- | --- | --- |
| Runtime | actual | The runtime through its own entry (`runMain`) with `--simulate`, `--edge`, `--config`, `--environment test`, `--log-level info`, `--record-spans` and the run's state directory: the shipped module list, or the fixture modules |
| Gateway | actual | The runtime's gateway on its listener (#835): the SDK edge, `/api/v2`, MCP, module pages and browser sign-in. Each part has a run-generated client credential with its catalog grant |
| Configuration | synthetic | `<data>/config/runtime-config.json`, owner-only: each configured module's section (#919), with one token file per module under `<data>/config/secrets/` holding the synthetic token `tok_SYNTHETIC919`, or for the shipped run each shipped module's simulated section (#929), and the edge's section (#835), which names `<data>/config/edge-credentials.json`, lets a trusted loopback page sign a browser in, turns MCP on and turns the launcher off, since a run's state directory is too deep for its socket. The parts' tokens, `tok_SYNTHETIC835_<random>`, are in `<data>/config/part-tokens.json` for the adapter; the runtime holds only their digests |
| Fixture modules | simulated | The core (#831), with its action tracker and history (#782) and stand-in parts for the inbox and a readable copy of history until #923, the fixture lamp, chime and configured sign, the shipped playback module (#929), the shipped LIFX module (#928) with simulated bulbs, the shipped Tidbyt module (#930) with a simulated cloud, the shipped Pixoo module (#843), the shipped Nanoleaf module (#844) with a simulated Lines controller, and a harness module that reports what the bus publishes |
| Devices | simulated | `SimulatedLamps`, `SimulatedChime`, `SimulatedSigns`, the playback module's `SimulatedSpeakers`, the LIFX module's `SimulatedLifx`, the Tidbyt module's `SimulatedCloud` and the Nanoleaf module's `SimulatedNanoleaf`, held by the supervisor and reached over the runtime child's IPC channel, so they outlive a runtime crash as real devices would. The simulated Pixoo lives in the runtime child, beside the module that reaches it: the child reports what the Pixoo shows, and the supervisor starts each new child's Pixoo with the mode last set and the panel the last one showed |
| Parts | simulated | The scenario's hook, operator, panel and reader: remote parts that the capture step connects to the edge |

The supervisor restarts a runtime that dies on its own, such as an armed crash between the lamp's commit and its
publish, on the same port and state directory, as the service manager would. It gives up and ends the run after five
such restarts within a minute. Starts and restarts run one after another, so overlapping restart requests never race
for the port. Its loopback harness API, the run's `harness` endpoint, drives the simulated devices and the run's
controls: hold, release, fail the next switch, fault the chime, bring the sign online or offline, play, pause, stop,
silence or slow either simulated speaker or switch it to another input and refuse or never answer its next command, take a LIFX
bulb off the network or back, take the simulated Tidbyt cloud offline or back, set the Pixoo online, offline or silent, take the simulated Nanoleaf controller offline or online, switch it as its app would or lose its next power or brightness answer, arm a crash, lose an acknowledgment, end a part's stream at the edge, and restart. A simulation that names an unknown device, action or field is refused with 400 and changes nothing. It also
reports the run's state: the devices, the runtime's log records and everything its bus published, each with the
runtime's generation, and it answers [one request's records and spans](#follow-one-request). It answers only local JSON
requests that name its listener, as the runtime's health does. Ending a stream takes only a part's source,
`bunny/parts/<role>`.

## Run scenarios

| Scenario | Starts |
| --- | --- |
| `fixtures` | The core with its stand-in parts, the lamp and the chime, for exploring (the default) |
| `shipped` | The runtime's own entry point with the shipped module list: the core and each device module, configured with its factory's simulated section (the playback module's simulated speakers, the LIFX module's simulated pendant and Beam, the Tidbyt module's simulated cloud, the Pixoo's simulated device `pixoo-1`, and the Nanoleaf module's simulated Lines) |
| `pixoo-migrated` | The same shipped runtime on a migrated Pixoo library (#931): the seed writes a synthetic library of the installed schema version 3 to `<data>/pixoo-library`, migrates and verifies it into the run's state directory with the [migration tool](../README.md#pixoo-library-migration), as the installer will at the cutover, keeps each one's JSON line in `<data>/migration/`, and fails the start unless both exit 0 |
| `nanoleaf-migrated` | The same shipped runtime with the Nanoleaf module on a migrated bridge state (#933): the seed writes a synthetic bridge state of the installed shape, the Lines and NL22 Light Panels at the simulated controllers' addresses, to `<data>/nanoleaf-bridge`, runs the [migration tool](../README.md#nanoleaf-migration)'s `migrate` into the run's state directory, with the tokens in `<data>/config/secrets/` and the section in `<data>/migration/`, puts that section into the run's configuration file in place of the simulated one, runs `verify` against that file, keeps each line in `<data>/migration/`, and fails the start unless both exit 0 |
| one per catalog scenario, such as `end-to-end` | The modules that catalog scenario's seed names, with its configuration file when the seed has one: `configured-module` (a valid section, with the sign offline at first), `misconfigured-module` (an invalid one, so health shows the sign `refused`), `speaker-playback` (the core and the playback module, with both simulated speakers answering on another input), `lifx-bulbs` (the core and the LIFX module, with a simulated pendant and Beam), `tidbyt-tiles` (the core, the playback module and the Tidbyt module, with an empty simulated cloud), the four Pixoo scenarios below, and `nanoleaf-wall` (the core and the Nanoleaf module with a simulated Lines controller) |
| `control-real-transports`, `control-installed-port`, `control-default-state` | Boundary negative controls; see below |

## Capture steps

| Step | What it does |
| --- | --- |
| `edge-grants` | A remote part with the run's reader credential syncs the core's sessions; one with a made-up token is `unauthenticated` |
| `scenario-<catalog id>` | Runs that catalog scenario through the run adapter on a freshly seeded run, attaches `scenario-result.json`, and expects every step to pass, every message to follow profile 2.0 and the boundaries to hold. The configured scenarios also expect the synthetic token in no log record, message, health entry or reader copy |
| `follow-one-request` | Follows one request through the run's diagnostics in four cases, then a killed runtime, an absent request and a capped query, and attaches each answer; see [below](#follow-one-request). Seeded fresh with the fixture modules |
| `control-scenario-fails` | A negative control, not a catalog scenario: it expects lamp-1 on though nothing switched it, so it must fail |
| `control-follow-fails` | A negative control: it expects the follow query to find a request that was never sent, so it must fail |

The run adapter implements the catalog's `Harness` in real time. Its parts are remote, so the per-transport
expectations are the remote ones, and every catalog scenario passes as it does in the in-memory harness. Its `gateway`
call reaches the runtime's gateway over HTTP, as a part with its token, a browser signed in by a trusted loopback page,
a stranger or a caller with neither, and its `dispatch` sends a device's command through the core's dispatcher on the
gateway's action route (#782). Its
`disconnect` has the runtime's edge end the part's stream, and the same remote part reconnects and hears of the gap,
as in the in-memory harness. The part's timers wait until the next `wait`, so it stays away for the steps in between. A
step's page shows the runtime's health document. The step loads it at its start and again at its end, so `after.png`
shows health as the step left it. There is no dashboard before #922.

## Follow one request

A run keeps two records of what its runtime did: the log records that the supervisor reads from the runtime's stderr, as
the service manager's journal would, and the spans, which the runtime writes to a bounded, private
[span file](../README.md#the-span-file) in its state directory. The harness's `GET /api/harness/v1/follow` reads both for
one request or one trace (Hub #950):

```bash
curl -s "<harness endpoint>api/harness/v1/follow?request=<request id>"
curl -s "<harness endpoint>api/harness/v1/follow?trace=<32 hex digits>&records=20&spans=20"
```

The `start` result and the preview card name the harness endpoint. Name exactly one of `request` and `trace`, and give
each of `request`, `trace`, `records` and `spans` at most once; each limit is a whole number from 1 to 100 and defaults to
50. A parameter the query does not know is ignored. A request or limit that is not valid, or a parameter given twice, is a
`400` with `invalid-request` and a fixed message, and the query never echoes it. The answer is JSON (`runtime-follow/1.0`):

| Field | What it says |
| --- | --- |
| `result` | `found`, or `none-found`: no record or span carries the ID, which says nothing of what happened. See `gaps` |
| `records` | The log records, each with the runtime that wrote it (`generation`), its level, event, trace and registered attributes |
| `spans` | The spans, with kind, status, duration, links and `parent`: `span` (kept), `caller` (the remote part's context, which the run does not record), `stored-message` (the context a stored message carried) or `missing` (not kept) |
| `decision` | How many commands the bus admitted (`admitted`), how many of them have no ending of their own (`unended`, so `ended` is true only when none lacks one), and the endings it recorded (`replied`, `refused`, `cancelled` or `uncertain`, with level and code). An ending belongs to the command with its message ID: a refusal for no responder, which is never admitted, ends no admitted command. `endings` lists at most as many as the `records` limit |
| `names` | How many matched spans have each name. A name no span has is not listed |
| `matched`, `omitted`, `traces`, `otherOnTrace` | What the query matched, what its limits left out (`omitted` counts records, spans and endings past the limits, and trace IDs past the 16 that `traces` names), the traces it touched, and what else those traces hold, such as another request's records |
| `searched` | How many records and spans it read and how many it could not, the runtimes the run has started, and the lowest level written |
| `gaps` | Each way the evidence can be incomplete, with its meaning, below |

A request ID takes only the records and spans that carry it, so another request on the same trace never leaks in; a trace
ID takes everything on it and the spans of other traces that link to it, such as a replay. Every record and span must pass
the diagnostic contract's validator, and the answer is built from the validated values alone: no payload, message or error
text reaches it, and a record or span the contract refuses is counted in `searched` and shown nowhere.

| Gap | Meaning |
| --- | --- |
| `generation-ended-without-stop` | A runtime ended without writing `runtime.stopped`, as after a crash or kill: its last records, its counts of lost telemetry and the spans it had not written are unknown |
| `telemetry-lost` | A runtime said at its stop that its queues or the contract refused this many records and spans |
| `losses-uncounted` | A runtime has not recorded its stop: while it runs, its losses are counted only when it stops, in `runtime.stopped`, and if it ended abruptly they are lost, so the records and spans that its queues dropped or its sinks lost are not shown. Every answer about the current runtime has this gap, whether it is live or was killed and not yet restarted |
| `spans-evicted`, `spans-eviction-unknown` | The span file keeps the latest spans (up to 1,024, at least 512 unless spans are large, since each segment also rotates at 2 MiB) and let this many go, or does not say, as after a runtime was killed between starting a segment and writing its header |
| `spans-truncated` | A span file was longer than its bound, so the read stopped |
| `spans-not-recorded`, `spans-unreadable` | The run has no span file, or it could not be read |
| `unreadable` | Journal lines that were not records, records the contract refused and spans that were not valid, counted and not shown |
| `parent-missing` | Spans continue a parent that is not kept: it was evicted, lost or never ended |
| `capped` | The query's limits left out records, spans or endings, or trace IDs past the 16 it names |

The `follow-one-request` step runs the cases against a freshly seeded run and attaches each answer as
`follow-<case>.json` in its capture directory. Each command is an action the operator sends through the core's
dispatcher on `POST /api/v2/commands/lamp-switch` (#782), so its records include the core's tracker steps and its spans
start with the dispatcher's server span. The cases: `success` (one trace, no span's parent missing, and no gap but the live runtime's `losses-uncounted`), `refusal` (the lamp
refused `lamp-9` with `not-found` at INFO, and no device call), `uncertain` (the device held the switch past the deadline:
`uncertain-result` at WARN, and the late outcome), `replayed` (a lost acknowledgment and a restart: one publication record,
two publish spans, the second a new root that links to the stored context, and the core's duplicate, which it
acknowledged again), `crash` (the operator's call lost its connection with the runtime, which was killed between the
lamp's commit and its publish: no ending recorded, the runtime named, the spans that never
ended not reported, and the two that ended with their parents missing), `missing` (a request nothing carries), `capped`
(a query limited to two records and one span) and `trace` (the success by its trace ID). A reviewer can read one answer to
follow one command end to end, or run `scenario-end-to-end` and query any of its request IDs, such as `req-held`. The host
route runs only the core's operations, so a reviewer on it runs the step and reads the attached answers; one who can reach
the run's loopback harness queries it directly.

The harness's journal is what the supervisor read from the runtime's stderr: each line that is a JSON object with an
event name, and a count of every other line with content, such as a stack trace. The supervisor waits for a stopped
runtime's stderr to drain before it starts the next, so a clean stop shows its `runtime.stopped` record. Records below
`info` are not written, so a DEBUG observation, such as a duplicate that a consumer only counts, is absent by design.

## Boundaries

A run never reaches an installed service, a port of one, personal state or a device. Three checks prove it at `start`
and in `doctor`:

| Check | Passes when | Negative control | What crosses |
| --- | --- | --- | --- |
| `simulated-transports` | The runtime's `runtime.started` record says it built its modules with `--simulate` | `control-real-transports` | The shipped runtime runs without `--simulate` |
| `no-outbound-connections` | The guard refused no outbound TCP connection or UDP datagram; the runtime only listens | `control-installed-port` | A probe module reaches for the installed Hub's port 8788 with `fetch` and with `node:http`; the guard refuses both before they connect |
| `private-state` | What the run observes: the runtime's home, read from its environment, is private to the run; nothing exists under `<home>/.local/state`; every database the runtime has open is under `<data>/state`; and the edge's credentials file and the parts' token file are owner-only | `control-default-state` | The runtime runs without `--state-dir`, so it creates its default directory under `<home>/.local/state`, which in a run lies under the run's private home |

The guard loads through `NODE_OPTIONS`, so it runs first in the runtime, in each worker thread that inherits its
environment (a file worker, as the runtime starts) and in every Node process it starts. It refuses every outbound TCP
connection made through `net`, `tls`, `http`, `https` or `fetch`, and every UDP send or connect through `dgram`, before
anything leaves. Each attempt goes to the run's `guard-report.jsonl`, which the check reads. A worker a module starts
through its context keeps the process's `NODE_OPTIONS` even when the module gives it its own `env` (#919), and a worker
call inherits the environment. The guard does not cover a native addon, a non-Node binary, a Node process or worker
thread started outside the module context with `NODE_OPTIONS` cleared or replaced, an `eval` worker, or a name lookup
through `node:dns`. The runtime uses none of these today.
A module story that adds a device transport adds its simulated one too.

The controls fail their start with `check-failed` by design, and are start-only: `scenario <run-id> <control>` and
`handoff <run-id> --reset <control>` are refused with `start-only-scenario` (exit 2) before anything changes. The
core already refuses a ready line on an installed service's port, and the supervisor gives the runtime a home inside
the run, so even a control never touches the owner's files.

## Entry points

Run at most one Acceptance run at a time on this host, because memory is the constraint
([docs/sdlc.md](../../../docs/sdlc.md#acceptance-review)). `npm run -s verify:runtime` refuses a second `start` with
`run-active` while any run is live ([one run at a time](../../../docs/app-verification.md#one-run-at-a-time)). Run with Node 24 from the repository root, and build first:
`start` serves the built candidate, and the `build-current` check fails a start whose sources are newer than the
build.

```bash
npm run build
npm run -s verify:runtime -- help
npm run -s verify:runtime -- start                                  # the fixture modules
npm run -s verify:runtime -- capture <run-id> scenario-end-to-end   # reseeds that scenario first
npm run -s verify:runtime -- capture <run-id> edge-grants
npm run -s verify:runtime -- capture <run-id> follow-one-request   # one request, case by case; answers attached
npm run -s verify:runtime -- scenario <run-id> zero-modules
npm run -s verify:runtime -- capture <run-id> scenario-zero-modules
npm run -s verify:runtime -- handoff <run-id>
npm run -s verify:runtime -- doctor
npm run -s verify:runtime -- stop <run-id>
```

To check a module's configuration as an operator would (#919), start a configured scenario and read health and the
runtime's records:

```bash
npm run -s verify:runtime -- start --scenario configured-module      # a valid section; the sign starts offline
npm run -s verify:runtime -- capture <run-id> scenario-configured-module
npm run -s verify:runtime -- stop <run-id>
npm run -s verify:runtime -- start --scenario misconfigured-module   # an invalid section; health shows the sign refused
npm run -s verify:runtime -- capture <run-id> scenario-misconfigured-module
npm run -s verify:runtime -- stop <run-id>
```

To follow and control the speakers as an operator would (#929), start the playback scenario. Its capture step plays a
song to the HT-A9, pauses it, switches AirPlay to the Move, pauses that, silences the Move until the record turns
`stale`, and sends a command the Move never answers. `scenario-result.json` lists each step with what it observed.

```bash
npm run -s verify:runtime -- start --scenario speaker-playback      # the core and the playback module; both speakers on another input
npm run -s verify:runtime -- capture <run-id> scenario-speaker-playback
npm run -s verify:runtime -- stop <run-id>
```

By hand, the run's `harness` endpoint drives the speakers: `POST /api/harness/v1/simulate` with
`{"device": "playback", "speaker": "sony" | "sonos", "action": "play", "title": "..."}`, or with the action `pause`,
`stop`, `other-input`, `silent`, `slow` (each call answered 400 ms late, #930), `answer` (answering again, at once),
`refuse-next` or `hang-next`. `GET /api/harness/v1/state` shows each
speaker's status and the actions it received. A remote part with the reader's grant syncs `playback` from the edge, and
one with the operator's grant sends `playback-control` to `bunny.cmd.playback-control.living-room`.

To try the LIFX module (#928) as a person would, with a simulated pendant and Beam:

```bash
npm run -s verify:runtime -- start --scenario lifx-bulbs
npm run -s verify:runtime -- capture <run-id> scenario-lifx-bulbs
npm run -s verify:runtime -- stop <run-id>
```

To watch the Tidbyt's tiles (#930) follow agent status and what plays, on a simulated cloud, start the Tidbyt scenario.
Its capture step starts a session and a turn, sends a burst of approval prompts inside the 15-second gate, plays a song
to the Move, restarts the runtime with the Move answering 400 ms late once the card has stood past its gate, pauses the
song and stops it, and checks each tile against the frame the reader's own copies call for. Time is real, so the step
takes about a minute and a half.

```bash
npm run -s verify:runtime -- start --scenario tidbyt-tiles
npm run -s verify:runtime -- capture <run-id> scenario-tidbyt-tiles
npm run -s verify:runtime -- stop <run-id>
```

By hand, `GET /api/harness/v1/state` shows `devices.tidbyt`: each installation the cloud holds (`agentdevicehub` for
agent status, `nowplaying` for the card) with its frame as 32 text rows of 64 characters (`.` dark, `A` amber, `B`
blue, `G` green, `W` white or grey, lower case when dimmed), how often it was pushed and when, and every call the cloud
heard. `POST /api/harness/v1/simulate` with `{"device": "tidbyt", "action": "offline"}` or `"online"` takes the cloud
away or brings it back, and the speakers' and the hook's actions above drive what the tiles show. A remote part with the
reader's grant syncs `device` from the edge and finds the Tidbyt's record from `bunny/modules/tidbyt`.

To check the Pixoo module (#843) as a reviewer would, start each Pixoo scenario's run, capture its scenario, and read
the harness state's `devices.pixoo` (what the simulated Pixoo shows) and health:

```bash
npm run -s verify:runtime -- start --scenario pixoo-monitor        # Monitor follows the core's sessions
npm run -s verify:runtime -- capture <run-id> scenario-pixoo-monitor
npm run -s verify:runtime -- stop <run-id>
npm run -s verify:runtime -- start --scenario pixoo-media          # a media command accepted, then completed
npm run -s verify:runtime -- capture <run-id> scenario-pixoo-media
npm run -s verify:runtime -- stop <run-id>
npm run -s verify:runtime -- start --scenario pixoo-now-playing    # a song's card over Monitor, then a whole takeover of Media past 30 s
npm run -s verify:runtime -- capture <run-id> scenario-pixoo-now-playing
npm run -s verify:runtime -- stop <run-id>
```

To use the Nanoleaf module (#844) as a person would, start its scenario: the core and the Nanoleaf module, configured
with a simulated Lines controller. Its capture follows an agent session onto the wall, sets Work, Quiet and Free,
switches the wall off from its app, takes it offline, sets Quiet meanwhile, which succeeds as observed, and brings the
wall back at the Quiet level, shows a second session on a Line, then loses a brightness write's answer so the wall shows
held and degraded until a Work command:

```bash
npm run -s verify:runtime -- start --scenario nanoleaf-wall
npm run -s verify:runtime -- capture <run-id> scenario-nanoleaf-wall
npm run -s verify:runtime -- stop <run-id>
```

By hand, a remote part with the run's operator grant sends `device-mode-set` to `bunny.cmd.device-mode-set.wall`, and
one with the reader's grant syncs `device`, `nanoleaf-wall` and `nanoleaf-animations` from the owner
`bunny/modules/nanoleaf`; the harness API's `state` shows
the simulated controller under `devices.nanoleaf`, and `simulate` takes `{"device": "nanoleaf", "action": "offline"}`,
`online`, `power-off`, `power-on` or `lose-next-answer` (the next power or brightness write reaches the wall and its
answer is lost).

The configuration file and its token file are under `<runtime dir>/data/config/`. The token is synthetic, and no
health page, record or proof holds it.

To check the Pixoo library migration (#931) as an operator would, start the migrated run, read what the migration
reported and what the runtime serves, then run the tool by hand. Its lines hold counts, codes and hashes only:

```bash
npm run -s verify:runtime -- start --scenario pixoo-migrated
data=<the run's runtime dir>/data; origin=<the run's origin>
cat $data/migration/migrate.json $data/migration/verify.json                          # migrated, then verified with every mismatch count 0
reader=$(node -p "require('$data/config/part-tokens.json').reader")
curl -s -H "authorization: Bearer $reader" "$origin/api/v2/families/pixoo-playlist"     # the three synthetic playlists, items in order
curl -s -H "authorization: Bearer $reader" "$origin/api/v2/families/pixoo-rendition"    # one record per migrated rendition
node apps/runtime/dist/src/migrate-pixoo.js verify --library $data/pixoo-library --state-dir $data/state; echo $?   # runtime-running, 3
t=$(mktemp -d ~/.cache/agent-device-hub/pixoo-XXXX)                                    # a private folder outside every checkout
node apps/runtime/dist/src/migrate-pixoo.js migrate --library $data/pixoo-library --state-dir $t/a; echo $?        # migrated, 0: the run's digests
node apps/runtime/dist/src/migrate-pixoo.js migrate --library $data/pixoo-library --state-dir $t/b; echo $?        # the same line again
node apps/runtime/dist/src/migrate-pixoo.js migrate --library $data/pixoo-library --state-dir $t/a; echo $?        # destination-not-empty, 3
node apps/runtime/dist/src/migrate-pixoo.js migrate --library $data/pixoo-library --state-dir $t/c --min-free-bytes 9007199254740991; echo $?   # disk-short, 3
printf x >> "$(ls -d $t/a/modules/pixoo/media/originals/* | head -1)"
node apps/runtime/dist/src/migrate-pixoo.js verify --library $data/pixoo-library --state-dir $t/a; echo $?         # mismatch with files 1, 1
rm -rf $t
npm run -s verify:runtime -- stop <run-id>
```

To check the Nanoleaf migration (#933) as an operator would, start the migrated run, read what the migration reported
and what the runtime serves, then run the tool by hand in a private folder. Its lines hold counts, codes and hashes
only:

```bash
npm run -s verify:runtime -- start --scenario nanoleaf-migrated
data=<the run's runtime dir>/data; origin=<the run's origin>
cat $data/migration/nanoleaf-migrate.json $data/migration/nanoleaf-verify.json          # migrated, then verified with every mismatch count 0
reader=$(node -p "require('$data/config/part-tokens.json').reader")
curl -s -H "authorization: Bearer $reader" "$origin/api/v2/families/nanoleaf-wall"          # the migrated settings, palette, projects and modes
curl -s -H "authorization: Bearer $reader" "$origin/api/v2/families/nanoleaf-animations"    # the two migrated favorites
tool=apps/runtime/dist/src/migrate-nanoleaf.js
node $tool verify --source $data/nanoleaf-bridge --state-dir $data/state --secrets-dir $data/config/secrets --section $data/config/runtime-config.json; echo $?   # runtime-running, 3
mkdir -p ~/.cache/agent-device-hub && t=$(mktemp -d ~/.cache/agent-device-hub/nl-XXXX)        # a private folder outside every checkout
to() { echo --source $data/nanoleaf-bridge --state-dir $t/$1 --secrets-dir $t/$1-secrets --section $t/$1-out/section.json; }
node $tool migrate $(to a); echo $?      # migrated, 0: the run's digests
node $tool migrate $(to b); echo $?      # the same line again: the digests name each secret by its file's name
node $tool migrate $(to a); echo $?      # destination-not-empty, 3
node $tool verify $(to a); echo $?       # verified, 0
printf x >> $t/a-secrets/nanoleaf-wall-token
node $tool verify $(to a); echo $?       # mismatch with secrets 1, 1
sed -i 's/192.0.2.11/192.0.2.99/' $t/a-out/section.json
node $tool verify $(to a); echo $?       # mismatch with configuration 1 too, 1
grep -rl tok_SYNTHETIC919 $t             # only the secret files hold the token
rm -rf $t
npm run -s verify:runtime -- stop <run-id>
```

The bridge state, its tokens and its names are synthetic. A reviewer can also plant a corruption in a copy of the
migrated store, such as a changed palette color, and see `verify` count it.

To see two device modules serve `device` side by side, each for its own devices (#967), start `device-owners`: the
lamp and the configured sign both run, and the reader keeps one copy of `device` from each, synced by name:

```bash
npm run -s verify:runtime -- start --scenario device-owners
npm run -s verify:runtime -- capture <run-id> scenario-device-owners
npm run -s verify:runtime -- stop <run-id>
```

The trusted host route runs the same operations as a transient user unit:
`npm run -s verify:host -- --host --app runtime --checkout <absolute checkout> -- <operation>`.

A reviewer can also use the run by hand. Its preview URL, which the card links, is the runtime's health page. The
same origin serves the gateway (#835), which takes each part's token from `<runtime dir>/data/config/part-tokens.json`
(by role: `hook`, `operator`, `panel` and `reader`, with the catalog's grants) and signs a browser in from a trusted
loopback page. `start` never prints a token.

To check the gateway as an operator would (#835), start the fixtures run, read its tokens into the shell without
printing them, and call it:

```bash
npm run -s verify:runtime -- start                                   # the fixture modules
origin=<the run's origin>; tokens=<runtime dir>/data/config/part-tokens.json
reader=$(node -p "require('$tokens').reader"); hook=$(node -p "require('$tokens').hook")
curl -s -H "authorization: Bearer $reader" "$origin/api/v2/families/session"          # sessions on /api/v2
curl -s -H "authorization: Bearer $reader" "$origin/api/v2/families/Bad_Family"       # invalid-request, the shared error body
curl -s -H "authorization: Bearer $hook" "$origin/api/v2/families/session"            # forbidden: a hook's grant only publishes
curl -s "$origin/api/monitor/v1/sessions"                                              # not-found: a route of the old Hub
npm run -s verify:runtime -- capture <run-id> scenario-gateway-reads                   # MCP's core_sessions, refusals and the route log
npm run -s verify:runtime -- capture <run-id> scenario-grants-and-duplicates
npm run -s verify:runtime -- capture <run-id> scenario-approval-recovery
npm run -s verify:runtime -- stop <run-id>
npm run -s verify:runtime -- start --scenario module-contributions   # the sign's page, preview, settings and tool
origin=<this run's origin>; tokens=<this run's runtime dir>/data/config/part-tokens.json
hook=$(node -p "require('$tokens').hook"); reader=$(node -p "require('$tokens').reader")
curl -s -H "authorization: Bearer $reader" "$origin/api/v2/modules/sign/settings"     # the sign's settings: every reader's
curl -s -H "authorization: Bearer $hook" "$origin/api/v2/modules/sign/settings"       # forbidden: a hook's grant may not read
curl -s -H "authorization: Bearer $reader" "$origin/api/v2/families/sign"             # the sign's records
npm run -s verify:runtime -- capture <run-id> scenario-module-contributions
npm run -s verify:runtime -- stop <run-id>
```

A browser opens a module's page after it signs in from the run's own origin: a page there that posts `{}` to
`/api/v2/browser/session` with `bunny-request: 1` gets the session cookie, and `/modules/sign/preview` then shows the
sign's page and its preview. Without the cookie the page answers 401.

## Checks

`npm run test:runtime:verify:built` judges every capture step through `runCaptureStep` on runs it starts without a user
manager, and starts each negative control. It tests the supervisor's stop, crash restart, restart serialization, orphan
handling and harness API, and the follow query: the supervisor's route, a clean restart and a killed runtime, and the
pure query's cases with their negative controls. It also tests the guard's reach in every thread and child process, and
that `build-current` watches every source the run loads.
Its lifecycle tests drive real transient units through the wrapper and skip with a printed reason where there is no
user manager (#873). See [Runtime verification runs](../../../docs/development.md#runtime-verification-runs).
