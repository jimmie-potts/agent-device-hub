# Nanoleaf port

This package is the TypeScript port of the Nanoleaf domain logic for
[#26](https://github.com/jimmie-potts/agent-device-hub/issues/26). It is staging:
nothing runs it yet. The Nanoleaf module story
([#844](https://github.com/jimmie-potts/agent-device-hub/issues/844)) wires it into
the runtime. The installed Python runtime keeps running unchanged until the cutover.

## Provenance

- Source: [jimmie-potts/codex-nanoleaf](https://github.com/jimmie-potts/codex-nanoleaf),
  `main` at `c711e1812d6871952562e9070e20bdebe120db3a` (2026-10-03).
- Python 3.12 is the installed runtime's minimum; fixtures were recorded with Python 3.14.
- Copied fixtures, all synthetic:
  - `tests/fixtures/nl22-panels-fixture.json` from `tests/fixtures/`.
  - `tests/fixtures/linux-state-v4/status.sql` and `layout-fixture.json` from
    `tests/fixtures/linux-state-v4/`.
  - `tests/fixtures/snapshot-v1.json`: case 0 (`current-notice-and-chosen-label`) of
    `bridge/vendor/agent-state-3.3.0/package/fixtures/snapshots-v1.json`.
- `tests/fixtures/recorded/*.json` were recorded from the Python bridge at that commit
  by `tests/fixtures/record.py` (see [Recorded comparisons](#recorded-comparisons)).

## Active Nanoleaf work at the start of the port

Checked on 2026-10-06:

- Open PRs: none.
- Branches: every local and remote branch belongs to a merged PR. Three are older states of
  merged work: `codex/gh-2-sdlc` (local, behind PR #3), `codex/gh-2-shared-skills` (PR #3's
  head) and `codex/gh-28-hub-controller-api` (local, behind PR #39). `codex/gh-17-live-renderer`
  has no PR; its head is already in `main`.
- Worktrees: the main checkout, `.local/worktrees/gh-17-live-renderer` (clean, merged head) and a
  Codex Desktop worktree on `codex/gh-2-shared-skills` (merged).
- Open issues: 40 feature, investigation and documentation issues; none has an open PR or branch.

## Slices

The issue delivers the port in three PRs by area. Each PR ports its domain code with its
translated tests. Slice 1 also takes the device registry, layout and schema migration from
`devices.py` and the NL22 layout reader from `panels.py`, because projection and enrollment
need them.

| Slice | Covers | Status |
| --- | --- | --- |
| 1 | Session-to-Line projection, enrollment, and the saved state they need | This change |
| 2 | Device configuration loading, geometry, the renderer, effects and the Nanoleaf HTTP client | Planned |
| 3 | The worker, legacy hook input, modes, scenes, comets and edits | Planned |

### Python modules

| Python module | Slice 1 | Later slice | Not ported (replacement) |
| --- | --- | --- | --- |
| `database.py` | `connect_state` (`database.ts`) | | `seed_synthetic`: demo and browser fixtures (#844 scenarios) |
| `devices.py` | All (`devices.ts`) | | `write_json` duplicates `jsonfile.write_json` |
| `store.py` | All (`store.ts`) | | |
| `jsonfile.py` | All (`jsonfile.ts`) | | |
| `panels.py` | `read_layout` (`panels.ts`) | | |
| `shared_input.py` | Snapshot projection, grouping, evictions, legacy task backup (`shared-input.ts`) | 2: `render_config` | Feed transport and schema check: `validate_snapshot`, `private_read`, `request`, `check_envelope` (its revision floor is kept), `fetch_snapshot`; `inspect` (runtime state, #844) |
| `shared_source.py` | `configure`, `source_config`, `select_source`, `accept`, `failed` as transaction bodies (`shared-source.ts`) | | Preflight fetch, `Poller`, `acknowledge` (core session events and commands, #844); `metadata_reader` and `command` (configuration wiring and CLI, #844); the legacy hooks check (hook registration retired) |
| `project_map.py` | Task metadata and placement: `init`, `seed`, `settings`, `line_id`, `normalize`, `default_color`, `fallback_title`, `Metadata`, `task_projects`, `owners`, `allocate` (`project-map.ts`) | 2: palette, `render_config`, Line, triangle and connector geometry. 3: `record_event`, palette writes, `rendering_snapshot`, map patches, `locate_state` | |
| `bridge.py` | `dashboard` (`line-projection.ts`) | 2: pulse, wave, comet and zone colors, `effect_payload`, `render`. 3: `transition`, `handle_event`, `reconcile_read_state`, `unread_reader`, `SceneRestorer`, comets, `update_display`, previews, `run_worker` | `setup`, `main` (installer and CLI) |
| `configuration.py` | `registered_devices` (`configuration.ts`) | 2: `pair_lines`, `load_config`, `follow_registry` | `data_dir` (installation path) |
| `enrollment.py` | `enroll`, `change_address`, `remove`, `check` and their checks (`enrollment.ts`) | 2: `pair`, with the HTTP client | `read_token`, `reason`, `command` (CLI, #844) |
| `transport.py` | | 2: the Nanoleaf HTTP API client | |
| `effects.py` | | 2 | |
| `modes.py`, `edits.py` | | 3 | |
| `integration_api.py` | | 2: saved animation favorites and their table | The integration extension API (runtime commands, #844) |
| `controller_server.py`, `controller_state.py`, `controller_contract.py` | | | The HTTP controller and its ledger (runtime commands and replies) |
| `codex_hooks.py` | | | Codex hook registration, retired (owner decision, 2026-10-05) |
| `wall_server.py`, `wall.html`, `prism*.js`, `assets/` | | | The web server is replaced by the runtime; the wall pages, their view and assets move with #844 |
| `launcher.py` | | | Process launch (runtime module host) |
| `diagnostics.py` | | | Runtime observability |
| `install_*.py`, `runtime_*.py` | | | Install and packaging (the extended installer, #840) |
| `vendor/`, `mcp/`, `contracts/`, `scripts/` | | | Vendored package copies, the Node MCP host, the integration contract, and repository tooling |

### Python test files

Translated tests keep the Python class as the suite name and the method as the test name.
"Partly" means the translated test drops assertions about a later slice or an unported layer;
each such test says so in a comment.

| Python test file | Cases | Slice 1 | Rest |
| --- | --- | --- | --- |
| `test_shared_input.py` | 74 | 57 translated (`shared-input.test.ts`). Partly: `test_atomic_cutover_identity_and_legacy_suppression`, `test_failed_preflight_and_comet_reservation_preserve_legacy`, `test_owner_recovery_clears_stale_red_without_clearing_other_state`, `test_loss_freezes_colors_and_reconnect_preserves_epoch`, `test_recovered_session_keeps_epoch_without_replaying_outward_wave`, `test_read_task_keeps_row_and_line_until_owner_removes_it`, `test_eviction_http_requires_origin_token_and_current_task`, `test_skipped_sessions_take_no_part_in_grouping_or_acknowledgment`, `test_declared_subagent_of_an_undeclared_parent_follows_the_missing_parent_rule`, `test_damaged_backup_refuses_rollback_without_partial_restore`. `test_released_owner_clears_only_nanoleaf_on_evidenced_new_turn` uses the recorded owner snapshot | Slice 2: `test_stale_peer_does_not_suppress_healthy_outward_wave`. Slice 3: `test_rollback_completion_can_be_read_and_release_its_line`, `test_worker_polls_and_refreshes_metadata_in_free_without_legacy_unread_reads`. Not ported: `SharedContractTest` (3) and four `TransportTest` cases (feed transport and schema check), the two legacy hooks checks, `test_inspection_missing_state_does_not_create_files`, `CommandTest` (2, CLI and owner acknowledgment), `test_pinned_archive_and_extracted_files` (vendored copy), `StartupTest` (wall server start) |
| `test_shared_metadata.py` | 10 | 10 translated (`shared-metadata.test.ts`). Partly: `test_shared_title_and_project_precede_local_metadata` (inspection view), `test_poll_refreshes_same_revision_without_lifecycle_or_effect_changes` (poller) | |
| `test_enrollment.py` | 44 | 30 translated (`enrollment.test.ts`). Partly: `test_files_are_owner_only_and_output_never_contains_the_credential`, `test_conflicts_are_refused_before_pairing_or_prompting`, `test_enrolled_device_stays_dark_until_activated`, `test_machine_credentials_are_unchanged`, `test_changes_only_the_registered_address`, `test_malformed_layout_is_refused_before_removal_writes`, `test_failure_after_the_registry_write_asks_for_a_rerun` | Slice 2: `test_saved_geometry_loads_while_the_device_is_unreachable`, `test_pair_posts_to_the_new_endpoint_without_a_proxy`. Slice 3: `test_activation_replays_no_comet_or_wave`. Not ported (CLI, prompt, installer): `test_http_failure_reports_only_the_status`, `test_hidden_prompt_supplies_the_credential`, `test_pairing_obtains_the_credential_from_the_device`, `test_installer_reads_its_token_file_through_the_shared_reader`, `test_output_names_activation_and_needs_no_restart`, `test_busy_state_is_reported_without_a_traceback`, `test_command_reports_removal`, both `AddressTest.test_command_*`, `DispatchTest` (2) |
| `test_devices.py` | 15 | 7 translated (`devices.test.ts`). Partly: `test_malformed_layout_is_rejected_and_last_valid_file_kept`, `test_pre_change_linux_database_migrates_and_repeats_without_change` | Slice 2: `test_legacy_layout_loads_as_default_device_without_request`, `test_version_two_layout_with_lines_and_triangles`, `test_registry_address_change_keeps_identity_and_preferences`. Slice 3: `test_equal_element_ids_on_two_devices_do_not_collide`, `test_literally_equal_element_ids_on_two_devices_keep_separate_state`, `test_modes_and_scene_files_are_independent_per_device`, `test_untargeted_callers_address_default_device`. Not ported: `test_installer_writes_per_device_layout_and_registry` |
| `test_bridge.py` | 45 | 3 translated (`devices.test.ts`): `test_failed_initialization_closes_connection` (counts open file handles instead of patched connections), `test_failed_initialization_rolls_back_partial_schema`, `test_migration_keeps_task_assignments_and_removes_old_notifications` | Slice 2: the color, pulse, wave, zone pairing and payload cases. Slice 3: the hook event, worker, render receipt, unread and read indicator cases. Not ported: `test_merge_preserves_other_hooks_and_uninstall` |
| `test_panels.py` | 15 | 6 translated (`devices.test.ts`): `GeometryTest` (5) and, partly, `test_six_triangle_reservation_and_shared_overflow` | Slice 2: `DiscoveryTest` (2), `PayloadTest` (6), `test_render_config_gives_triangles_no_signature` |
| `test_project_map.py` | 27 | 8 translated (`project-map.test.ts`): the placement and metadata cases; map edits are saved as their rows | Slice 2: `test_split_base_status_half_and_swap`, `test_whole_wave_and_comet_restore_project_color`, `test_idle_reserved_signature_and_quiet`, `test_status_coverage_keeps_unknown_project_half_blue`. Slice 3: `test_active_comet_defers_mapping_and_style`, `test_color_changes_do_not_restart_task`, `test_turn_elapsed_not_status_elapsed`, `test_locate_waits_for_comet_and_free_rejects`, `test_api_validation_and_no_credentials`, `test_partial_effect_acceptance_keeps_prior_receipt_and_reports_failure`, `test_pending_half_edit_preserves_pending_owner`, `test_preferences_persist_after_reopen`, `test_idle_locate_returns_scene_after_one_second`, `test_project_early_read_comet_finishes_before_scene_restore`, `test_color_edit_invalidates_display_without_pulse_or_comet_replay`, `test_rendering_endpoint_reports_pending_failed_free_and_unknown`. Not ported (wall server): `test_rendering_endpoint_is_readonly_and_restart_safe`, `test_http_origin_host_and_token_checks`, `test_map_retries_missing_geometry` |
| `test_effects.py`, `test_comets.py`, `test_modes.py`, `test_scene_restore.py`, `test_palette.py`, `test_device_worker.py`, `test_connector_geometry.py`, `test_edit_parity.py`, `test_animation_favorites.py` | | | Slice 2 or 3 by area. Their HTTP, integration and wall server checks are not ported |
| `test_controller_*.py`, `test_integration_*.py`, `test_panels_controller.py`, `test_wall_devices.py`, `test_codex_links.py`, `test_prism_assets.py` | | | Not ported: the HTTP controller, integration API and wall server. Wall view and link behavior moves with #844; requested animations and favorites with slices 2 and 3 |
| `test_hook_management.py` | | | Not ported: hook registration is retired |
| `test_linux_runtime.py`, `test_runtime_install.py`, `test_runtime_adapter.py`, `test_cli_compatibility.py`, `test_observability.py`, `test_measure_shared.py`, `test_verify_vendor.py`, `test_module_dependencies.py` | | | Not ported: install, packaging, CLI, diagnostics, tooling and vendored copies. The module boundary lint replaces the import-direction checks |
| `test_demo_fixture.py`, `test_demo_runs.py`, `verify_*.mjs` | | | Not ported: #844 replaces the demo and verification adapter with simulated transport and scenarios |
| `*_checks.cjs`, `wall_options.cjs` | | | Wall page browser checks move with the pages (#844); `workflow_checks.cjs` is the old repository's |

## Recorded comparisons

Where the translated tests leave behavior open, the port is compared with Python on recorded inputs.
`record.py` runs the Python bridge read-only and writes:

- `values.json`: identity keys, eviction tokens, default project colors, fallback titles, path
  normalization, float text, rounding, JSON text and private-address checks (`compat.test.ts`).
- `setups.json`: the state the Python tests' setUp methods saved. Legacy hook events and mode
  commands belong to later slices, so the translated tests load this state instead. Two small test
  helpers that stand in for them are checked against it.
- `owner-snapshot.json`: the released agent-state 3.3.0 owner's snapshot for `ReleaseTest`.
- `trace.json`: three random sequences and two scripted ones (comets; Line placement) through
  source switches, owner revisions, feed loss, placement, evictions, comets, modes, reservations and
  Codex metadata. `trace.test.ts` replays every step and compares every saved row and result.

To re-record, run from the repository root with a codex-nanoleaf checkout at the provenance commit:

```bash
PYTHONDONTWRITEBYTECODE=1 fnm exec --using=.nvmrc -- python3 modules/nanoleaf/tests/fixtures/record.py <codex-nanoleaf>
```

## Known differences

- The runtime validates sessions before the port sees them, so the 1.x feed's schema check is not
  ported. The revision floor stays: an older snapshot never replaces a newer one.
- Without the HTTP controller, enrollment no longer drops or checks a device's controller ledger.
- Enrollment is asynchronous because device reads are. Its cross-process SQLite locks are kept:
  inside one process, a busy registry lock blocks the event loop for up to five seconds, so #844
  must serialize these operations.
- `acceptEnvelope` and `selectSource` refresh Codex metadata inside the caller's transaction;
  Python read the files before opening it.
- JSON numbers carry no int or float type. Whole numbers are written without `.0` in saved JSON,
  and a whole float such as `5.0` passes checks that Python's `type(x) is int` refused. Saved
  `meta` float text keeps Python's form.
- JavaScript lists integer-like object keys first, so a device or project ID such as `2` would
  change position in a rewritten JSON file. The IDs in use are not integer-like.
- Saved JSON is the module's own, so the duplicate-key check that guarded feed and configuration
  input is not ported.
- A non-string device `kind` is a `ValueError` here; Python raised `TypeError`.

## Open question

Hook registration is retired, but #844 keeps "explicit shared or legacy input selection". Slice 3
ports the legacy hook reducer with the worker. If no legacy input reaches the runtime, the legacy
source, its backup and the reducer can be dropped there instead.
