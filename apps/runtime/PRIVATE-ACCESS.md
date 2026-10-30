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
2. Put the official [Caddy binary](https://github.com/caddyserver/caddy/releases)
   and [private.Caddyfile](private.Caddyfile) in an owner-only directory outside
   Git. Verify its published checksum. Caddy 2.11.7 is exercised by the proxy
   tests. The default listener is `127.0.0.1:18789`, upstream
   `127.0.0.1:18788`. Leave `BUNNY_PRIVATE_PORT` and `BUNNY_PRIVATE_UPSTREAM`
   unset; their overrides support isolated testing.
3. Choose a password with `caddy hash-password` and save the password in the
   owner's password manager. Generate a separate random proxy token of at least
   32 bytes, encoded as base64url, and its lowercase SHA-256 digest. Keep private
   copies. Set `BUNNY_PRIVATE_HOST` to the selected hostname,
   `BUNNY_PRIVATE_PASSWORD_HASH` to the hash and `BUNNY_PRIVATE_PROXY_TOKEN` to
   the token in the forwarder's private environment. Never pass secrets as command
   arguments or save them in Compose, Git or GitHub.
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

After Mac unlock/sign-in and Docker/runtime startup, restore the private Caddy
environment in an owner terminal and run:

```sh
caddy validate --config /absolute/private/private.Caddyfile --adapter caddyfile
caddy run --config /absolute/private/private.Caddyfile --adapter caddyfile
```

In a second owner terminal, after Tailscale sign-in, run:

```sh
tailscale serve --https=443 http://127.0.0.1:18789
```

Verify the selected Serve configuration and use the exact URL for this Mac.
Do not replace another Serve listener. These foreground processes keep startup
and shutdown manual; this recipe adds no service, login item or background route.
Keep operational output private. Access logging is off, but dependency errors
and startup diagnostics can still contain local addresses or request details.

Open the bookmark on an enrolled browser and authenticate as `owner`. The
dashboard opens a Secure, HttpOnly, SameSite=Strict session with read/control
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
