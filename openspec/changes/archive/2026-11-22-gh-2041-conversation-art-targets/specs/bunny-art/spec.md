## ADDED Requirements

### Requirement: Identify usable compositions for the saved Conversation attachment

A ready private Conversation attachment read SHALL identify its artwork and the rendition kinds for which that exact retained artwork has a usable composition. Eligibility SHALL require a successful composition with an ID and at least one rendition.

#### Scenario: A saved creation can be prepared for another display kind

- **WHEN** Art saves a generated Conversation GIF or still that the local media converter can render
- **THEN** it retains the primary reply and creates browser and supported display compositions from the same source without an additional provider call or display command

#### Scenario: A new picture enters the catalog

- **WHEN** the owner reopens an earlier generated attachment after a later artwork has finished
- **THEN** the attachment provides the original artwork's saved media and usable kinds for display selection
