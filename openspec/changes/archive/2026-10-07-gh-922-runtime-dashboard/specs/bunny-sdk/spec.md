## ADDED Requirements

### Requirement: A browser page as a remote part

The SDK SHALL offer the remote client alone at `@jimmie-potts/sdk/remote`, whose module graph imports no Node built-in and reads no file, so a browser page such as the dashboard (Hub #922) can bundle it; its message, request and trace IDs SHALL come from Web Crypto, which Node and a browser both have, and the error body, `MAX_DETAIL` and `SCHEMA_BASE` SHALL come from the event contracts' `v2/errors` module, which the `v2` entry exports unchanged. `connectRemote({browser: true})` SHALL send no `authorization` header, so the browser's session cookie and its own `Origin` stand for the page, and SHALL mark every call with `bunny-request: 1`. A browser has no async context, so there a handler's close of its own subscription SHALL be detected only in the handler's synchronous part. When the edge refuses a reconnect with `unauthenticated` or `forbidden`, the client SHALL keep trying with its backoff and SHALL report `remote.refused` with the code at WARN once per code until it reconnects, so a page can offer to sign in again; the runtime SHALL write no record of it, as of the client's other decisions.

#### Scenario: The client bundles for a browser
- **WHEN** a test bundles `@jimmie-potts/sdk/remote`, and the package's main entry, for a browser
- **THEN** the remote entry bundles with the client and no Node built-in, validator or file read, and the main entry fails to bundle

#### Scenario: A browser session's calls
- **WHEN** a part connects with `{browser: true}` to an edge whose host admits a call that carries no token and the page's mark, syncs a family and sends a command
- **THEN** every call, the stream included, carries no `authorization`, `bunny-request: 1` and the part's source, the sync holds the owner's records and the command is accepted

#### Scenario: A session that ended
- **WHEN** the edge ends a browser part's stream and refuses its reconnects as `unauthenticated` several times, then admits it again
- **THEN** the client reports `remote.disconnected`, one `remote.refused` with `unauthenticated` at WARN, and `remote.reconnected`, in that order
