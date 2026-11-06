## Context

The core serves one `music-lighting-state/2.0` record per qualified Nanoleaf light and admits `music-lighting-control` Start and Stop as tracked operator actions. Saving the record completes the operator command. The core then dispatches one tracked `music-lighting-work` command whose request ID it derives from the operator request and the light, and it follows the module's `music-lighting-device` record. The Audio page already follows `music-capture-state` through `MusicCaptureFeed`. The Wall page follows the private preset library with `followReactivePresets`.

## Goals / Non-Goals

**Goals:** truthful per-light status and endings, explicit Start and Stop only, no command on load, reload, reconnect or record change, and honest stale states.

**Non-Goals:** Panels or multi-light participation choices, microphone lighting, effect editing, automatic restart, and installation or physical acceptance.

## Decisions

### D1. A read-only lighting scope beside the capture scope

`DashboardConnection.openMusicLighting(follow)` creates a `MusicLightingFeed` on the shell participant, like `openMusicCapture`. It syncs the core's lighting records and calls the Wall page's `followReactivePresets` for the Nanoleaf preset library. The follower is passed in, so the shell's Node-tested modules never import Nanoleaf frontend source. A connection loss closes the scope. A read failure or restart marks it stale, and only **Refresh lighting status** reads again. One malformed or foreign record makes the copy unavailable instead of showing a partial set.

### D2. Three separate kinds of evidence

The operator command's outcome means the core saved the request. The work command's outcome is the light module's answer: `transmitted` means the first frame was written, and still not physically observed. The browser finds that operation by deriving the same SHA-256 work ID the core uses, and a unit test checks it against the core's function. The record's status is the light's own report through the core: only `active` means the light reported playing. The card shows these on separate lines and infers none from another.

### D3. Eligibility explains, the owners decide

Start is enabled only for an idle record from a fresh copy, with control authority, live command records, an active Music.app capture from a fresh capture copy, and a fresh library that holds the chosen preset. Both Start and Stop attempts must also be unlocked. Every disabled control names its reason. A microphone session is never offered. A light whose saved mode is not Free gets a note, but Start stays enabled: the module decides, and its refusal is shown as the recorded ending. Stop is enabled for starting, active, stopping and uncertain sessions, independent of an unresolved Start, and it ignores capture and library state. Start and Stop keep separate tracked attempts, keyed per light.

### D4. Last-known display

After a disconnect or a failed read, the card keeps showing the last fresh records, labeled "Last known", with every control disabled until a fresh read.

## Risks / Trade-offs

- The work line depends on operation records that the core retains. When an old operation is retired, the line disappears; the record's status and ending remain.
- `crypto.subtle` needs a secure context, as `crypto.randomUUID` already does for every dashboard command.
