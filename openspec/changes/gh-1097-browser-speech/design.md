## Context

See proposal.md for motivation. The companions module already consumes qualified live opportunities, checks current core state, selects fixed phrases and commits admission before publication. Its React page uses the dashboard's authenticated SDK participant. The current browser grant can read state and issue operator commands but cannot receive device commands. Remote responders normally recover across reconnect, which is inappropriate for manual speech availability.

The selected local browser route has bounded qualification evidence. The implementation must still handle missing voices, callback failures and partial effects. Source checks use fake synthesis; physical listening evidence remains private and separate.

## Goals / Non-Goals

Use one companions policy owner and one connection-bound browser output owner. Preserve visual cards independently of speech. Keep output instructions live and results durable, with no persisted queue or availability. Avoid a general notification service, a new transport, a second lifecycle reducer or an audio provider abstraction beyond the selected browser driver.

## Decisions

### Put the effect behind a small browser driver

The driver takes an explicitly qualified voice identity, an injected Web Speech port and clock/scheduler. It waits at most five seconds for voices, verifies the exact local English match again before each submission, then sets the utterance voice explicitly. Qualification supplies the selected identity; runtime controls cannot silently choose another voice. No voice default is written.

The driver submits at most one utterance and has no pending queue or retry loop. It checks eligibility after voice discovery and directly before speak. A finite playback timer cancels overdue output. Ordered start/end establishes callback completion. End without start, submission exceptions, lost callbacks and lost connectivity after submission are uncertain. Cancellation is confirmed only by a terminal callback and an idle synthesizer; a timeout cannot prove silence. A stopped utterance can retain evidence of partial playback without being called completed or heard. Only the [Web Speech specification's](https://webaudio.github.io/web-speech-api/#speechsynthesiserrorevent) explicit pre-playback refusals can report failure with no start; other errors after submission remain uncertain.

### Scope endpoint calls to the current SDK stream

Extend the existing remote calls with explicit connection-bound endpoint ownership. The edge checks both the authenticated principal and stream identity, and permits only the declared speech request, responder and receipt families. Because tabs can share a session cookie, the endpoint also requires an opaque per-stream capability delivered only on that stream. The public endpoint identifier alone grants no authority. The capability stays in the transport handle and never enters messages, state, outcomes or diagnostics. The remote client exposes a short-lived endpoint handle rather than restoring these handlers with ordinary subscriptions. Closing a handle or connection retires the handlers. The dashboard exposes only the companions endpoint through its mounted module API and closes it on page unmount, loss of authority or connectivity. This keeps all traffic on the existing transport and prevents a shared browser cookie from turning another tab into an output owner.

The gateway publishes a registered profile-2.0 endpoint-loss occurrence when the stream closes. The module retires its reservation and pending work. Runtime restart starts with no reservation. Browser-local disconnect handling cancels immediately when loss is detected; the independent playback deadline limits waiting during a partition. A known uncertain active operation prevents replacement or tab takeover.

### Keep admission and results in companions

The companions module reserves one endpoint after its explicit enable action. Enablement is ephemeral and carries no historical opportunity. A second endpoint is refused while the first reservation or uncertain active output remains. Speech consumes the same newly admitted fixed phrase as the visual card; reading or restoring a card cannot speak. Scenario fixtures remain silent. Existing coding deduplication and social budget policy stay authoritative.

One active and at most one pending candidate are kept in memory. Coding attention displaces a waiting social candidate and can request cancellation of active lower-priority speech. The coordinator awaits a definitive cancellation receipt before replacement, checks current policy again, and abandons stale candidates. Stop and mute clear pending work; local mute also cancels immediately without waiting for the server.

### Use the existing operation tracker

An internal profile-2.0 dispatch request from the companions source enters the core dispatcher, which sends a tracked speech operation back to the companions owner. This narrow adapter follows the existing automation dispatch pattern without exposing arbitrary dispatch through module context or ordinary browser actions. The module saves responsibility before accepting, sends one live browser command and commits its final outcome through its existing outbox. The browser reports bounded playback enums and evidence through the authenticated endpoint receipt family. No exception text, arbitrary provider metadata or alternate error envelope crosses the boundary.

The operation's result and playback state are separate. Ordered completion can succeed with observed callback evidence; interrupted output preserves its partial effect and does not claim full delivery. Lost or contradictory evidence is uncertain. Startup settles unfinished responsibility as uncertain and never resends audio.

## Risks / Trade-offs

- A local voice can disappear or change. Exact revalidation refuses output and requires a newly qualified selection.
- Speech callbacks can be absent or out of order. Conservative uncertainty prevents automatic replay or overlapping replacement.
- A network partition may delay detection. Local deadline and cancellation bound the attempt; the module retains uncertainty rather than assuming silence or selecting another tab.
- Availability is manual. The UI explains muting before calls and other sensitive activity; it claims no automatic detection.
- The endpoint grant crosses SDK, gateway and dashboard boundaries. Tests must exercise raw unauthorized calls, two tabs, reconnect and lifecycle cleanup, alongside ordinary-client compatibility.

## Migration Plan

Add only module-owned responsibility/outcome storage, with old settings and data preserved. Default speech remains off after installation and restart. Run the existing event, SDK, runtime, companions and dashboard checks, including a disposable browser/axe journey with fake synthesis, before independent review and merge. Qualify the selected installed desk revision separately through the current runtime procedure. Any return to an older source revision leaves speech unavailable and preserves private data; no snapshot restoration is part of this change.
