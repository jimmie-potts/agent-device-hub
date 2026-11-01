# Private access to the Mac dashboard

This optional entry opens the existing dashboard from the owner's personal
Tailscale devices, at home or away. The Mac owns the runtime, state and address;
the PC is only a client. It uses the existing read/control browser sessions and
source-scoped machine credentials.

The route is browser or SDK → Tailscale Serve HTTPS → loopback Caddy → the
existing container gateway. Caddy requires an owner password for browsers,
removes that Basic credential and replaces caller-supplied proxy proof. Machine
Bearer credentials reach the gateway unchanged for its normal scope checks.
Tailscale membership and identity headers grant no browser control. Health,
launcher exchange, MCP, administrative and device-role credentials stay local.

The explicit [production profile](../../docs/bunny-container.md#production-device-profile)
reuses this same private entry while admitting configured shipped device modules
after explicit control enablement. The existing private-proxy profile continues
to refuse devices. Neither profile changes the proxy's authentication or origin
policy, and image replacement alone activates no device.

## Prepare the selected installation

For an already working route, use [Move an existing forwarder](#move-an-existing-forwarder)
instead of repeating runtime setup or generating credentials.

Follow [UPGRADE.md](UPGRADE.md) and the
[container operating guide](../../docs/bunny-container.md). Identify the exact
image, matching operator, Compose project, volumes and coordinating writer.
Preserve the local bookmark, configuration, selected local ingest source and
credential. Take the existing stopped backup before replacing the selected
image/configuration. Do not provision a second core or reset volumes. This entry
changes no state format.

1. Install official Tailscale clients on the selected Mac, phone and PC and sign
   them into the owner's personal account. The owner completes sign-in and macOS
   VPN approval. Follow the official [Serve setup](https://tailscale.com/docs/features/tailscale-serve)
   to enable HTTPS and obtain the Mac's stable
   `https://<machine>.<tailnet>.ts.net` address. Select a nonsensitive machine name:
   HTTPS certificate names appear in public certificate transparency logs. Keep
   selected tailnet access rules; do not enable Funnel, router forwarding or
   firewall workarounds.
2. Install Caddy with the community-maintained
   [Homebrew package](https://caddyserver.com/docs/install#homebrew-mac), then
   verify the command location and version:

   ```sh
   brew install caddy
   command -v caddy
   caddy version
   ```

   Homebrew must be on the owner's shell path. Its Caddy executable is
   `$(brew --prefix caddy)/bin/caddy`; that full path also works in a private
   startup script. Caddy 2.11.7 is exercised by the proxy tests. Record the
   installed version and check the route after a deliberate package upgrade.
   Installing the package does not select a startup policy; this recipe uses
   manual foreground operation, without `brew services start caddy`.

   Keep [private.Caddyfile](private.Caddyfile), `forwarder.env` and an optional
   `start-forwarder.sh` in a stable owner-only directory such as
   `~/.config/bunny/private-access`, outside Git and Hub release directories.
   Use mode `0700` for the directory and executable script, and `0600` for
   configuration and environment files. The default listener is
   `127.0.0.1:18789`, upstream `127.0.0.1:18788`. Leave `BUNNY_PRIVATE_PORT`
   and `BUNNY_PRIVATE_UPSTREAM` unset; their overrides support isolated testing.
3. Choose a password with `caddy hash-password` and save the password in the
   owner's password manager. Generate a separate random proxy token of at least
   32 bytes, encoded as base64url, and its lowercase SHA-256 digest. Keep private
   copies. Set `BUNNY_PRIVATE_HOST` to the selected hostname,
   `BUNNY_PRIVATE_PASSWORD_HASH` to the hash and `BUNNY_PRIVATE_PROXY_TOKEN` to
   the token in the private `forwarder.env` shell file. Single-quote its values
   so password hashes and other shell characters remain literal. Never pass
   secrets as command arguments or save them in Compose, Git or GitHub.
4. Add this member to the existing private runtime configuration's `edge`:

   ```json
   "privateProxy": {
     "origin": "https://<machine>.<tailnet>.ts.net",
     "tokenDigest": "<lowercase SHA-256 digest of the private proxy token>"
   }
   ```

   Keep `browserAccess: "trusted-loopback"`, `launcher: false`, `mcp: false` and
   `/run/secrets/bunny/edge.json`. This profile refuses `wifiProxy` and device
   modules. Grant each selected machine source only its required `read`,
   `control` or `ingest` scopes. Preserve any `BUNNY_INGEST_SOURCE` grant as
   ingest-only. Remote producer enrollment remains separate work; credentials
   never become page inputs. Preserve private file ownership and permissions.
5. Apply [compose.private.yaml](../../deploy/container/compose.private.yaml)
   after the selected copy of [compose.local.yaml](../../deploy/container/compose.local.yaml).
   It changes only the access label and `BUNNY_ACCESS` to `private-proxy`.
   Preserve the selected image, local ingest source, volumes, manual restart,
   loopback port and dedicated network. Recreate only the stopped selected core,
   use the matching operator to inspect/start it, and verify its identity,
   health and existing local browser/hook access.

## Start and use the route

After Mac unlock/sign-in and Docker/runtime startup, load the selected private
environment in an owner terminal and run:

```sh
BUNNY_PRIVATE_DIR="$HOME/.config/bunny/private-access"
set -a
. "$BUNNY_PRIVATE_DIR/forwarder.env"
set +a
caddy validate --config "$BUNNY_PRIVATE_DIR/private.Caddyfile" --adapter caddyfile
```

After validation succeeds, run:

```sh
caddy run --config "$BUNNY_PRIVATE_DIR/private.Caddyfile" --adapter caddyfile
```

An existing private `start-forwarder.sh` may perform these same steps, using
the Homebrew executable path and exiting on validation failure. Keep its
environment file and working directory explicit; do not embed credentials in
the script.

In a second owner terminal, after Tailscale sign-in, run:

```sh
tailscale serve --https=443 http://127.0.0.1:18789
```

Verify the selected Serve configuration and use the exact URL for this Mac.
Do not replace another Serve listener. These foreground processes keep startup
and shutdown manual; this recipe adds no service, login item or background route.
Keep operational output private. Access logging is off, but dependency errors
and startup diagnostics can still contain local addresses or request details.

Open the bookmark on an enrolled browser and authenticate with the configured
username, `owner` by default. The dashboard opens a Secure, HttpOnly,
SameSite=Strict session with read/control
permissions for eight hours. Disconnect ends the B.U.N.N.Y. session and streams;
the browser may cache its Basic password, so Sign in can reuse it. Expiry offers
Sign in again. Remove an enrolled device or rotate the owner password to control
future entry. Removing/rotating a machine credential and reloading ends that
credential's streams. Browser passwords are not SDK Bearer tokens. A TV browser on the ONN uses this
same entry and session; its owner setup and checks are in the
[ONN dashboard display qualification](../../docs/onn-dashboard-qualification.md)
record.

Connection loss shows unavailable/stale evidence. Reconnect resyncs state and
never resends commands; a lost reply retains its existing uncertain outcome.
Sleep or a stopped process makes the route unavailable. No PC process, disk,
relay or login is required. Device permissions and writers do not change.

## Move an existing forwarder

This is a Caddy installation change. Keep the selected runtime, its private
stores and credentials, Tailscale Serve route and device writers running as
they are. It needs no runtime image replacement or database migration.

1. Identify the owned Caddy process, executable, configuration, environment and
   manual startup entry. Record their paths and Caddy version privately. Keep
   the existing files and a private backup of any startup entry being changed.
2. Install and verify the Homebrew executable as above. Create the stable private
   directory with the same owner. Copy the existing `private.Caddyfile` and
   `forwarder.env` byte-for-byte, preserving owner-only permissions. Preserve
   the hostname, password hash, proxy token, port and upstream values; generate
   no new credential. Leave runtime files and machine-client credentials at
   their existing locations.
3. Put the manual `start-forwarder.sh` in the stable directory. Have it load
   that environment, validate that configuration and run the Homebrew Caddy
   executable. Preserve any required working-directory behavior. Validate the
   new configuration with its selected environment before stopping the old
   process. A validation failure leaves the existing forwarder running.
4. Stop only the identified old Caddy process and verify its listener is gone.
   Start the stable script and confirm one Caddy listener at the same loopback
   address. Update the previous manual startup entry to delegate to the stable
   script, so existing owner instructions still work. Never start both copies.
5. Check the established HTTPS route: valid browser credentials work, absent or
   wrong credentials fail and foreign origins are refused. Use a known-valid
   machine credential for a read-only request and compare its scoped response
   with the pre-move baseline, without a browser-password challenge. An
   ingest-only credential should retain its scope refusal on a protected read;
   this does not require granting read access. Check local access too. Keep
   addresses, credentials, responses and installation evidence private. These checks send no device
   command and do not repeat the route's earlier phone/TV qualification.

If the replacement cannot start or pass these checks, stop its owned process,
verify the listener is gone and restart the preserved prior forwarder. Diagnose
the failure before retrying. Do not replace the Tailscale route, reset runtime
state or loosen authentication to repair the move.

## Change the browser login

Edit the installed private `private.Caddyfile` to change the username in its
`basic_auth` block. Run `caddy hash-password`, enter the chosen password at its
hidden prompt and replace `BUNNY_PRIVATE_PASSWORD_HASH` in `forwarder.env` with
the resulting hash, single-quoted. Save the ordinary password in the owner's
password manager; that is what the browser asks for. Caddy stores the hash.

Load the updated environment and validate as above. After successful validation,
stop the owned Caddy process and start it again with the private script or the
manual commands. The supplied configuration has `admin off`, so `caddy reload`
cannot apply this change. Test the new login in a fresh private browser window
and update the saved password entry. The Tailscale account and machine Bearer
credentials are separate from this browser login.

## Verify and remove

Keep addresses, client identities and evidence private. Verify installed Mac/PC
browsers and iPhone Safari: authorized state and selected permissions, refused
anonymous/wrong credentials and foreign origins, logout/re-entry and a disposable
scoped SDK client. Check phone home/cellular access, background/resume and network
transitions without replay. With the PC off, verify the phone still reads available
Mac state. Synthetic browser checks do not establish these installed results.

To stop remote access, interrupt only the owned foreground Serve and Caddy
processes. Verify their listeners are gone, the remote URL no longer serves and
the local bookmark still works. For full removal, preserve latest state and private
inputs, stop the selected core, remove `edge.privateProxy` and only the grants added
for this entry, then return to the original host-local profile and local ingest
grant. Restart and verify local browser/hook access. The retained PC Wi-Fi entry
is unchanged; if separately selected for removal, follow [its recipe](WIFI.md).
