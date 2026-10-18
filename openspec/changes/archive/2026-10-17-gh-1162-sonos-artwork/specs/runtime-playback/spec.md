## MODIFIED Requirements

### Requirement: Sonos Move source

The Sonos source SHALL read `GetTransportInfo`, `GetPositionInfo` and `GetCurrentTransportActions` in sequence, each a 200 reply carrying its response element within 64 KiB, and any failed call SHALL fail the whole read. It SHALL treat an `x-sonos-vli` track URI as the AirPlay session and any other as `inactive` with no metadata or controls, map `PLAYING`, `PAUSED_PLAYBACK` and `STOPPED` to `playing`, `paused` and `stopped` and any other state to `unknown`, read the DIDL-Lite title, creator and album decoded once per layer, and SHALL NOT copy position or duration. It SHALL retain an optional albumArtURI of at most 2,048 characters privately for independent artwork acquisition, decoded once per XML layer; absent or malformed artwork SHALL NOT fail otherwise valid metadata or controls. It SHALL NOT put the URI in messages, logs or errors. It SHALL declare pause, next and previous while playing and play, next and previous while paused, each only while the Move's actions list it. Commands SHALL send `Pause`, `Play` with speed 1, `Next` or `Previous` once: HTTP 200 is sent, an HTTP 500 SOAP fault is a refusal, and anything else is uncertain.

#### Scenario: Paused with play advertised
- **WHEN** the Move reports `PAUSED_PLAYBACK` with Play, Next and Previous among its actions
- **THEN** the observation declares play, next and previous

#### Scenario: Command answers
- **WHEN** play gets HTTP 200, next a SOAP fault, previous no answer, and previous an HTTP 500 without a fault
- **THEN** play is sent with `<Speed>1</Speed>`, next is refused, and both previous calls are uncertain


#### Scenario: Sonos artwork metadata
- **WHEN** a valid AirPlay response contains an escaped absolute or relative albumArtURI
- **THEN** the source retains the decoded candidate privately without changing song metadata or controls
- **AND** absent or malformed artwork retains text-only playback

### Requirement: Optional shared Sony artwork

The playback owner SHALL acquire optional Sony or Sonos artwork independently of metadata and controls. Sonos candidates SHALL resolve against the configured Sonos origin and SHALL use HTTP on that exact origin only, without credentials or a fragment; relative references are supported. Sony candidates retain their separate absolute-URL policy. For Sony it SHALL fetch only an absolute HTTP URL on the configured receiver's origin or on the same configured receiver IPv4 address at port 58080, without credentials or a fragment. It SHALL refuse all other hosts and ports and all redirects. Acquisition SHALL ignore HTTP media-type claims, admit JPEG or PNG bytes, and normalize a single image to a metadata-free PNG no larger than 128×128 and 65,536 bytes. Input SHALL be limited to 1,048,576 bytes and 4,000,000 decoded pixels. Fetch and worker decode SHALL each have a 2,000 ms deadline. At most one acquisition chain SHALL be admitted at a time, with only the newest replacement retained. Failures SHALL retain text-only playback and current control routing, with safe diagnostics that expose no URL, image bytes or listening metadata.

#### Scenario: Qualified JPEG with an incorrect media type
- **WHEN** the presented Sony source reports a same-origin JPEG thumbnail served as `text/plain`
- **THEN** metadata is published without waiting for the image and a bounded normalized PNG is subsequently shared

#### Scenario: Invalid or absent image
- **WHEN** content is absent, bytes cannot be decoded, the URL is outside those permitted receiver origins, a redirect occurs, a deadline expires or any capacity limit is exceeded
- **THEN** the image remains missing and playback text, availability and controls remain governed by metadata

#### Scenario: Receiver-hosted thumbnail uses its verified service port
- **WHEN** the configured Sony receiver advertises an absolute HTTP thumbnail URL on its own IPv4 address at port 58080 while its control API uses another port
- **THEN** the owner admits that candidate through the existing bounded acquisition path
- **AND** candidates using another host, another unconfigured port, credentials, fragments or redirects remain refused without exposing private URLs


