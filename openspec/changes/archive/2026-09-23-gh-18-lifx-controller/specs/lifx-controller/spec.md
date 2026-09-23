## Purpose

Provide bounded, configured-target LIFX LAN control with per-bulb outcomes and dated observations while preserving the shared controller contract.

## ADDED Requirements

### Requirement: Configured targets and qualified capabilities
The controller SHALL target only operator-configured unicast IPv4 bulbs, consume controller v1 for power and brightness, and expose color and temperature through a separately versioned strict LIFX profile. Unsupported or unknown features MUST fail before any packet is sent. No caller command SHALL contain an address or raw packet. Construction and source tests MUST NOT contact bulbs or discover devices.

#### Scenario: Qualified bulb
- **WHEN** vendor 1 product 27 firmware 2.90 is configured from qualification evidence
- **THEN** power, brightness, color and 1500–9000 K temperature are supported and effects remain unsupported

#### Scenario: Unsupported or malformed command
- **WHEN** a caller requests an unsupported feature or includes a destination or raw packet
- **THEN** the controller rejects it without traffic

### Requirement: One bounded queue per bulb
The controller SHALL serialize reads and writes for each configured bulb, preserve controller v1 request replay, revision and generation rules, and bound admission and retries. Partial color changes MUST preserve other observed HSBK components. Cancellation SHALL prevent queued writes and further retries, retaining possible effects of an already dispatched write.

#### Scenario: Overlapping writes and reads
- **WHEN** two commands and a read overlap for one bulb
- **THEN** their transport operations do not overlap and a brightness change preserves the color read in its queue turn

#### Scenario: Lost reply and timeout
- **WHEN** a reply is lost or a transport never settles
- **THEN** the attempt times out, only the configured bounded retries occur, and exhausted writes report uncertain possible effects while exhausted reads report failure

#### Scenario: Replay and cancellation
- **WHEN** an identical request is repeated or queued work is cancelled
- **THEN** replay causes no new transmission and cancelled work starts no later side effect

### Requirement: Independent results and observations
The controller SHALL return per-bulb results for a bounded multi-bulb submission without rolling back successful bulbs. Snapshots SHALL distinguish desired state, acknowledged transmission and observed state with a monotonic read time and age. Reads SHALL NOT issue Set messages. Acknowledgments MUST NOT imply visible change or refresh observation time.

#### Scenario: Partial multi-bulb failure
- **WHEN** one bulb acknowledges and another times out
- **THEN** both distinct results are retained and the successful bulb is not replayed

#### Scenario: Dated read
- **WHEN** a valid LightState reply is received and later a command is acknowledged
- **THEN** the observation retains its read time and gains age without claiming visible success

### Requirement: Source verification
The package SHALL participate in root build/type commands and required CI with fake transport tests covering the scenarios above and shared contract validation.

#### Scenario: Offline source checks
- **WHEN** the LIFX test suite runs
- **THEN** no native network socket or physical device is needed and malformed packet correlation is tested
