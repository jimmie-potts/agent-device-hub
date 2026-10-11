## MODIFIED Requirements

### Requirement: Optional shared Sony artwork

The playback owner SHALL acquire optional Sony artwork independently of metadata and controls. It SHALL fetch only an absolute HTTP URL on the configured receiver's origin or on the same configured receiver IPv4 address at port 58080, without credentials or a fragment. It SHALL refuse all other hosts and ports and all redirects. Acquisition SHALL ignore HTTP media-type claims, admit JPEG or PNG bytes, and normalize a single image to a metadata-free PNG no larger than 128×128 and 65,536 bytes. Input SHALL be limited to 1,048,576 bytes and 4,000,000 decoded pixels. Fetch and worker decode SHALL each have a 2,000 ms deadline. At most one acquisition chain SHALL be admitted at a time, with only the newest replacement retained. Failures SHALL retain text-only playback and current control routing, with safe diagnostics that expose no URL, image bytes or listening metadata.

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
