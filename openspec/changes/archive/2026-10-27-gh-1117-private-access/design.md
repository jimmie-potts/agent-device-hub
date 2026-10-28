## Context

See proposal.md for motivation. The runtime already has secure cookies, scoped bearer grants, origin checks and a secret-authenticated Wi-Fi proxy entry. That entry deliberately excludes machine callers. The Mac container also refuses proxy settings and accepts only its explicitly selected local ingest credential. This change needs a design because it crosses those admission boundaries.

## Goals / Non-Goals

Serve the existing dashboard and authenticated SDK edge through one Mac-owned private address. Preserve the current local profile by default. Remote producer enrollment, TV policy, device activation and state migration remain separately owned.

## Decisions

1. Tailscale Serve terminates private HTTPS and forwards to native Caddy on IPv4 loopback. Caddy checks the exact configured Host, requires one owner Basic password for browser requests, strips that authorization and overwrites a private proxy-proof header. Machine requests preserve Bearer authorization and still need the gateway's existing source/scopes. The loopback gateway is never published on the LAN. Reuse the already qualified Caddy pattern rather than implement password management in B.U.N.N.Y. Tailscale membership or identity headers alone grant no browser control.
2. Add `edge.privateProxy` with one canonical HTTPS `origin` and SHA-256 `tokenDigest`, using a distinct `Bunny-Private-Proxy` header. Reject simultaneous private/Wi-Fi proxy headers and mismatched hosts or proof. Keep `edge.wifiProxy` behavior unchanged. A shared origin reader supplies the same HTTP/HTTPS origin decision to the listener and gateway. Forwarded/Tailscale identity headers grant no authority.
3. A private machine request cannot create or exchange a browser session, and a page cannot use a bearer credential. The existing access checker retains source grants and Origin/fetch-metadata refusal. Health, launcher and MCP stay local. Browser sessions retain read/control, eight-hour expiry, logout and immediate stream termination. SDK calls reauthenticate and credential reload disconnects revoked clients. No new session store or retry loop is introduced.
4. Add a `private-proxy` container profile, selected explicitly in Compose. Its port remains host-loopback 18788, network remains dedicated, device control remains disabled, and it admits only the same non-device modules. Require private-proxy configuration and shared-parser-validated ordinary read/control/ingest grants; reject admin and special device transport roles. Preserve any selected local ingest source as ingest-only. The unchanged host-local profile keeps its original stricter admission.
5. Each runtime refusal uses ADR 0012 registry codes and existing bounded diagnostics. Preserve request trace continuity after authentication. Proxy access logging stays off; any dependency diagnostics remain private. Connect/reconnect uses existing SDK sync; commands are never retried or replayed. A transport loss keeps failed and uncertain results distinct.

## Risks / Trade-offs

- Caddy is one additional manually started local process, needed to preserve the existing password/proxy-proof model. Stop its owned process and Tailscale entry to remove access. No public Funnel, new account platform, general proxy framework or automatic failover.
- Basic credentials can remain cached in a browser after Disconnect. Disconnect still ends the B.U.N.N.Y. session and streams; re-entry uses the normal Sign in action. Removing the entry ends remote availability. Rotate the owner password/proxy secret only through explicit private setup.
- Misrouted Bearer requests must not reach browser session creation. Test forged proof, hostile origins, bad grants and session exchange directly and through the actual Caddy config.
- The normal local trust boundary includes the Mac and its dedicated container network. Preserve one effective loopback binding and exclude unrelated containers. Neither client headers nor network membership substitute for authentication.

## Migration Plan

No storage change. After reviewed source and merged-main checks, inspect the exact installed release, retained configuration, volumes, credentials and current coordinator. Take the existing stopped backup, preserve original inputs, select the matching new image/operator and explicit access profile, and start only the same core. Add the private proxy configuration and selected grants without regenerating local hooks or existing credentials. Keep operational values and receipts private.

Start the selected loopback Caddy forwarder and one Tailscale Serve route; verify the selected Mac, PC, iPhone home/away and SDK checks, including PC-off operation. Preserve the temporary PC Wi-Fi entry unless explicitly replacing it. Removal disables only the owned Serve route and forwarder, removes the optional private access settings/grants and selects the local profile with its original local grant; verify local browser/hook access. On failure retain latest state and fix forward; snapshot restoration needs a separate owner decision.

## Open Questions

Operational inputs remain private pickup checks: the owner's new Tailscale enrollment and stable address, exact selected browser/client identities, and installation coordination. These do not change the source contract. Actual iPhone and PC-off acceptance requires the owner's devices; synthetic tests cannot supply it.
