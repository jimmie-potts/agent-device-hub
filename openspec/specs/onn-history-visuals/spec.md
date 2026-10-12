# onn-history-visuals Specification

## Purpose

Show one ONN's current selected content and retained title observations through
the authenticated dashboard, with useful filters and truthful source limits.

## Requirements

### Requirement: Current content beside qualified controls

The ONN page SHALL show its latest supported YouTube/Stremio metadata beside
the existing controls. It SHALL distinguish fresh, stale, disabled and unavailable
collection, ambiguous sessions and known gaps. A lost sync or expired observation
SHALL NOT present an old title as fresh. An accepted empty sample SHALL clear
current content. Position, duration and playback state SHALL remain reported
source values without extrapolation, completion estimates or watched-time claims.

#### Scenario: Content change, exit and stale evidence
- **WHEN** synthetic content changes between episodes, exits, loses sync or ages
- **THEN** the current view updates or clears, or labels retained values as last observed, and does not keep the old episode confidently current

#### Scenario: YouTube and unsupported metadata
- **WHEN** a YouTube selected title, incomplete metadata or ambiguous sessions are supplied
- **THEN** the view labels selected-title evidence, missing fields and ambiguity explicitly, without asserting main-video viewing or deriving topics

### Requirement: Searchable bounded stored history

The page SHALL browse the owning stored-data interface with app, local date and
title filters and bounded continuation pages. Date controls SHALL declare their
inclusive/exclusive boundaries and use calendar arithmetic across midnight/DST.
Results SHALL display observation timestamps, available channel/series/episode
fields and identity confidence. Occurrence details SHALL expose contributing
observations, reported progress, provenance and omissions at their query cutoff.
An empty page with continuation SHALL retain access to the next evidence window.

#### Scenario: Prior titles and last observed episode
- **WHEN** a synthetic reader filters prior local dates and apps, pages results and opens a Stremio occurrence
- **THEN** the displayed titles and episode observations match the owning query's filters, evidence order, cutoff and detail pages

#### Scenario: Midnight and daylight saving
- **WHEN** a local calendar range crosses midnight or a daylight-saving boundary
- **THEN** the query sends the selected calendar boundaries and timestamps display locally, including days that contain twenty-three or twenty-five hours

### Requirement: Truthful read failures and collection coverage

History and details SHALL show known coverage, gaps, storage loss and projection
limits. Unsupported or malformed documents and failed reads SHALL have a neutral
failure state. Only the latest active submitted read SHALL update its results;
late replies after navigation, filter changes or disconnect SHALL NOT replace
newer results. Previously displayed data SHALL be cleared or explicitly marked
as a retained read, and never relabelled as a successful current query.

#### Scenario: Refusal, racing replies and reconnect
- **WHEN** a read fails, a delayed earlier query returns after a new query, or the browser reconnects
- **THEN** the view keeps the failed/stale context truthful, discards superseded replies, and obtains current owner evidence without a device command

### Requirement: Accessible private read-only interactions

The history interface SHALL work with keyboard navigation and phone/desktop
layouts without horizontal overflow. Labels, status, empty and error states SHALL
remain accessible for long titles and incomplete metadata. Personal metadata
SHALL render as text without executable markup, external resource loads or new
browser persistence. History navigation, filtering, paging and refresh SHALL
send no device control or model call, including for a read-only session. Existing
controls SHALL keep their authority, freshness, tracking and no-replay behavior.

#### Scenario: Accessible browsing without effects
- **WHEN** a read-only synthetic user browses empty/long/unsupported history by keyboard on phone and desktop
- **THEN** accessible names/statuses and content remain usable, automatic accessibility checks pass, and the device effect count remains unchanged

#### Scenario: Shared executable acceptance
- **WHEN** CI and independent disposable Acceptance run the registered ONN history journey
- **THEN** both observe the declared history behavior through the same catalog and authenticated dashboard, with source evidence distinguished from installed and physical acceptance
