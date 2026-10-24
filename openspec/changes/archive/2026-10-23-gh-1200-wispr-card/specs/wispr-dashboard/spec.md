## ADDED Requirements

### Requirement: Reusable quiet-line Home summary

The dashboard SHALL use a reusable quiet-line Wispr card with captured words and speaking minutes, a seven-date line and local day selection, Refresh and Open Wispr. Its Home adapter SHALL use the existing numeric-only acquisition and widget identity under the existing catalog exposure and layout rules. It SHALL leave the full analytics page, filters and numeric exports available. The card SHALL use shared light/dark styling and SHALL remain usable at desktop and phone widths with reduced motion. Chart values SHALL have equivalent keyboard/touch controls and a table alternative. Browsing or refreshing SHALL send no device or collector command, and SHALL introduce no polling.

#### Scenario: Inspect a missing day
- **WHEN** an exposed Home card receives a partial seven-day numeric snapshot and the owner selects an absent date
- **THEN** the line has a gap, the selected date says Not observed, the table agrees and no missing metric becomes zero

#### Scenario: Navigate to full analytics
- **WHEN** the owner opens Wispr from the Home card
- **THEN** the existing analytics page retains its own filters, language protections and numeric downloads

#### Scenario: Refresh and availability
- **WHEN** the initial read is pending, a refresh fails or no usable data exists
- **THEN** loading and unavailable metrics use unknown values, failed-refresh last-good numeric data retains its original collection age with a stale label, and a compact indicator explains nonavailable states without highlighting the whole card

#### Scenario: Expired reporting day
- **WHEN** the producer's Today window has expired
- **THEN** the card labels the captured date as stale instead of presenting its totals as current Today

#### Scenario: Retire a read
- **WHEN** a newer refresh supersedes a read, the card unmounts, access is refused or the connection identity changes
- **THEN** retired replies cannot commit and denied access removes retained numeric data
