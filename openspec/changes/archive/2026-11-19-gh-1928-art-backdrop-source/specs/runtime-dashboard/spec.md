## MODIFIED Requirements

### Requirement: Module-owned art presentation
The runtime dashboard SHALL expose the shipped art widget and Gallery through its existing authenticated module frontend and card catalog. It SHALL reuse the shell's connection and tracked-command controls, without polling, generated application code or a second persistent catalog. The art frontend SHALL also export a backdrop source that the shell mounts once on Home through the same module frontend scope while the art module runs, and that hands the shell the decoded image of the composition the Art widget presents: its largest still, read once through the existing authenticated content route, with its artwork, composition and rendition identity, size, palette and readiness, and no new route, `data:` or `blob:` URL or pixels outside page memory. With nothing to present or no source mounted, the backdrop SHALL report none without an image and without failing. Gallery browsing SHALL NOT change it. The presentation SHALL retain keyboard focus, touch controls, visible stale/unavailable feedback and captions at desktop and 320/390px widths in both browser appearances.

#### Scenario: Browse art with keyboard and a narrow screen
- **WHEN** the owner opens Gallery, selects a saved composition and operates its explicit controls using the keyboard at 390px
- **THEN** controls and captions remain visible without horizontal overflow, focus is visible and browsing sends no command

#### Scenario: The shell receives the presented artwork
- **WHEN** Home shows the Art widget with a presented artwork
- **THEN** the backdrop export reports the same artwork and composition, ready, decoded from one content request for that composition's largest still, and no request leaves the dashboard origin under the unchanged Content Security Policy

#### Scenario: Nothing to present
- **WHEN** no artwork is available to present, or the art module is not running
- **THEN** the backdrop export reports none with no image, Home renders and nothing throws

### Requirement: Presented art supplies presentation metadata
The art frontend SHALL expose as presentation metadata only the identity, validated palette and readiness/freshness of art actually decoded and presented. A pending catalog update SHALL NOT replace that presentation metadata, and the same rule SHALL hold for the backdrop image: a newer image that is loading, stale or failed SHALL leave the last ready image in place, and an obsolete load SHALL NOT replace a newer one. The presentation metadata SHALL combine the evidence of the visible widget and of the backdrop rendition the shell reports drawn, so one surface going idle does not erase the other's. Missing or stale evidence SHALL remain explicit. This metadata SHALL be transient presentation state, with the art module remaining the catalog owner and the core remaining the layout owner.

#### Scenario: A new catalog entry is pending
- **WHEN** the catalog announces new art while its rendition is loading
- **THEN** presentation consumers retain the visible artwork's palette until the new image is decoded and displayed

#### Scenario: A newer backdrop image is slow or fails
- **WHEN** the selection changes and the new backdrop image is still loading, or its bytes fail validation
- **THEN** the backdrop keeps the previous ready image and reports loading or unavailable, and a load for an older selection that completes later does not replace the newer image

#### Scenario: One surface goes idle
- **WHEN** the shell reports the backdrop rendition drawn and the Art widget leaves the viewport or unmounts
- **THEN** presentation consumers keep the backdrop's ready evidence; when the shell withdraws it too, the evidence becomes idle
