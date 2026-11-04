## Context

ADR 0006 puts a moment's mechanism, precedence and return to base in the device. The module already has one serialized queue, stored commands that never run twice and a pin that follows a tile. Server v2.5.2's source shows three things the takeover relies on: a foreground push reaches a connected device at once, `GET /v0/devices/<id>` returns `pinnedApp`, and `PATCH /installations/<name> {pinned: false}` clears the pin only if that installation holds it.

## Decisions

- **Its own installation, pinned for the hold.** A push alone shows for one dwell and leaves a tile in the rotation. A pin holds the frame for the whole moment, and tiles keep writing behind it in the background, so the return shows the current rotation and nothing needs restoring. Deleting the installation at the end leaves no trace in the rotation.
- **One queue turn for the takeover.** The read, the push and the pin share a turn, so no mode write lands between them. The release is a later turn. Its `pinned: false` makes the server do the comparison, so there is no gap between a read and a clear in which an owner's new pin could be lost. The pin itself has no such comparison, so a pin set by hand between the read and the moment's pin is overwritten. The API offers nothing to close that.
- **Any pin wins.** A pin mode refuses at admission. A pin set on the server's own page is only known by reading, so the takeover reads first and writes nothing if one stands. A pin set during the hold survives the release.
- **Missing evidence blocks.** A sessions copy that does not follow its owner counts as possible attention, as ADR 0006 says no moments play without the hub.
- **A floor of 30 s.** The firmware decides how long a frame shows, so a request for a few seconds cannot be honored as asked. The dashboard's test button asks for 3 s. It holds 30 s, the low end of the owner's range. Above 60 s is refused by the shared admission rule.
- **Mood card behind a function.** `MomentPicture` takes the accepted request and answers an encoded frame. The default draws in the existing worker. #679 and #681 supply a different function; the takeover, its safety and its evidence do not change. A rejection ends the moment with nothing sent.

## Recovery

A row marks a takeover that may stand, written before the first request and cleared once a release is answered. A failed release retries at the tile's next evaluation after the existing 60 s wait, and new moments are refused until then. A stop or a crash during a hold cannot reach the server, so the frame stays pinned until the next start, whose first evaluation releases it. The moment's ID stays spent, and the next start reports it `uncertain` under the existing settlement.

## Risks

- A long runtime outage during a hold leaves the card pinned on the server. Only a server-side expiry could bound that, and the API has none. It can only begin during a hold, which lasts at most 60 s per moment. The frame then stays for as long as the outage does, and the next start clears it.
- A release waits behind the queue's holds like any write: up to 15 minutes under a rate limit and until the next start under a refused key. The server records no rate limit of its own, so a 429 would come from a proxy.
- `pendingKinds` shows `moment-play` for the whole hold. That is true of a command whose outcome follows its release.
