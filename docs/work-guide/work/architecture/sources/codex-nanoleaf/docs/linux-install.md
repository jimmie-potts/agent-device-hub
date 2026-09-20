# Fresh Linux installation

Run the existing Nanoleaf processes in Linux with private Linux SQLite state and
one light-writing worker. The wall map, controller API and Node MCP host are
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
WSL's lifetime. This project adds no Windows startup launcher or always-on host.

Before setup registers active hooks, stop this project's Windows worker, wall
map, controller, MCP and tray. Disable its Startup entries and remove its old
Nanoleaf hooks from the relevant Codex homes. The operator performs that Windows
retirement outside a restricted task terminal. Preserve unrelated applications,
hooks and Codex data. Windows and Linux workers must never control the device
concurrently, even if their databases are separate.

The fresh installation imports no old tasks, preferences, credentials or scene
state. Old Nanoleaf data may remain unused. No backup, data migration, rollback
tooling or soak period is required. An existing Windows installation still uses
its supported Windows upgrade procedure when it is being upgraded.

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

The installer replaces only entries with this integration's hook marker and
preserves unrelated handlers and settings. By default it uses
`$CODEX_HOME/hooks.json`, or `~/.codex/hooks.json` when `CODEX_HOME` is unset.
Use `--hooks-file /path/to/hooks.json` to select the actual Codex home, repeating
the option for separate clients. These commands require tasks executing in WSL;
review and trust the new hooks in the client. Registration alone does not prove
that the installed client's sandbox can run them or launch the worker.

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

The default user units are written to `~/.config/systemd/user`. After Windows
retirement, run these commands in ordinary WSL:

```bash
systemctl --user daemon-reload
systemctl --user enable --now codex-nanoleaf-wall codex-nanoleaf-controller codex-nanoleaf-mcp
systemctl --user status codex-nanoleaf-wall codex-nanoleaf-controller codex-nanoleaf-mcp
```

Each unit runs a foreground process with a private umask and restarts on failure.
The worker stays on demand and keeps the existing exclusive SQLite lock.
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

## Connect MCP

Setup configures the existing direct HTTP transport, whose compatibility name
is `windows-http` on both Linux and Windows. It needs no Windows helper.
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
