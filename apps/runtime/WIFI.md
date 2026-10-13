# Use the dashboard on home Wi-Fi

This temporary setup serves the existing dashboard and controls from the current
Windows PC/WSL installation. The PC must stay awake. Bookmark its HTTPS address
on the iPhone; if the PC's home address changes, update the address and bookmark.
Tailscale replacement is separate work. There is no mobile app to install.

Native Windows Caddy supplies HTTPS and one owner password, then forwards to the
runtime's existing loopback listener through WSL's localhost relay. The runtime
still owns all state and device commands. A separate private proxy secret admits
only that configured HTTPS origin. Caddy removes the browser's Basic password
before forwarding and overwrites any caller-supplied proxy proof.

## Prepare the local entry

Use a reviewed runtime release with this feature, installed under [UPGRADE.md](UPGRADE.md).
Record the existing runtime configuration and local bookmark before changing it.
These setup steps change owner configuration; network rules and phone certificate
trust need the owner's setup authority. Keep addresses, passwords, keys and
receipts outside Git and GitHub.

1. Select the PC's **home-network IPv4 address** and home subnet from Windows
   network settings. Record its current Windows profile; keep that profile unchanged.
   Do not use a VPN, guest/public network, wildcard bind or router port forward. Confirm that
   Windows can open the current local dashboard at `http://127.0.0.1:8788/`.
2. Place the official [Caddy Windows binary](https://github.com/caddyserver/caddy/releases)
   in a private owner folder and verify its release checksum. Caddy 2.11.7 was
   exercised for this recipe. Copy [wifi.Caddyfile](wifi.Caddyfile) there. Run it
   in a foreground PowerShell window; this recipe creates no service or task.
3. In that window, set these values. Replace the example address and private
   folder with the selected values. `hash-password` prompts for the owner password;
   save the password in the owner's password manager. Never put it in a command
   line or tracked file.

   ```powershell
   $env:BUNNY_WIFI_ORIGIN = 'https://192.168.50.10:8443'
   $env:BUNNY_WIFI_BIND = '192.168.50.10'
   $env:BUNNY_WIFI_UPSTREAM = '127.0.0.1:8788'
   $env:BUNNY_WIFI_DATA = 'C:/Users/OWNER/.bunny-wifi/data'
   $env:BUNNY_WIFI_PASSWORD_HASH = (& .\caddy.exe hash-password).Trim()
   $wifiBytes = New-Object byte[] 32
   $wifiRng = [Security.Cryptography.RandomNumberGenerator]::Create()
   $wifiRng.GetBytes($wifiBytes)
   $wifiRng.Dispose()
   $env:BUNNY_WIFI_PROXY_TOKEN = [Convert]::ToBase64String($wifiBytes).TrimEnd('=').Replace('+','-').Replace('/','_')
   $wifiSha = [Security.Cryptography.SHA256]::Create()
   $wifiDigest = -join ($wifiSha.ComputeHash([Text.Encoding]::UTF8.GetBytes($env:BUNNY_WIFI_PROXY_TOKEN)) | ForEach-Object { $_.ToString('x2') })
   $wifiSha.Dispose()
   ```

   Save the proxy token and password hash privately if keeping this setup across
   restarts; restore them into this window's environment before starting Caddy.
   Keep its data folder private too: it contains the local CA's signing key.

4. Add this optional member to the existing private runtime configuration's
   `edge` object, using the selected origin and `$wifiDigest` value. Preserve the
   other members and file permissions. Restart through the established runtime
   procedure; verify local access before opening the network port.

   ```json
   "wifiProxy": {
     "origin": "https://192.168.50.10:8443",
     "tokenDigest": "<the 64-character lowercase SHA-256 digest>"
   }
   ```

5. Validate and start the forwarder:

   ```powershell
   .\caddy.exe validate --config .\wifi.Caddyfile --adapter caddyfile
   .\caddy.exe run --config .\wifi.Caddyfile --adapter caddyfile
   ```

   The supplied file disables the admin listener, HTTP redirects, HTTP/3 and
   automatic system trust installation. It binds only the selected address.
   Allow only inbound **TCP 8443**, for this executable and selected local address, on that interface's
   current Windows profile, from the selected home subnet, using a specifically named Windows Firewall
   rule such as `BUNNY temporary home Wi-Fi`. Record that rule for removal.
   Do not accept a broader automatic firewall exception or change router settings.

## Trust and use the phone bookmark

Copy only `data/pki/authorities/local/root.crt` to the owner's iPhone using an
owner-selected file transfer. Never transfer `root.key`, the proxy secret or the
whole data folder. Verify the certificate against the local source, then follow
[Apple's certificate-profile and full-trust steps](https://support.apple.com/en-us/102390).
Do not bypass a browser certificate warning. Remove this certificate profile
when removing the setup.

On home Wi-Fi, open the selected HTTPS address in Safari. Enter username `owner`
and the chosen password at the browser prompt. The existing dashboard opens with
its normal read/control session. Check a known live record, phone navigation and
an existing control. An actual device action still requires its explicit target
and permission; a simulated control check proves the path without that effect.

The B.U.N.N.Y. cookie is Secure, HttpOnly and SameSite=Strict and expires after
eight hours. **Disconnect** ends that session and its streams. Safari may retain
the HTTP Basic password; **Sign in** uses it to start a new B.U.N.N.Y. session.
Briefly leave Wi-Fi or background Safari, then return: the page must show loss of
connection truthfully and recover without replaying a control. Save the actual
phone/build observations privately; a desktop browser test is separate evidence.

## Remove the temporary setup

Stop the Caddy foreground process and remove its specifically named firewall
rule. Remove only `edge.wifiProxy` from the runtime configuration and apply that
change through the established runtime procedure. Check the original local
bookmark and machine clients. Remove the phone's certificate profile/full trust
and temporary bookmark, then delete this setup's private Caddy files and secrets.
Do not remove another application's Caddy configuration or certificate authority.

The setup has no database migration, second runtime, device writer or queued
commands to unwind. Keep the ordinary local browser configuration unchanged.

## Source verification

See [DEVELOPMENT.md](DEVELOPMENT.md#runtime-checks) for gateway tests. After a root
build, run `BUNNY_TEST_CADDY=/path/to/verified/caddy node apps/runtime/dashboard/tests/wifi.browser.ts`
with Node 24 and the shared Playwright browsers. It uses synthetic state, a
disposable loopback Caddy and Chromium at phone width, without installing
system trust. Set `BUNNY_TEST_BROWSER=webkit` or `both` when the corresponding
Playwright browser and Linux libraries are available. Windows-to-WSL routing, certificate validation and actual iPhone
trust/use need their own observations. Caddy's behavior is documented in
[Basic authentication](https://caddyserver.com/docs/caddyfile/directives/basic_auth)
and [reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy);
Windows localhost forwarding is described in [WSL networking](https://learn.microsoft.com/en-us/windows/wsl/networking).
