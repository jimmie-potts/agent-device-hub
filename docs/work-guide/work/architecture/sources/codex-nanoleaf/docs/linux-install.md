# Fresh Linux installation

Run the existing Nanoleaf processes in Linux with private Linux SQLite state and
one light-writing worker per registered device. The wall map, controller API and Node MCP host are
separate services. Hooks and CLI commands update the same state and start the
worker when needed. Windows can still run Codex Desktop and the browser.

[Issue #54](https://github.com/jimmie-potts/codex-nanoleaf/issues/54) owns source
support. [Issue #55](https://github.com/jimmie-potts/codex-nanoleaf/issues/55) owns
the installed WSL, real-client and physical checks. See the
[ownership decision](decisions/0007-linux-runtime-ownership.md) and
[runtime specification](../openspec/specs/linux-runtime/spec.md).

## Prepare the host

Use ordinary Ubuntu WSL with Linux Python 3.12 or newer, Python venv/pip support,
native Linux Node 24 and npm. Setup downloads the locked dependencies. User
systemd operation must work in the ordinary WSL terminal; foreground commands
are available when a service manager is unsuitable. Runtime availability follows
WSL's lifetime. This project adds no Windows startup launcher or always-on host;
[ADR 0011](decisions/0011-runtime-availability-follows-wsl.md) records that
choice and defers hosting off WSL to the hub. The user units start with the
installing user's session, for example a WSL terminal; whether a Codex Desktop
task running in WSL starts them has not been measured.

Before setup registers active hooks, make sure no other Nanoleaf worker, map,
controller or MCP process controls the device. Preserve unrelated applications,
hooks and Codex data. Two workers must never control the device concurrently,
even if their databases are separate.

The fresh installation imports no old tasks, preferences, credentials or scene
state. Old Nanoleaf data may remain unused. No backup, data migration, rollback
tooling or soak period is required.

## Install from the reviewed checkout

Record `git rev-parse HEAD` with the #55 acceptance evidence. From that checkout:

```bash
read -r -p 'Nanoleaf private IPv4 address: ' NANOLEAF_IP
python3 bridge/install_linux.py --ip "$NANOLEAF_IP"
unset NANOLEAF_IP
```

Paste the device token at the hidden prompt. For unattended preparation,
`--token-file /private/path/device-token` reads a token-only regular file. Keep
that file private. Do not put the token in a command argument, repository,
screenshot or issue. Setup validates device layout with a read request; it sends
no light write and starts no service or worker.

Setup defaults to `~/.local/share/codex-nanoleaf`, creates it with owner-only
permissions, and keeps its SQLite databases, credentials, copied runtime and
Python virtual environment there. The selected Node executable is also copied
into that installation, so services do not depend on the source checkout.
`--state-dir` can choose an empty directory on a supported local Linux filesystem,
such as WSL's ext4. Mounted Windows, network and unrecognized filesystem types
are rejected, including resolved symlink destinations. Never place
runtime databases under `/mnt/c`.

`config.json` also registers each device under `devices`; the original Lines
device is `wall` and its token stays under `token`. `layout.json` holds one
entry per device. When newer source opens an existing installation's database,
the [device state specification](../openspec/specs/device-state/spec.md) upgrade
adds the device key in place and preserves tasks, preferences, pending edits,
the active comet and controller history. The same upgrade runs wherever this
source opens a database; only this Linux path is qualified.

The installer replaces only entries with this integration's hook marker and
preserves unrelated handlers and settings. By default it uses
`$CODEX_HOME/hooks.json`, or `~/.codex/hooks.json` when `CODEX_HOME` is unset.
Use `--hooks-file /path/to/hooks.json` to select the actual Codex home, repeating
the option for separate clients. These commands require tasks executing in WSL;
review and trust the new hooks in the client. A hook registered in the Codex
Desktop home on the Windows drive carries the same Linux command and fires only
for tasks that run in WSL; native Windows tasks are not monitored. Registration alone does not prove
that the installed client's sandbox can run them or launch the worker.

For a shared-input cutover, select shared input first, then remove the legacy
Nanoleaf hooks separately from the WSL CLI and Windows Desktop homes:

```sh
nanoleaf shared-select shared
nanoleaf hooks remove --codex-home "$HOME/.codex"
nanoleaf hooks remove --codex-home /mnt/c/Users/ACCOUNT/.codex
```

Hook removal changes only entries carrying this integration's marker and keeps
a private backup. It refuses while legacy input is selected. To roll back,
register the hooks in each Codex home first, then run
`nanoleaf shared-select legacy`. Registration retains the installation's state
directory in new hook commands. Legacy selection refuses when the configured
Codex home lacks a marked handler for any legacy event and directs the operator to `hooks register`.
These commands do not change device mode, tasks, or physical device state.
Registration keeps existing handler positions and restores the original file
on an unchanged remove/register round trip. If unrelated edits intervene, it
preserves those edits and restores missing handlers from the backup. After
either operation, restart each affected Codex client and review required hooks
marked new or modified. Removal can also shift retained shared hooks to a
different trust entry. Verify a fresh prompt through the selected input before
accepting cutover or rollback; a hook file or healthy feed is insufficient.

The existing metadata readers accept explicit mounted paths:

```text
--desktop-state-path /mnt/c/Users/ACCOUNT/.codex/.codex-global-state.json
--metadata-path /mnt/c/Users/ACCOUNT/.codex/.codex-global-state.json
--title-index-path /mnt/c/Users/ACCOUNT/.codex/session_index.jsonl
```

Replace those examples with the files used by the installed Desktop client.
`--metadata-path` defaults to `--desktop-state-path` when supplied. Unavailable
or malformed files retain the readers' existing conservative behavior. The
runtime only reads these files; it never writes Codex's database or marks tasks
read. Mounted JSON is allowed, while shared mounted runtime SQLite is not.

Other options are `--node`, `--npm`, `--systemd-dir`, `--wall-port`,
`--controller-port` and `--mcp-port`. Choose three distinct ports from 1024 through
65535. Setup refuses a nonempty state directory or existing Nanoleaf unit files.
If preparation fails, inspect the reported step and select an empty project
directory for a fresh retry; there is no upgrade or rollback mechanism here.

## Run the services

The default user units are written to `~/.config/systemd/user`. Run these
commands in ordinary WSL:

```bash
systemctl --user daemon-reload
systemctl --user enable --now codex-nanoleaf-wall codex-nanoleaf-controller codex-nanoleaf-mcp
systemctl --user status codex-nanoleaf-wall codex-nanoleaf-controller codex-nanoleaf-mcp
```

Each unit runs a foreground process with a private umask and restarts on failure.
The worker stays on demand. Each registered device has its own instance and
exclusive SQLite lock, and the Lines keep the existing lock file.
For foreground operation, run each command in its own terminal, with the matching
user service stopped:

```bash
~/.local/share/codex-nanoleaf/nanoleaf serve
~/.local/share/codex-nanoleaf/nanoleaf controller-serve --port 41231
~/.local/share/codex-nanoleaf/runtime/node/bin/node \
  ~/.local/share/codex-nanoleaf/runtime/mcp/dist/main.js \
  --config ~/.local/share/codex-nanoleaf/mcp-config.json
```

Use the chosen state directory and controller port for a customized installation.
Default endpoints are:

| Service | Endpoint |
| --- | --- |
| Wall map | `http://127.0.0.1:8765` |
| Controller | `http://127.0.0.1:41231/controller/v1` |
| MCP | `http://127.0.0.1:41230/mcp` |

All listeners bind numeric loopback. A configured occupied port fails; it does
not silently select a replacement. Check the named unit's journal with
`journalctl --user -u codex-nanoleaf-wall` or the corresponding controller/MCP
unit. Stop the port's owner or choose another port in private configuration and
the unit's command; keep MCP's controller port in sync.

```bash
~/.local/share/codex-nanoleaf/nanoleaf status
~/.local/share/codex-nanoleaf/nanoleaf map --no-open
~/.local/share/codex-nanoleaf/nanoleaf mode work
~/.local/share/codex-nanoleaf/nanoleaf mode quiet
~/.local/share/codex-nanoleaf/nanoleaf mode free
```

The map command verifies or starts this installation's map and prints its URL.
It never launches a browser on Linux. Open that URL in the Windows browser and
verify reachability during #55. The page keeps its existing controls and
Host/Origin/edit-token protections. The browser never receives the device token.

Mode commands use existing Work/Quiet/Free behavior. Free releases light control
according to the current scene policy. CLI and controller status describe
desired state, pending work and transport evidence; they do not prove visible
light output. Stopping a listener does not cancel work already owned by the
worker. Stop the services and active worker when retiring this installation.

## Add NL22 Light Panels

Enroll original NL22 Light Panels beside the Lines with the installed launcher.
Enrollment never runs fresh setup, clears tasks or changes hooks, listeners or
machine credentials. It verifies the device before it writes anything:

```bash
read -r -p 'Light Panels private IPv4 address: ' PANELS_IP
~/.local/share/codex-nanoleaf/nanoleaf device-enroll --ip "$PANELS_IP"
unset PANELS_IP
```

Paste the Panels credential at the hidden prompt, or pass `--token-file
/private/path/panels-token` as with Lines setup. To obtain a new credential from the
device instead, add `--pair`. The command asks you to hold the Panels' power
button for 5 to 7 seconds until the lights flash, then press Enter. The device
id defaults to `panels`; choose another with `--device <id>`. The command
refuses `wall`, an address another device already uses, and an existing id at a
different address. Repeating it for the same id and address replaces only the
credential and keeps the device's mode, layout and reservations. Enrollment never
changes a registered address.

If the Panels get a new address, for example after a new DHCP lease, move them
without re-enrolling:

```bash
read -r -p 'New Light Panels private IPv4 address: ' PANELS_IP
~/.local/share/codex-nanoleaf/nanoleaf device-address --device panels --ip "$PANELS_IP"
unset PANELS_IP
```

The command asks the device at the new address, with the stored credential, to
report NL22 Light Panels with the saved triangles in the same places. It refuses an address another
device uses, a different device and an unreachable address, and then changes
nothing. On success it changes only the registered address. The Panels keep their
id, mode, layout, reservations and saved scene, and no light write is sent. No
service needs a restart: a running worker sends to the new address from its next
pass. The command moves registered Light Panels only; it refuses the Lines
device `wall`.

The new device starts in Free and receives nothing until you activate it.
Activation shows only current task status; it replays no earlier wave or comet:

```bash
~/.local/share/codex-nanoleaf/nanoleaf mode work --device panels
~/.local/share/codex-nanoleaf/nanoleaf status --device panels
```

No service needs a restart. Hooks and the worker read the device list each time
they start, and the map reads it on every state request. The controller and MCP
reach the Panels only after you
[add them to the controller](controller-api.md#add-the-nl22-light-panels). The map opens on the Lines; once a second device is
registered, its **Device** control beside the wall heading switches the page to
the Panels, and `?device=panels` in the map URL opens it there directly.

To remove the Panels, hand them back first and wait until status shows nothing
pending, so they restore their own scene:

```bash
~/.local/share/codex-nanoleaf/nanoleaf mode free --device panels
~/.local/share/codex-nanoleaf/nanoleaf status --device panels
~/.local/share/codex-nanoleaf/nanoleaf device-remove --device panels
```

Removal stops that device's worker and deletes its registration, credential,
layout entry, saved state and scene. Lines and shared tasks are unchanged. Add
`--force` only for an unreachable device whose Free handoff cannot finish; its
lights then keep what they last showed. If its worker is still stopping, the
command says so, and running it again finishes the cleanup.

Source tests use temporary state and fake devices. They are not evidence that
enrollment worked on the installed runtime or that the Panels lit up.
[#46](https://github.com/jimmie-potts/codex-nanoleaf/issues/46) owns that
installation and physical check.

## Connect MCP

Setup configures the direct loopback HTTP transport, `loopback-http`. An
installation whose `mcp-config.json` still names `windows-http` is accepted as
the same transport. No helper process is involved.
`mcp-credentials.json` contains a private controller credential and the digest
of a separate MCP bearer. `mcp-client-token` holds that client bearer. Keep both
files private and give the client only the MCP bearer.

Use the existing [Codex MCP configuration instructions](local-mcp.md#configure-and-inspect-codex)
with `http://127.0.0.1:41230/mcp`. Supply `NANOLEAF_MCP_TOKEN` privately in the
selected client's environment from `mcp-client-token`. Verify status before a
mode command. Mode requests retain the controller's request ID, revision,
generation, authentication and uncertainty rules.

## Installed acceptance

In #55, record service, actual client, HTTP/MCP transport and visible-light
results separately. Verify one real WSL task, its hooks and metadata, the Windows
browser, authenticated mode commands, and a bounded Work/Quiet/Free sequence.
Record the final mode and scene. Reopen WSL and check startup again. Document
any client permission or systemd limitation without treating source tests as
installed evidence. [Hub #43](https://github.com/jimmie-potts/agent-device-hub/issues/43)
tracks the corresponding architecture and maintained-guide synchronization.
