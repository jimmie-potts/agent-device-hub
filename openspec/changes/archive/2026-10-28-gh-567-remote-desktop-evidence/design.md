## Context

See the proposal for the outcome. The module already turns the marker, the
archive filenames and the index tail into lifecycle evidence through a
`MarkerTransport` with one answer per read, and the core accepts
`metadata-observed` only from `bunny/modules/codex-desktop`. The `ingest` scope
publishes the lifecycle family only, and the private ingress binds a derived
producer credential to its lifecycle identity.

## Decisions

A remote source stands in for the folder reader, not for the module. The
collector publishes a whole snapshot, bounded under the 256 KiB message limit,
on every change and at least every 5 s. The module's `RemoteFeed` answers a
read from the latest snapshot younger than 10 s, `unchanged` when its stamp is
the one the module holds, and otherwise waits for the next snapshot, so the
existing 5 s read deadline, `device.unavailable` and `device.available` records,
archive clearing and recovery apply unchanged. No second reducer, poll of the
core or command is added.

The family is published only by a credential whose source is derived from the
five-member configuration `{provider, client, hostId, sourceId, feed:
'desktop-metadata'}`, through the existing `producerSource` derivation. That
credential differs from a hook credential of the same feed and cannot own a
lifecycle identity at the private ingress; the gateway checks the binding on
every entry, before the bus has the message. The module also refuses a snapshot
whose source is not a remote part, whose subject is not its feed, or whose feed
is not configured, logging one record per sender and key.

The `sources` section lists at most four producers, each once, locally or
remotely. The released `{home, hostId, sourceId}` section is read as one local
source; health shows it as before. The identity of every observation stays
`client: desktop`, so `local` sessions get nothing, by the accepted contract.

The container profile admits a module that declares a simulation only when its
registration says of the section that it reaches no local device or file
(`hostLocal`); for this module that is a section without any `home`.

Snapshots carry neutral IDs and validated provider titles only: no path, no
transcript, no credential. The collector's records hold time, level, event,
registry code and trace ID.

## Risks and qualification

A wrong binding could let one computer clear another's attention: the gateway's
source binding and the module's feed check are tested with forged hook and
other-feed credentials. Stale input never proves a read: a feed whose snapshots
stop is unavailable and clears archive positives, and a read waits for a fresh
snapshot. Reconnection or a repeated snapshot creates no session, command or
read claim: unchanged facts give no new evidence.

Mac Desktop evidence for the shared `local` feed is a declared gap pending an
owner decision; nothing infers readership for it.

## Installation and recovery

Source delivery is separate from installation. The Mac core takes the module's
remote-only section for the PC source after its image replacement; the PC
collector needs PC access and its own producer and receipt. A stopped collector
leaves the core's state as it was, with that source unavailable.