#### Scenario: Sonos local artwork and source-specific origin rules
- **WHEN** the configured Sonos source advertises an absolute or relative HTTP image on its configured origin
- **THEN** the owner acquires it through the existing bounded pipeline and publishes a ready playback/2.1 thumbnail for both display consumers
- **AND** off-origin URLs, credentials, fragments, redirects and Sony-only alternate ports are refused without blocking metadata

#### Scenario: Artwork diagnostics identify the actual source
- **WHEN** an acquisition fails, retries, exhausts its attempts or recovers
- **THEN** existing safe media diagnostics name the source of that acquisition without URLs, images or listening metadata

### Requirement: Artwork follows the presented observation

Artwork SHALL carry an opaque generation that changes on a presented source or reported track change, loss of the eligible playing/paused session, unavailable playback or restart. A generation SHALL persist through duplicate polls, playing/paused transitions and freshness-only changes. Candidate replacement SHALL invalidate earlier pending results even within the same generation. The owner SHALL retain only current artwork, deduplicate acquired candidates and permit at most three transient attempts per candidate and generation, spaced by bounded backoff. A later candidate after absent content SHALL be eligible for acquisition. Image completion SHALL NOT refresh metadata evidence or trigger a new-track presentation. Sonos SHALL acquire only its own candidate and SHALL NOT inherit Sony artwork; Sony SHALL NOT inherit Sonos artwork. Either source without a usable candidate SHALL publish missing artwork. Metadata that the receiver has not yet reported SHALL NOT be inferred.

#### Scenario: Late artwork after a handoff
- **WHEN** Sony artwork is pending and Sonos becomes presented with identical text
- **THEN** the generation changes, Sonos has its own new missing or ready artwork state and the late Sony result cannot restore an image

#### Scenario: Same observation receives artwork later
- **WHEN** duplicate metadata initially lacks a candidate and later reports one
- **THEN** the current generation can become ready without changing the track, freshness evidence or presentation timer

#### Scenario: Stop and restart
- **WHEN** the module stops while fetching or decoding and then restarts
- **THEN** pending work is aborted, cannot publish and cannot restore the previous image


#### Scenario: Sonos playback on both displays
- **WHEN** a presented Sonos track has a ready normalized image
- **THEN** Tidbyt and Pixoo consume that image through their existing playback/2.1 layouts, gates and mode policies
- **AND** changing the Sonos track retires pending earlier work without resetting metadata freshness

### Requirement: Passive reads of current playback artwork

The playback owner SHALL provide its current bounded normalized PNG through its authenticated module content contribution, addressed by artwork generation and playback record revision. Content SHALL be available only for the exact current available, known playing or paused Sony or Sonos observation whose committed ready record matches the owner's current artwork and metadata. Malformed, missing, obsolete, stale, unavailable, stopped or mismatched references SHALL return the existing safe missing-content result. Stop and abort SHALL retire content from that run. A read SHALL perform no receiver fetch, worker decode, publication, revision change, freshness reset or command. It SHALL expose neither a receiver URL nor credentials, listening metadata or native exception text. The existing gateway read authority, no-store and nosniff policies SHALL protect the returned PNG.

#### Scenario: Several consumers read the same thumbnail
- **WHEN** multiple authorized read-only consumers request the current ready thumbnail
- **THEN** they receive the same bounded PNG without another acquisition, decode, state publication or command

#### Scenario: Replacement precedes publication
- **WHEN** the owner has moved to another candidate or observation while the committed record still identifies earlier artwork
- **THEN** the earlier reference returns missing content until the exact current ready record and private snapshot agree

#### Scenario: Generation persists while the record changes
- **WHEN** a playing-to-paused transition or same-generation candidate replacement publishes a newer record revision
- **THEN** its new reference is distinct, the old revision reference returns missing content, and only the current matching ready image is served

#### Scenario: Source, freshness and run boundaries
- **WHEN** the presented source changes, playback becomes stale, unavailable or inactive, publication rolls back, or the module stops or restarts
- **THEN** previously issued image references cannot serve obsolete artwork and content reads cause no recovery effect

#### Scenario: Authority and safe errors
- **WHEN** an unauthenticated caller, an authenticated caller without read authority, or an authorized caller with an obsolete or absent artwork reference requests content
- **THEN** the existing gateway returns respectively its safe authentication, authorization or missing-content response without echoing private input, malformed gateway references retain the existing input refusal, and valid content uses image/png, no-store and nosniff
