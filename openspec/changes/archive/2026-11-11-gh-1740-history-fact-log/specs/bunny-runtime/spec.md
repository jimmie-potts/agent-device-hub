## ADDED Requirements

### Requirement: Core history fact log

Each core history row SHALL name its origin, the installation that wrote it, and its place in that origin's order (#1740, owner decisions on #1729). The origin SHALL be a random UUID that the core store creates once, in the transaction that opens history, and keeps in the store; it SHALL need no configuration and SHALL never be derived from a host name, user name, address or path. A new row SHALL take the store's origin and the next sequence of that origin, counting from 1 with no gaps or repeats. A store written before this change SHALL gain the origin and both columns at its first open, with every existing row given the store's origin and a sequence in the order the rows were written, in one transaction that changes no other column, row or table; a failure SHALL change nothing, and opening a migrated store again SHALL change nothing. A row without an origin, as a release before this change writes one, SHALL be given the store's origin and the next sequences at the next open. The core SHALL return, for an origin and a sequence N, that origin's rows after N in order, at most 500 a call; the reader SHALL keep its own cursor and the core SHALL store no reader position. An origin the store does not hold SHALL return nothing. Reading SHALL write nothing, publish nothing and trigger nothing. History's duplicate check SHALL look only at the store's own origin's rows. The message envelope and every message contract SHALL stay unchanged: the origin lives in the history row only.

#### Scenario: A store written by the previous release
- **WHEN** a store whose history the release before this change wrote, with every kind of row, an operation step without a message ID and a gap in `seq`, opens
- **THEN** every row has the store's origin and the sequences 1 to n in `seq` order, every other column, table and index but the replaced message index is unchanged, and opening it again changes nothing

#### Scenario: The origin
- **WHEN** a core store opens, restarts, and a second store opens
- **THEN** the first store's origin is a version 4 UUID that names no host, user or path, the same after the restart and kept in one row, and the second store's origin differs

#### Scenario: Read after N
- **WHEN** a reader reads an origin after a sequence N with a limit, pages through with its own cursor, reads after its last sequence, and reads an unknown origin
- **THEN** it gets exactly that origin's rows after N in order, at most the limit, the whole log once, then nothing new, and nothing for the unknown origin, and no table changes and nothing is published

#### Scenario: Another origin's copy of a fact
- **WHEN** history holds another origin's row for an outcome's `(source, id)` and the same outcome arrives locally
- **THEN** the local check answers `new`, history keeps the local copy, and a resend of it is a duplicate that adds nothing
