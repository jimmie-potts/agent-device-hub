# Nanoleaf port

This package is the TypeScript port of the Nanoleaf domain logic for
[#26](https://github.com/jimmie-potts/agent-device-hub/issues/26). It is staging:
nothing runs it yet. The Nanoleaf module story
([#844](https://github.com/jimmie-potts/agent-device-hub/issues/844)) wires it into
the runtime. The installed Python runtime keeps running unchanged until the cutover.
GitHub issues own the delivery status of each slice.

## Provenance

- Source: [jimmie-potts/codex-nanoleaf](https://github.com/jimmie-potts/codex-nanoleaf),
  `main` at `c711e1812d6871952562e9070e20bdebe120db3a` (2026-10-03).
- Python 3.12 is the installed runtime's minimum; fixtures were recorded with Python 3.14.
- Copied fixtures, all synthetic:
  - `tests/fixtures/nl22-panels-fixture.json` and `lines-layout.json` from `tests/fixtures/`.
  - `tests/fixtures/linux-state-v4/status.sql`, `layout-fixture.json` and `config-fixture.json` from
    `tests/fixtures/linux-state-v4/`.
  - `tests/fixtures/snapshot-v1.json`: case 0 (`current-notice-and-chosen-label`) of
    `bridge/vendor/agent-state-3.3.0/package/fixtures/snapshots-v1.json`.
- `tests/fixtures/recorded/*.json` were recorded from the Python bridge at that commit
  by `tests/fixtures/record.py` (see [Recorded comparisons](#recorded-comparisons)).

## Nanoleaf work at the start of the port

Checked on 2026-10-06:

- Open PRs: none.
- Branches: every local and remote branch belongs to a merged PR. Three are older states of
  merged work: `codex/gh-2-sdlc` (local, behind PR #3), `codex/gh-2-shared-skills` (PR #3's
  head) and `codex/gh-28-hub-controller-api` (local, behind PR #39). `codex/gh-17-live-renderer`
  has no PR; its head is already in `main`.
- Worktrees: the main checkout, `.local/worktrees/gh-17-live-renderer` (clean, merged head) and a
  Codex Desktop worktree on `codex/gh-2-shared-skills` (merged).
- Open issues: 48, none with an open PR or branch. Three touch the slice 1 projection code, and
  the port reproduces the behavior they describe:
  - codex-nanoleaf#81 (bug): a parent's completion comet is lost when a subagent delays its
    unread state.
  - codex-nanoleaf#115 (bug): a skipped owner revision is treated as a resync, which drops comets
    and waves. Its premise is the once-a-second poll; following core session events in the
    runtime changes when revisions are skipped.
  - codex-nanoleaf#160 (investigation): Codex sessions left blocked by MCP tool approvals.

## Slices

The issue delivers the port in PRs by area, each with its translated tests:

1. Session-to-Line projection and enrollment. This slice also takes the device registry, layout
   and schema migration from `devices.py` and the NL22 layout reader from `panels.py`, because
   projection and enrollment need them.
2. Slice 2 is split in two by size:
   - 2a: device configuration loading, Line pairing, map geometry and the renderer, with the
     display encoder it shares with effects.
   - 2b: effects, saved animation favorites and the Nanoleaf HTTP client, including `pair`.
3. The worker, legacy hook input, modes, scenes, comets, edits and the control execution half of
   `controller_state.py`.

Slice 1 drafted the port before translating its tests, then ran the translations against it.
Slices 2 and 3 translate their tests first.

### Python modules

| Python module | Ported (slice 1 unless marked) | Later slice | Not ported (replacement) |
| --- | --- | --- | --- |
| `database.py` | `connect_state` (`database.ts`) | | `seed_synthetic`: demo and browser fixtures (#844 scenarios) |
| `devices.py` | All (`devices.ts`) | | `write_json` duplicates `jsonfile.write_json` |
| `store.py` | All (`store.ts`) | | |
| `jsonfile.py` | All (`jsonfile.ts`) | | |
| `panels.py` | `read_layout` (`panels.ts`) | | |
| `shared_input.py` | Snapshot projection, grouping, evictions, legacy task backup, and the consumer part of `check_envelope` (`shared-input.ts`). 2a: `render_config` (`sharedRenderConfig`) | | The rest of the feed: `validate_snapshot`, `private_read`, `request`, `fetch_snapshot` and the other `check_envelope` checks (see [Known differences](#known-differences)); `inspect` (runtime state, #844) |
| `shared_source.py` | `configure`, `source_config`, `select_source`, `accept`, `failed` as transaction bodies (`shared-source.ts`) | | Preflight fetch, `Poller`, `acknowledge` (core session events and commands, #844); `metadata_reader` and `command` (configuration wiring and CLI, #844); the legacy hooks check (see [Open decision](#open-decision)) |
| `project_map.py` | Task metadata and placement: `init`, `seed`, `settings`, `line_id`, `normalize`, `default_color`, `fallback_title`, `Metadata`, `task_projects`, `owners`, `allocate` (`project-map.ts`). 2a: `palette`, `palette_rgb`, `render_config` (`project-map.ts`); `geometry`, `triangle_geometry`, `validated_connector_geometry`, `connector_layout` (`geometry.ts`) | 3: `record_event`, palette writes (`validate_palette`, `save_palette`), `rendering_snapshot`, map patches, `locate_state` | |
| `bridge.py` | `dashboard` (`line-projection.ts`). 2a: the palette and timing constants, `pulse_amplitude`, `travel_delays`, `pixel_color`, `comet_color`, `zone_color`, `effect_payload`, `render`, `indicator_brightness` (`renderer.ts`) | 3: `introduction_ends`, `transition`, `handle_event`, `reconcile_read_state`, `unread_reader`, `SceneRestorer`, comets, `update_display`, previews, `run_worker` | `setup`, `main` (installer and CLI) |
| `configuration.py` | `registered_devices` (`configuration.ts`). 2a: `pair_lines`, `load_config`, `follow_registry` (`configuration.ts`) | | `data_dir` (installation path) |
| `enrollment.py` | `enroll`, `change_address`, `remove`, `check` and their checks (`enrollment.ts`); `private_address` (`transport.ts`). 2b: `pair` (`enrollment.ts`) | | `read_token`, `reason`, `command` (CLI, #844) |
| `transport.py` | 2a: the request shape callers inject, `LightRequest`. 2b: `light_request` (`lightRequest` over `nodeTransport`, `transport.ts`) | | |
| `effects.py` | 2a: `display`, the frame encoder. 2b: validation, presets, the patterns and `render` (`effects.ts`) | | |
| `modes.py`, `edits.py` | | 3 | |
| `controller_state.py` | | 3: the execution half that `run_worker` and `change_mode` call: `Execution`, `Cancelled`, `controls`, `control_payload`, `overrides`, `hold`, `held`, `release`, `discovered`, `scenes`, `scene_id`, and the worker's recovery of interrupted attempts in `recover` | The ledger and HTTP half: tables, `init`, `drop`, `ledgers`, `present`, `read`, `save`, `snapshot`, `capabilities`, `event`, `finish`, `changed`, `credential`, the listener's expiry in `recover`, `readonly` and admission (runtime commands and replies) |
| `integration_api.py` | 2b: `favorites`, `resolve_animation`, `favorite_edit`, the favorite checks of `validate` (`validFavoriteEdit`) and the `animation_favorites` table (`favorites.ts`). These are domain rules and stay in the module; #844's command schema checks message shape and does not take them over | | The rest of the integration extension API (runtime commands, #844) |
| `controller_server.py`, `controller_contract.py` | | | The HTTP controller (runtime commands and replies) |
| `codex_hooks.py` | | | Codex hook registration, retired (owner decision, 2026-10-05) |
| `wall_server.py`, `wall.html`, `prism*.js`, `assets/` | | | The web server is replaced by the runtime; the wall pages, their view and assets move with #844 |
| `launcher.py` | | | Process launch (runtime module host) |
| `diagnostics.py` | | | Runtime observability |
| `install_*.py`, `runtime_*.py` | | | Install and packaging (the extended installer, #840) |
| `vendor/`, `mcp/`, `contracts/`, `scripts/` | | | Vendored package copies, the Node MCP host, the integration contract, and repository tooling |

### Python test files

Translated tests keep the Python class as the suite name and the method as the test name.
"Partly" means the translated test drops assertions about a later slice or an unported layer;
each such test says so in a comment, and [Dropped assertions](#dropped-assertions) lists them.

| Python test file | Cases | Translated | Rest |
| --- | --- | --- | --- |
| `test_shared_input.py` | 74 | 59 (`shared-input.test.ts`): 58 in slice 1, and `test_stale_peer_does_not_suppress_healthy_outward_wave` in 2a. Partly: `test_generation_validation_preserves_closed_contract`, `test_atomic_cutover_identity_and_legacy_suppression`, `test_failed_preflight_and_comet_reservation_preserve_legacy`, `test_eviction_http_requires_origin_token_and_current_task`, `test_skipped_sessions_take_no_part_in_grouping_or_acknowledgment`, `test_declared_subagent_of_an_undeclared_parent_follows_the_missing_parent_rule`, `test_damaged_backup_refuses_rollback_without_partial_restore`. `test_released_owner_clears_only_nanoleaf_on_evidenced_new_turn` uses the recorded owner snapshot | Slice 3: `test_rollback_completion_can_be_read_and_release_its_line`, `test_worker_polls_and_refreshes_metadata_in_free_without_legacy_unread_reads`. Not ported: `test_released_fixture_corpus`, `test_released_title_fixture_corpus_and_credentials` and four `TransportTest` cases (feed transport and schema check), the two legacy hooks checks, `test_inspection_missing_state_does_not_create_files`, `CommandTest` (2, CLI and owner acknowledgment), `test_pinned_archive_and_extracted_files` (vendored copy), `StartupTest` (wall server start) |
| `test_shared_metadata.py` | 10 | 10 translated (`shared-metadata.test.ts`). Partly: `test_shared_title_and_project_precede_local_metadata`, `test_poll_refreshes_same_revision_without_lifecycle_or_effect_changes` | |
| `test_enrollment.py` | 44 | 32 (`enrollment.test.ts`): 30 in slice 1, `test_saved_geometry_loads_while_the_device_is_unreachable` in 2a and `test_pair_posts_to_the_new_endpoint_without_a_proxy` in 2b. Partly: `test_files_are_owner_only_and_output_never_contains_the_credential`, `test_conflicts_are_refused_before_pairing_or_prompting`, `test_enrolled_device_stays_dark_until_activated`, `test_machine_credentials_are_unchanged`, `test_malformed_layout_is_refused_before_removal_writes`, `test_failure_after_the_registry_write_asks_for_a_rerun` | Slice 3: `test_activation_replays_no_comet_or_wave`. Not ported (CLI, prompt, installer): `test_http_failure_reports_only_the_status`, `test_hidden_prompt_supplies_the_credential`, `test_pairing_obtains_the_credential_from_the_device`, `test_installer_reads_its_token_file_through_the_shared_reader`, `test_output_names_activation_and_needs_no_restart`, `test_busy_state_is_reported_without_a_traceback`, `test_command_reports_removal`, both `AddressTest.test_command_*`, `DispatchTest` (2) |
| `test_devices.py` | 15 | 10 (`devices.test.ts`): 7 in slice 1, and `test_legacy_layout_loads_as_default_device_without_request`, `test_version_two_layout_with_lines_and_triangles`, `test_registry_address_change_keeps_identity_and_preferences` in 2a. Partly: `test_pre_change_linux_database_migrates_and_repeats_without_change`, `test_registry_address_change_keeps_identity_and_preferences` | Slice 3: `test_equal_element_ids_on_two_devices_do_not_collide`, `test_literally_equal_element_ids_on_two_devices_keep_separate_state`, `test_modes_and_scene_files_are_independent_per_device`, `test_untargeted_callers_address_default_device`. Not ported: `test_installer_writes_per_device_layout_and_registry` |
| `test_bridge.py` | 45 | 13: in slice 1, 3 (`devices.test.ts`): `test_failed_initialization_closes_connection` (counts open file handles instead of patched connections), `test_failed_initialization_rolls_back_partial_schema`, `test_migration_keeps_task_assignments_and_removes_old_notifications`; in 2a, the 10 rendering and pairing cases (`renderer.test.ts`, `configuration.test.ts`) | The other 32 are listed by slice in [test_bridge.py](#test_bridgepy) |
| `test_panels.py` | 15 | 15: in slice 1, `GeometryTest` (5) and, partly, `test_six_triangle_reservation_and_shared_overflow` (`devices.test.ts`); in 2a, `DiscoveryTest` (2, `configuration.test.ts`), `PayloadTest` (6) and, partly, `test_render_config_gives_triangles_no_signature` (`renderer.test.ts`) | |
| `test_project_map.py` | 27 | 12, each partly, with map edits saved as their rows: in slice 1, the 8 placement and metadata cases (`project-map.test.ts`); in 2a, `test_split_base_status_half_and_swap`, `test_whole_wave_and_comet_restore_project_color`, `test_idle_reserved_signature_and_quiet`, `test_status_coverage_keeps_unknown_project_half_blue` (`renderer.test.ts`) | Slice 3: `test_active_comet_defers_mapping_and_style`, `test_color_changes_do_not_restart_task`, `test_turn_elapsed_not_status_elapsed`, `test_locate_waits_for_comet_and_free_rejects`, `test_api_validation_and_no_credentials`, `test_partial_effect_acceptance_keeps_prior_receipt_and_reports_failure`, `test_pending_half_edit_preserves_pending_owner`, `test_preferences_persist_after_reopen`, `test_idle_locate_returns_scene_after_one_second`, `test_project_early_read_comet_finishes_before_scene_restore`, `test_color_edit_invalidates_display_without_pulse_or_comet_replay`, `test_rendering_endpoint_reports_pending_failed_free_and_unknown`. Not ported (wall server): `test_rendering_endpoint_is_readonly_and_restart_safe`, `test_http_origin_host_and_token_checks`, `test_map_retries_missing_geometry` |
| `test_controller_controls.py` | 20 | | Slice 3: `test_scene_rejected_in_work_and_quiet_before_any_write`, `test_power_and_brightness_in_free_are_one_write_each_without_polling`, `test_scene_that_disappears_before_send_fails_typed_without_a_write`, `test_brightness_executes_once_through_worker_and_governs_work_indicators`, `test_uncertain_control_write_is_held_until_explicit_choice`, `test_mode_command_cancels_queued_control_as_stale_generation`, `test_quiet_idle_override_persists_until_same_mode_quiet_reapplies_ten_percent`, `test_work_idle_override_is_restored_by_same_mode_work_without_reselecting`, `test_power_off_suppresses_indicator_writes_and_keeps_tracking`, `test_scene_activates_in_free_with_one_write_and_no_polling`, `test_free_handoff_clears_override_and_stops_polling`, `test_free_brightness_is_an_external_change_that_becomes_the_preference`, `test_discovery_is_bounded_named_only_in_extension_and_quiet_between_changes` (discovery; its extension and feed checks are not ported), `test_control_admitted_during_observation_is_not_undone_by_that_iteration`, `test_control_admitted_after_observation_is_seen_by_the_same_pass_guards`, `test_control_committed_between_journaled_sends_is_applied_before_idle_exit`. Not ported (ledger snapshot and admission): `test_capabilities_declare_power_brightness_and_scenes_with_constraints`, `test_admission_replays_power_and_reports_desired_state_before_send`, `test_ledger_without_scene_key_publishes_new_ids_with_an_event`, `test_scene_ids_are_not_recoverable_from_published_snapshot_fields` |
| `test_controller_worker.py` | 10 | | Slice 3: `test_machine_quiet_records_actual_transmission`, `test_same_free_noop_never_sends`, `test_uncertain_transport_is_not_retried_by_worker`, `test_worker_restart_marks_attempt_uncertain`, `test_cli_worker_automatic_retry_keeps_hold_and_explicit_same_mode_retries`, `test_partial_failure_retains_completed_operations`, `test_expiry_during_unread_cannot_fall_back_to_legacy_send`. Not ported (machine credentials and the listener disable): `test_revoked_unsent_mode_cannot_run_as_legacy_work`, `test_revocation_during_observe_cannot_fall_back_to_legacy_send`, `test_disable_during_observe_cannot_fall_back_to_legacy_send` |
| `test_panels_controller.py` | 28 | | Slice 3 (`WorkerOwnershipTest`): `test_a_command_runs_only_on_its_own_devices_worker`, `test_commands_admitted_mid_pass_stay_with_their_own_device`, `test_panels_override_governs_only_the_panels`, `test_panels_mode_command_is_journaled_by_the_panels_worker`, `test_uncertain_panels_mode_write_holds_only_the_panels`, `test_panels_hold_leaves_the_lines_running`, `test_lines_hold_leaves_panels_commands_running`, `test_each_worker_discovers_only_its_own_scenes`, `test_panels_scene_follows_the_panels_mode`, `test_panels_instance_still_owns_no_shared_ingestion`; and `LedgerTest.test_local_mode_change_cancels_only_that_devices_controls`. Not ported: `test_revoke_or_disable_that_missed_the_panels_ledger_ends_its_request` (credentials), the other eleven `LedgerTest` cases, `IntegrationTest` (3), `HttpTest` (1) and `CompatibilityTest` (1) (the ledger, integration API and HTTP routes) |
| `test_wall_devices.py` | 9 | | Slice 3: `test_actions_address_the_named_device`, `test_mode_changes_address_the_named_device_and_leave_the_other_scene_alone`, `test_one_zone_elements_reject_coverage_and_half_swaps`, `test_eviction_is_routed_to_the_named_device` (edits and modes). Not ported (the wall server and its view, #844): `test_untargeted_state_addresses_lines_and_lists_registered_devices`, `test_targeted_panels_state_uses_cached_triangle_geometry`, `test_registered_device_without_saved_layout_reports_an_error_without_contact`, `test_unknown_device_is_rejected_without_fallback_or_change`, `test_http_state_query_rejections_and_privacy` |
| `test_integration_api.py` | 15 | | Slice 3 (edits): `test_actual_worker_applies_configuration`, `test_all_operations_preserve_unrelated_state_and_scene`, `test_concurrent_wall_edit_wins_without_overwrite`, `test_shared_mapping_source_and_notices_survive_edits`. Not ported (integration admission, snapshot, receipts and HTTP): the other 11 |
| `test_controller_animations.py` | 19 | | Slice 3: `WorkerTest` (10), except their revocation and disable checks. Not ported: `AdmissionTest` (8) and `HTTPTest` (1); preset resolution is covered by `test_effects.py` in slice 2b |
| `test_palette.py` | 16 | 8 in 2a (`renderer.test.ts`): `test_work_default_palette` and `test_damaged_rows_fall_back_to_defaults`; partly, with their palette and map settings saved as rows, the other five `PaletteFrameTest` cases and `test_upgrade_keeps_preferences_and_adopts_defaults` | Slice 3 (palette writes and the worker): `test_defaults_partial_update_reset_and_restart`, `test_invalid_palette_requests_apply_nothing`, `PaletteWorkerTest` (4). Not ported: `test_palette_write_requires_origin_and_token` (wall server), `test_integration_settings_api_offers_no_palette` (integration API) |
| `test_connector_geometry.py` | 13 | 3 in 2a (`geometry.test.ts`): `test_actual_layout_preserves_identity_and_reported_housings`, `test_graph_is_allowlisted_and_rejects_invalid_geometry`, `test_synthetic_topologies_and_orientation_preserve_zone_ownership` | Not ported: the other 10 test the wall server's geometry enrichment, its connector cache file and its state (#844) |
| `test_comets.py` | 16 | 2 in 2a (`renderer.test.ts`): `test_geometry_head_tail_duration_and_zone_pairs`, `test_protect_red_yellow_lines_and_outward_waves` | Slice 3: the other 14 |
| `test_modes.py` | 15 | 1 in 2a (`renderer.test.ts`): `test_quiet_frames_are_steady_paired_colors` | Slice 3: the other 14 |
| `test_effects.py` | 18 | 18: 1 in 2a, `EncoderTest.test_display_encodes_zone_frames`, with the display encoder; 17 in 2b. All in `effects.test.ts`. Partly: `test_presets_resolve_to_identical_bounded_explicit_frames` | |
| `test_animation_favorites.py` | 7 | 4 in 2b (`favorites.test.ts`), each partly: `test_save_freezes_recipe_survives_reopen_and_replays`, `test_collision_atomic_rename_delete_bound_and_name_identity`, `test_preset_defaults_are_frozen_without_snapshot_or_display_mutation`, `test_malformed_names_recipes_mixed_selectors_and_bounds_are_rejected` | Not ported: `test_stale_authority_replay_cancel_expiry_and_hold`, `test_worker_applies_save_without_light_write_and_rejects_changed_revision`, `test_revocation_and_wrong_target_never_save_or_play` (integration admission, processing and credentials) |
| `test_device_worker.py` | 40 | 3 in 2a (`configuration.test.ts`): `AddressChangeTest.test_unreadable_configuration_keeps_the_current_transport`, `MirroredTest.test_layout_save_keeps_the_other_devices_entry` and, partly, `UntargetedOrderTest.test_untargeted_calls_address_lines_whatever_the_registry_order` | Slice 3 by area; its CLI, installer and controller API checks are not ported |
| `test_scene_restore.py`, `test_edit_parity.py` | | | Slice 3 by area. Their HTTP, integration and wall server checks are not ported |
| `test_controller_state.py`, `test_controller_api.py`, `test_controller_cli.py`, `test_controller_contracts.py`, `test_integration_geometry.py`, `test_codex_links.py`, `test_prism_assets.py` | | | Not ported: the controller ledger, HTTP controller, integration API and wall server. Wall view and link behavior moves with #844 |
| `test_hook_management.py` | | | Not ported: hook registration is retired |
| `test_linux_runtime.py`, `test_runtime_install.py`, `test_runtime_adapter.py`, `test_cli_compatibility.py`, `test_observability.py`, `test_measure_shared.py`, `test_verify_vendor.py`, `test_module_dependencies.py` | | | Not ported: install, packaging, CLI, diagnostics, tooling and vendored copies. The module boundary lint replaces the import-direction checks |
| `test_demo_fixture.py`, `test_demo_runs.py`, `verify_*.mjs` | | | Not ported: #844 replaces the demo and verification adapter with simulated transport and scenarios |
| `*_checks.cjs`, `wall_options.cjs` | | | Wall page browser checks move with the pages (#844); `workflow_checks.cjs` is the old repository's |

The port adds tests of its own:

- `consumer envelope check` (the generation rule and revision floor) and `transaction helpers`, in
  `shared-input.test.ts`;
- `registry lock` (in-process turns), in `enrollment.test.ts`;
- the recorded values in `compat.test.ts` and the replay in `trace.test.ts`;
- the recorded comparisons `geometry recorded from Python` (`geometry.test.ts`), `frames recorded
  from Python` and `colors recorded from Python` (`renderer.test.ts`), `Lines replies parsed as
  Python parsed them` and `discovery recorded from Python` (`configuration.test.ts`), and `effects
  recorded from Python` (`effects.test.ts`);
- `effect checks the port adds` and `test decoder checks the port adds` (`effects.test.ts`; the
  test decoder reads `animData` as Python's `int()` did), and `favorite checks the port adds`
  (`favorites.test.ts`);
- `lightRequest` and `nodeTransport` (`transport.test.ts`). The `nodeTransport` tests use stub HTTP
  servers that bind 127.0.0.1 on ephemeral ports, and one child Node process; each test closes its
  servers and stops the child when it ends. They check that a device that never answers fails
  within the timeout, and that a proxy set for Node is never used.

### Dropped assertions

The assertions that partly translated tests leave out, by where they go. Slice 2a restored every
assertion slice 1 left to slice 2, and `test_one_task_one_placement_per_device_and_unique_slot_per_device`
now loads both devices through `loadConfig` as Python did.

Slice 3 (worker, legacy input, edits and scenes):

- `test_atomic_cutover_identity_and_legacy_suppression`: a legacy hook event while shared input is
  selected changes nothing.
- `test_enrolled_device_stays_dark_until_activated`: a Panels worker pass after enrollment sends
  nothing to any device.
- `test_pre_change_linux_database_migrates_and_repeats_without_change`: the migrated comet starts
  as recorded, the pending edit on its source Line survives, the comet defers Locate, and the
  saved scene loads.
- `test_six_triangle_reservation_and_shared_overflow`: the reservation edit is applied at once,
  not deferred.
- The twelve `test_project_map.py` cases, the six partly translated `test_palette.py` cases,
  `test_render_config_gives_triangles_no_signature` and
  `test_registry_address_change_keeps_identity_and_preferences`: the map edits' and palette
  settings' own validation, deferral and application. The tests save each edit's rows directly.
- `test_untargeted_calls_address_lines_whatever_the_registry_order`: an untargeted mode command
  through the command line sets the Lines to Quiet and leaves the Panels in Work.

Not ported (the layer that held them is replaced):

- `test_generation_validation_preserves_closed_contract`: the range, private-field and future
  version cases of the released schema validator.
- `test_atomic_cutover_identity_and_legacy_suppression`,
  `test_shared_title_and_project_precede_local_metadata`: the inspection view's privacy and
  fields.
- `test_failed_preflight_and_comet_reservation_preserve_legacy`: a failed preflight fetch.
- `test_eviction_http_requires_origin_token_and_current_task`: the wall server's origin, token
  and device checks.
- `test_skipped_sessions_take_no_part_in_grouping_or_acknowledgment`: acknowledging a skipped
  session's notice is refused without a request. Acknowledgment moves with #844, which keeps
  this refusal.
- `test_declared_subagent_of_an_undeclared_parent_follows_the_missing_parent_rule`: the schema
  validator's refusal of cross-source parentage.
- `test_damaged_backup_refuses_rollback_without_partial_restore`,
  `test_conflicts_are_refused_before_pairing_or_prompting`,
  `test_malformed_layout_is_refused_before_removal_writes`,
  `test_failure_after_the_registry_write_asks_for_a_rerun`: the command line's output and
  ordering.
- `test_poll_refreshes_same_revision_without_lifecycle_or_effect_changes`: the poller itself; its
  two ticks are direct acceptances.
- `test_files_are_owner_only_and_output_never_contains_the_credential`: command output and the
  wall view never show the credential. The wall view moves with #844, which keeps this rule.
- `test_machine_credentials_are_unchanged`, `test_pre_change_linux_database_migrates_and_repeats_without_change`:
  the controller credential table.
- `test_upgrade_keeps_preferences_and_adopts_defaults`: the wall view, which moves with #844. Its
  palette and mode are read from the saved state instead, and its check that opening the view
  leaves the scene file unchanged is not translated.
- `test_presets_resolve_to_identical_bounded_explicit_frames`: the MCP host's advertised preset list.
  The runtime module will advertise `PRESETS` itself (#844).
- The four `test_animation_favorites.py` cases: the integration API's admission, HTTP statuses,
  request IDs, receipts and controller snapshot, and its Free-only rule for playing (runtime
  commands, #844), and the worker's play (slice 3). The tests run each edit as admission and the
  worker did: checked, then checked again and applied in its own transaction. Refusals are checked
  by their failure codes. Python patched the byte bound to 100; the port checks it on a wall too
  large for the recipe.

### test_bridge.py

Translated in slice 2a (rendering and Line pairing): `test_render_returns_the_successfully_accepted_output_and_timing`,
`test_render_returns_completion_comet_receipt`, `test_radiation_spreads_by_distance_from_task_in_both_directions`,
`test_both_zones_match_and_animation_has_two_second_period`, `test_fifteen_physical_lines_are_paired_from_real_layout`,
`test_red_radiation_has_priority_when_different_colors_overlap`, `test_unread_completion_pulses_locally_without_legacy_wave`,
`test_assigned_lines_keep_their_status_hue_at_every_pulse_brightness`, `test_concurrent_local_statuses_keep_independent_hues`,
`test_source_keeps_status_color_during_outward_and_following_local_pulses`.

Slice 3 (worker, hook events, display receipts and read state): `test_update_display_keeps_only_the_last_fully_successful_receipt`,
`test_update_display_persists_the_accepted_completion_comet`, `test_first_working_pulse_radiates_then_only_local_loop`,
`test_each_color_gets_one_radiating_pulse`, `test_tool_progress_does_not_restart_flashes_or_send_more_effects`,
`test_finished_and_interrupted_tasks_return_to_blue_not_off`, `test_async_question_is_yellow_while_other_work_continues`,
`test_unanswered_question_becomes_red_when_response_stops`, `test_blocking_input_is_red_until_its_own_result_returns`,
`test_permission_block_has_priority_over_nonblocking_question`, `test_duplicate_and_stale_events_cannot_restart_finished_task`,
`test_state_change_interrupts_animation_without_resetting_other_task_epoch`, `test_other_task_start_does_not_restore_old_radiation`,
`test_task_slots_are_stable_and_completed_slots_can_be_reused`, `test_concurrent_tasks_never_share_a_slot`,
`test_failed_send_keeps_status_for_retry_on_next_event`, `test_worker_recovers_if_finite_animation_was_interrupted_by_failure`,
`test_only_one_worker_and_state_updates_remain_available`, `test_session_end_clears_activity_and_waits`,
`test_no_prompt_or_question_content_is_stored`, `test_unknown_events_are_ignored`,
`test_unread_completion_pulses_until_desktop_flag_clears`, `test_unread_flag_can_arrive_after_stop_without_losing_notification`,
`test_unavailable_read_state_does_not_acknowledge_completion`, `test_missing_completion_receipt_recovers_without_replaying_or_skipping_settle`,
`test_runtime_closing_does_not_clear_unread_completion`, `test_read_indicator_is_read_only_and_malformed_state_is_not_seen`,
`test_current_read_indicator_refreshes_and_overrides_legacy`, `test_current_read_evidence_releases_occupied_lines`,
`test_invalid_current_read_marker_never_uses_old_empty_indicator`, `test_invalid_legacy_read_ids_are_unavailable`.

Not ported: `test_merge_preserves_other_hooks_and_uninstall` (hook registration).

## Port input

The port still takes the 1.x monitor envelope: an owner snapshot with revisions, `lossCount` and
`admissionRejected`. It resyncs on a revision gap or a change in either count, keeps a stored copy
of the core's session state in `shared_input.envelope`, and `validateConfig` still requires the
feed's `endpoint` and `tokenFile`. #844 replaces this input with the SDK's sync, and the module
then saves only the state it owns.

Two feed duties have other owners:

- Notice acknowledgment: #844, which sends it to the core as a command.
- The snapshot schema check, including the rejection of cross-source parentage: #842's core
  payload families, validated before the module sees them.

## Recorded comparisons

Where the translated tests leave behavior open, the port is compared with Python on recorded inputs.
`record.py` is the Python oracle: it runs the Python bridge read-only, CI does not run it, and it
retires with codex-nanoleaf (#839). It writes:

- `values.json`: identity keys, eviction tokens, default project colors, fallback titles, path
  normalization, float text, rounding, float remainders, JSON text and private-address checks
  (`compat.test.ts`).
- `numbers.json`, one case per line: `math.hypot` and `sum()` on random floats (`compat.test.ts`).
- `setups.json`: the state the Python tests' setUp methods saved. Legacy hook events and mode
  commands belong to later slices, so the translated tests load this state instead. Two small test
  helpers that stand in for them are checked against it.
- `owner-snapshot.json`: the released agent-state 3.3.0 owner's snapshot for `ReleaseTest`.
- `trace.json`, one step per line: three random sequences and two scripted ones (comets; Line
  placement) through source switches, owner revisions, feed loss, placement, evictions, comets,
  modes, reservations and Codex metadata.
- `rendering.json`, one member per line to a fixed depth:
  - Line pairing of the real Lines layout in six orientations, and of two zones moved just inside,
    onto and just beyond the 3-unit collinearity threshold in eight orientations (`geometry.test.ts`);
  - Line segments, connector caches and graphs, and NL22 triangle polygons in several
    orientations (`geometry.test.ts`);
  - `load_config`'s discovery of an unsaved Lines layout (`configuration.test.ts`);
  - `pair_lines` and `load_config` on replies with a duplicate zone, a connector sharing a zone's
    panel ID, an entry without `shapeType` or `panelId`, an entry that is not an object, and
    entries without `o` (`configuration.test.ts`). Each outcome is a result or the exception class
    and message;
  - `palette_rgb` on well-formed and malformed color text (`renderer.test.ts`);
  - 90 random renderer states on five layouts (`renderer.test.ts`). Each state has 30 zone colors
    sampled across its pulse and the SHA-256 of its effect payload's JSON text.
  - every effect pattern, color set, speed, direction and loop choice on the same five layouts
    (`effects.test.ts`): a short hash of each payload's JSON text and a SHA-256 over all of them.

  Zone colors, payloads, effects and pairing compare exactly. A map geometry number may differ by 1e-12
  times its magnitude, or by 1e-12 below magnitude 1, for the reason in
  [Known differences](#known-differences). The largest recorded difference is 1.4e-14, and 58 of the
  3,432 recorded geometry numbers differ at all.

`trace.test.ts` replays every step. It compares each result and these saved rows, in rowid order:
`sessions`, `activity`, `task_info`, `slots`, `comets`, `waits`, `receipts`, `shared_stale`,
`shared_suppressed_waves`, `shared_evictions`, `projects`, `line_prefs`, `map_settings`, `meta`
and `display_v3`. From `shared_input` it compares `source`, `generation`, `received`,
`connection`, `error` and `backup`, and the envelope by hash. The `palette`, `map_pending`,
`locate` and `shared_ack` tables and `shared_input.config` are not compared.

To re-record, run from the repository root with a codex-nanoleaf checkout at the provenance commit:

```bash
PYTHONDONTWRITEBYTECODE=1 fnm exec --using=.nvmrc -- python3 modules/nanoleaf/tests/fixtures/record.py <codex-nanoleaf>
```

## Known differences

- Of `shared_input.check_envelope`, the port keeps two consumer rules: every session needs an
  integer `generation`, which Python's `validate_snapshot` required of 1.1 and 1.2 snapshots, and
  an older revision never replaces a newer one. Both fail with `invalid-feed` and change nothing.
  It drops the envelope's own checks (its `apiVersion`, an `ownerId` matching the configuration,
  `connection` being `current`, and the `admissionRejected` and `nextRequestId` bounds), the
  snapshot's `apiVersion` check and the released schema validator.
- A saved envelope from an earlier bridge may lack a session's `generation`; it reads as 0, as
  Python's `.get('generation', 0)` did.
- Without the HTTP controller, enrollment no longer drops or checks a device's controller ledger.
- Enrollment is asynchronous because device reads are. Registry operations in one process take
  turns, and the registry lock is retried every 0.1 seconds for up to five seconds instead of
  waiting inside SQLite, so a held lock never blocks the event loop. The status database (2.5
  seconds) and the layout lock (5 seconds) still wait inside SQLite, but only within synchronous
  steps, so only another process can make them wait.
- `acceptEnvelope` and `selectSource` refresh Codex metadata inside the caller's transaction;
  Python read the files before opening it.
- `execute()` binds every JavaScript number as a SQLite REAL. A column with integer affinity stores
  a whole number as an integer, but a TEXT column stores `5` as `'5.0'` where Python stored `'5'`.
  Slice 1 writes `meta` values as text; slices 2 and 3 must do the same.
- JSON numbers carry no int or float type. Whole numbers are written without `.0` in saved JSON,
  and a whole float such as `5.0` passes checks that Python's `type(x) is int` refused. Saved
  `meta` float text keeps Python's form.
- JavaScript lists integer-like object keys first, so a device or project ID such as `2` would
  change position in a rewritten JSON file. The IDs in use are not integer-like.
- Saved JSON is the module's own, so the duplicate-key check that guarded feed and configuration
  input is not ported.
- A non-string device `kind` is a `ValueError` here; Python raised `TypeError`.
- `pySum` and `pyHypot` reproduce Python's `sum()` (compensated since 3.12) and `math.hypot` to the
  last bit. Without them, a plain loop differs in the last bit for about half of random float lists,
  and `Math.hypot` for about a third of random inputs. No recorded output distinguishes them from
  those plain versions. They stay while exact parity with Python is the acceptance bar, and can be
  replaced once Python retires (#839).
- `Math.sin`, `Math.cos` and `Math.atan2` are V8's functions, not the C library's that Python calls.
  On random inputs they differ in the last bit for about 3% (sine, cosine) and 18% (arc tangent), so
  rotated map geometry can differ by an ulp. The recorded zone colors, payloads, effects and
  pairing still match exactly.
- As in Python, pairing reads the reported entries in order, duplicates and connectors included,
  and Line positions take the last entry with each panel ID and read only `x` and `y`. A device
  reply without `panelLayout`, a reported entry that is not an object or lacks a field Python read
  (`shapeType`; `panelId`, `x`, `y` and `o` of a zone being paired; `panelId`, `x` and `y` for
  positions), and a non-numeric coordinate are `ValueError`s; Python raised `KeyError` or
  `TypeError`. A registered device without an address or credential reaches the request as an
  empty string, where Python passed `None`.
- A color must be `#` and six hexadecimal digits, or it is a `ValueError`. Python's
  `int(text, 16)` on each pair of characters also refused `#1g2233` and `#abc`, but accepted a
  short last channel (`#12345`), a sign or space (`#+1aabb`), extra characters (`#aabbccdd`) and a
  first character other than `#`. Saved colors are always written as `#` and six digits.
- `nodeTransport`'s timeout bounds the whole exchange. Python's urllib timeout (1.2 seconds for light
  requests, 5 for pairing) applied to each socket operation, so a reply that trickled in could take
  longer there. Replies outside 2xx are an `HttpError` with the status, and redirects are not
  followed; urllib followed them.
- Device requests use their own connection (`agent: false`), so a proxy that Node 24 takes from the
  environment under `NODE_USE_ENV_PROXY` is never used, as Python's `ProxyHandler({})` ignored
  configured proxies.
- The light credential must be ASCII letters and digits. Python's `isalnum()` also accepted letters
  and digits of other scripts, which then failed when the URL was encoded.
- `pair` refuses a reply that is not a JSON object with a `ValueError`; Python raised
  `AttributeError`.
- A favorite edit no longer bumps the controller ledger's revision, because the ledger is not
  ported. A damaged saved recipe that is not an object, or that names a `kind`, is refused as
  `unsupported-capability`; Python raised `TypeError`.
- `PRESETS`, `DEFAULTS` and the bounds are frozen constants; the Python tests patched them.

## Known limits

- The tests read task rows through `wallView`, a test helper that mirrors
  `wall_server.App.state`. No Python recording checks that helper; #844 ports the real view.

## Open decision

Hook registration is retired, but #844 keeps "explicit shared or legacy input selection". Slice 3
ports the legacy hook reducer with the worker. Python refused to select legacy input while the
Codex hooks were missing; that guard went with hook registration, so `selectSource({source:
'legacy'})` now always succeeds. Whether any legacy input reaches the runtime, and so whether the
legacy source, its backup, this switch and the reducer stay, needs an owner decision before
slice 3.
