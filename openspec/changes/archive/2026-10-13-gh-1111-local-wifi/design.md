## Context

See proposal.md for the user need. The runtime binds IPv4 loopback; gateway origin checks currently admit its two HTTP loopback names. The dashboard already has responsive layouts, cookie sign-in, eight-hour expiry and SDK reconnect handling. Windows uses WSL NAT. A disposable native Windows Caddy 2.11.7 check reached a WSL loopback fixture, validated TLS using its isolated CA, preserved Host/Origin, stripped Basic authorization, overwrote a forged proxy header and flushed streaming chunks. Local access survived removal. Actual iPhone trust remains installed-client acceptance.

## Goals / Non-Goals

**Goals:** One explicit optional HTTPS entry, existing owner read/control sessions and a removable setup. Keep the core, device writers, SDK protocol and loopback clients unchanged.

**Non-Goals:** Tailscale, public access, a proxy framework, mobile UI, automatic network discovery, account management or an unattended installer.

## Decisions

- Run native Windows Caddy bound to the selected home-network address. Use its internal CA and one owner Basic password. This uses the existing Windows-to-WSL localhost relay; widening the runtime listener or adding portproxy rules is unnecessary. Plain LAN HTTP is unsuitable for the existing secure-context browser APIs and password protection.
- Add optional `edge.wifiProxy` with one canonical HTTPS `origin` and a SHA-256 `tokenDigest`. The proxy injects `Bunny-Wifi-Proxy` after authentication, overwriting caller input; the runtime checks its digest and exact Host before serving that entry. It ignores forwarded identity headers. The token never reaches the browser, a response or diagnostics.
- Caddy removes Authorization before forwarding, preserving Host, Origin and browser metadata. The runtime rejects machine bearer authentication, health, MCP and launcher exchange on this browser entry. Ordinary local callers remain independent.
- Existing sign-in creates the normal cookie, adding Secure for HTTPS. Session expiry, logout, scope checks and SDK disconnects remain the existing implementation. No frontend change or second session store is needed. Basic credentials may remain in the browser after Disconnect; that action ends the B.U.N.N.Y. session and streams and requires the existing explicit Sign in action to resume.
- Restrict the single TCP port to the selected local address, home subnet, executable and current Windows network profile; do not reclassify the network. Disable Caddy admin, HTTP redirects, automatic system trust installation and HTTP/3; no router forwarding. Keep configuration, CA keys, proxy secret and installed evidence private.

## Risks / Trade-offs

- Local CA trust requires one manual iPhone setup step. Verify the certificate fingerprint through the owner's local files; never instruct bypassing browser certificate errors.
- The address may change and the PC must remain awake. Update the explicit address when needed; no discovery or continuity machinery.
- Caddy's owner password and runtime proxy token are separate so the browser password never becomes a runtime machine credential. Caddy is trusted to authenticate the owner; the secret is private to those two local processes.
- Source and desktop WebKit tests do not prove actual iPhone use. Keep that acceptance pending until observed.

## Migration Plan

Merge and verify source, then follow the established runtime upgrade procedure. Configure only this optional entry and the privately generated proxy setup; obtain any required authority for personal certificate/network settings before applying them. Check local clients and the actual phone. Removal stops Caddy, removes its specific firewall rule and optional configuration, then removes the phone's local CA trust/profile; local runtime access remains available. Tailscale replaces the temporary entry in its own issue. No database migration or replay is introduced.
