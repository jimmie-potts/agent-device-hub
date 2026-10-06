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
  - `tests/fixtures/linux-state-v4/status.sql`, `layout-fixture.json`, `config-fixture.json` and
    `scene-state-fixture.json` from `tests/fixtures/linux-state-v4/`.
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
3. Slice 3 is split by area:
   - 3a: removes the legacy input slice 1 ported (see [Shared input only](#shared-input-only)).
   - 3b: map edits, the pending wall edit, Locate, mode commands, starting and pruning comets, and
     the rendering receipt.
   - 3c: the display worker with scene restore: `run_worker`'s pass loop without controls, and
     `SceneRestorer`.
   - 3d: controls: the control execution half of `controller_state.py`, the worker's control
     queue, a minimal journal for holds and uncertain attempts, and animation play (the retirement
     of requested animations on a mode command, and the worker's play in Free).
   - 3e: the rest of `test_device_worker.py`, after 3c and 3d.

Slice 1 drafted the port before translating its tests, then ran the translations against it.
Slices 2 and 3 translate their tests first.

### Python modules

| Python module | Ported (slice 1 unless marked) | Later slice | Not ported (replacement) |
| --- | --- | --- | --- |
| `database.py` | `connect_state` (`database.ts`) | | `seed_synthetic`: demo and browser fixtures (#844 scenarios) |
| `devices.py` | All but `legacy_row` (`devices.ts`) | | `write_json` duplicates `jsonfile.write_json`; `legacy_row` (see [Shared input only](#shared-input-only)) |
| `store.py` | All (`store.ts`) | | |
| `jsonfile.py` | All (`jsonfile.ts`) | | |
| `panels.py` | `read_layout` (`panels.ts`) | | |
| `shared_input.py` | Snapshot projection, grouping, evictions and the consumer part of `check_envelope` (`shared-input.ts`). 2a: `render_config` (`sharedRenderConfig`) | | The rest of the feed: `validate_snapshot`, `private_read`, `request`, `fetch_snapshot` and the other `check_envelope` checks (see [Known differences](#known-differences)); `inspect` (runtime state, #844); the legacy task backup and `bindings` (see [Shared input only](#shared-input-only)) |
| `shared_source.py` | `configure`, `source_config`, `select_source` for shared input (`selectShared`), `accept`, `failed` as transaction bodies (`shared-source.ts`) | | Preflight fetch, `Poller`, `acknowledge` (core session events and commands, #844); `metadata_reader` and `command` (configuration wiring and CLI, #844); the legacy branch of `select_source` and its hooks check (see [Shared input only](#shared-input-only)) |
| `project_map.py` | Task metadata and placement: `init`, `seed`, `settings`, `line_id`, `normalize`, `default_color`, `fallback_title`, `Metadata`, `task_projects`, `owners`, `allocate` (`project-map.ts`). 2a: `palette`, `palette_rgb`, `render_config` (`project-map.ts`); `geometry`, `triangle_geometry`, `validated_connector_geometry`, `connector_layout` (`geometry.ts`) | 3b: `validate_palette`, `save_palette`, `rendering_snapshot`, `pending`, `apply_patch`, `request_patch`, `apply_pending`, `locate_state` (`project-map.ts`) | `record_event` (see [Shared input only](#shared-input-only)) |
| `bridge.py` | `dashboard` (`line-projection.ts`). 2a: the palette and timing constants, `pulse_amplitude`, `travel_delays`, `pixel_color`, `comet_color`, `zone_color`, `effect_payload`, `render`, `indicator_brightness` (`renderer.ts`). 3b: `prune_comets`, `current_comet` (`comets.ts`). 3c: `introduction_ends`, `update_display`, `record_failure`, `play_preview`, `run_worker` (`worker.ts`, without controls); `SceneRestorer` (`scenes.ts`) | 3d: `run_worker`'s controls, holds and animation play. 3e: the `worker` command's retry loop | `setup`, `main` (installer and CLI); `run_worker`'s feed poll, metadata refresh and legacy unread reads (shared input only, and the runtime); `transition`, `handle_event`, `unread_reader`, `reconcile_read_state` (see [Shared input only](#shared-input-only)) |
| `configuration.py` | `registered_devices` (`configuration.ts`). 2a: `pair_lines`, `load_config`, `follow_registry` (`configuration.ts`) | | `data_dir` (installation path) |
| `enrollment.py` | `enroll`, `change_address`, `remove`, `check` and their checks (`enrollment.ts`); `private_address` (`transport.ts`). 2b: `pair` (`enrollment.ts`) | | `read_token`, `reason`, `command` (CLI, #844) |
| `transport.py` | 2a: the request shape callers inject, `LightRequest`. 2b: `light_request` (`lightRequest` over `nodeTransport`, `transport.ts`) | | |
| `effects.py` | 2a: `display`, the frame encoder. 2b: validation, presets, the patterns and `render` (`effects.ts`) | | |
| `modes.py` | 3b: `change_mode`, `set_mode` without its worker launch (`setMode`), `get_status` (`modeStatus`) (`modes.ts`) | | The controller ledger notice (`controller_state.changed`); the retirement of requested animations (`integration_api.retire`) moves with animation play (3d) |
| `edits.py` | 3b: all (`edits.ts`, exported as the `edits` namespace) | | The controller ledger notices in `recorded` |
| `controller_state.py` | 3b: `overrides` (`store.ts`) | 3d: the execution half that `run_worker` calls: `Execution`, `Cancelled`, `controls`, `control_payload`, `hold`, `held`, `release`, `discovered`, `scenes`, `scene_id`, and the worker's recovery of interrupted attempts in `recover` | The ledger and HTTP half: tables, `init`, `drop`, `ledgers`, `present`, `read`, `save`, `snapshot`, `capabilities`, `event`, `finish`, `changed`, `credential`, the listener's expiry in `recover`, `readonly` and admission (runtime commands and replies) |
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
"Partly" means the translated test drops assertions about a later slice, an unported layer or
legacy input; each such test says so in a comment. [Dropped assertions](#dropped-assertions) and
[Partly translated for shared input only](#partly-translated-for-shared-input-only) list them.

| Python test file | Cases | Translated | Rest |
| --- | --- | --- | --- |
| `test_shared_input.py` | 74 | 52 (`shared-input.test.ts`, `worker.test.ts`): 50 in slice 1, `test_stale_peer_does_not_suppress_healthy_outward_wave` in 2a and, partly, `test_worker_polls_and_refreshes_metadata_in_free_without_legacy_unread_reads` in 3c. Partly: `test_generation_validation_preserves_closed_contract`, `test_eviction_http_requires_origin_token_and_current_task`, `test_skipped_sessions_take_no_part_in_grouping_or_acknowledgment`, `test_declared_subagent_of_an_undeclared_parent_follows_the_missing_parent_rule`, and the eight shared-input-only cases in [Shared input only](#shared-input-only). `test_released_owner_clears_only_nanoleaf_on_evidenced_new_turn` uses the recorded owner snapshot | Not ported: `test_released_fixture_corpus`, `test_released_title_fixture_corpus_and_credentials` and four `TransportTest` cases (feed transport and schema check), `test_inspection_missing_state_does_not_create_files`, `CommandTest` (2, CLI and owner acknowledgment), `test_pinned_archive_and_extracted_files` (vendored copy), `StartupTest` (wall server start), and the eleven legacy-input cases in [Shared input only](#shared-input-only) |
| `test_shared_metadata.py` | 10 | 9 (`shared-metadata.test.ts`). Partly: `test_shared_title_and_project_precede_local_metadata`, `test_poll_refreshes_same_revision_without_lifecycle_or_effect_changes`, and the five shared-input-only cases in [Shared input only](#shared-input-only) | Not ported: `test_source_switch_preserves_manual_preference` (shared input only) |
| `test_enrollment.py` | 44 | 33 (`enrollment.test.ts`): 30 in slice 1, `test_saved_geometry_loads_while_the_device_is_unreachable` in 2a, `test_pair_posts_to_the_new_endpoint_without_a_proxy` in 2b and `test_activation_replays_no_comet_or_wave` in 3c. Partly: `test_files_are_owner_only_and_output_never_contains_the_credential`, `test_conflicts_are_refused_before_pairing_or_prompting`, `test_enrolled_device_stays_dark_until_activated`, `test_machine_credentials_are_unchanged`, `test_malformed_layout_is_refused_before_removal_writes`, `test_failure_after_the_registry_write_asks_for_a_rerun` | Not ported (CLI, prompt, installer): `test_http_failure_reports_only_the_status`, `test_hidden_prompt_supplies_the_credential`, `test_pairing_obtains_the_credential_from_the_device`, `test_installer_reads_its_token_file_through_the_shared_reader`, `test_output_names_activation_and_needs_no_restart`, `test_busy_state_is_reported_without_a_traceback`, `test_command_reports_removal`, both `AddressTest.test_command_*`, `DispatchTest` (2) |
| `test_devices.py` | 15 | 10 (`devices.test.ts`): 3 in slice 1; `test_legacy_layout_loads_as_default_device_without_request`, `test_version_two_layout_with_lines_and_triangles`, `test_registry_address_change_keeps_identity_and_preferences` in 2a; `test_equal_element_ids_on_two_devices_do_not_collide`, `test_literally_equal_element_ids_on_two_devices_keep_separate_state`, `test_modes_and_scene_files_are_independent_per_device`, `test_untargeted_callers_address_default_device` in 3b. Partly: `test_pre_change_linux_database_migrates_and_repeats_without_change` | Not ported: `test_installer_writes_per_device_layout_and_registry`, and the four task backup cases in [Shared input only](#shared-input-only) |
| `test_bridge.py` | 45 | 25: in slice 1, 3 (`devices.test.ts`): `test_failed_initialization_closes_connection` (counts open file handles instead of patched connections), `test_failed_initialization_rolls_back_partial_schema`, `test_migration_keeps_task_assignments_and_removes_old_notifications`; in 2a, the 10 rendering and pairing cases (`renderer.test.ts`, `configuration.test.ts`); in 3c, the 12 worker cases (`worker.test.ts`) listed in [test_bridge.py](#test_bridgepy) | Not ported: the other 20, listed there |
| `test_panels.py` | 15 | 15: in slice 1, `GeometryTest` (5) and `test_six_triangle_reservation_and_shared_overflow` (`devices.test.ts`); in 2a, `DiscoveryTest` (2, `configuration.test.ts`), `PayloadTest` (6) and `test_render_config_gives_triangles_no_signature` (`renderer.test.ts`) | |
| `test_project_map.py` | 27 | 23: in slice 1, the 8 placement and metadata cases (`project-map.test.ts`); in 2a, `test_split_base_status_half_and_swap`, `test_whole_wave_and_comet_restore_project_color`, `test_idle_reserved_signature_and_quiet`, `test_status_coverage_keeps_unknown_project_half_blue` (`renderer.test.ts`); in 3b, `test_active_comet_defers_mapping_and_style`, `test_color_changes_do_not_restart_task`, `test_locate_waits_for_comet_and_free_rejects`, `test_api_validation_and_no_credentials`, `test_pending_half_edit_preserves_pending_owner`, `test_preferences_persist_after_reopen`, `test_rendering_endpoint_reports_pending_failed_free_and_unknown` (`project-map.test.ts`); in 3c, `test_partial_effect_acceptance_keeps_prior_receipt_and_reports_failure` (`project-map.test.ts`), `test_color_edit_invalidates_display_without_pulse_or_comet_replay`, `test_idle_locate_returns_scene_after_one_second`, `test_project_early_read_comet_finishes_before_scene_restore` (`scenes.test.ts`). Partly: `test_api_validation_and_no_credentials`, and the 3c cases marked in [Partly translated for shared input only](#partly-translated-for-shared-input-only) | Not ported: `test_turn_elapsed_not_status_elapsed` (shared input only), and `test_rendering_endpoint_is_readonly_and_restart_safe`, `test_http_origin_host_and_token_checks`, `test_map_retries_missing_geometry` (wall server) |
| `test_controller_controls.py` | 20 | | Slice 3d: `test_scene_rejected_in_work_and_quiet_before_any_write`, `test_power_and_brightness_in_free_are_one_write_each_without_polling`, `test_scene_that_disappears_before_send_fails_typed_without_a_write`, `test_brightness_executes_once_through_worker_and_governs_work_indicators`, `test_uncertain_control_write_is_held_until_explicit_choice`, `test_mode_command_cancels_queued_control_as_stale_generation`, `test_quiet_idle_override_persists_until_same_mode_quiet_reapplies_ten_percent`, `test_work_idle_override_is_restored_by_same_mode_work_without_reselecting`, `test_power_off_suppresses_indicator_writes_and_keeps_tracking`, `test_scene_activates_in_free_with_one_write_and_no_polling`, `test_free_handoff_clears_override_and_stops_polling`, `test_free_brightness_is_an_external_change_that_becomes_the_preference`, `test_discovery_is_bounded_named_only_in_extension_and_quiet_between_changes` (discovery; its extension and feed checks are not ported), `test_control_admitted_during_observation_is_not_undone_by_that_iteration`, `test_control_admitted_after_observation_is_seen_by_the_same_pass_guards`, `test_control_committed_between_journaled_sends_is_applied_before_idle_exit`. Not ported (ledger snapshot and admission): `test_capabilities_declare_power_brightness_and_scenes_with_constraints`, `test_admission_replays_power_and_reports_desired_state_before_send`, `test_ledger_without_scene_key_publishes_new_ids_with_an_event`, `test_scene_ids_are_not_recoverable_from_published_snapshot_fields` |
| `test_controller_worker.py` | 10 | | Slice 3d: `test_machine_quiet_records_actual_transmission`, `test_same_free_noop_never_sends`, `test_uncertain_transport_is_not_retried_by_worker`, `test_worker_restart_marks_attempt_uncertain`, `test_cli_worker_automatic_retry_keeps_hold_and_explicit_same_mode_retries`, `test_partial_failure_retains_completed_operations`, `test_expiry_during_unread_cannot_fall_back_to_legacy_send`. Not ported (machine credentials and the listener disable): `test_revoked_unsent_mode_cannot_run_as_legacy_work`, `test_revocation_during_observe_cannot_fall_back_to_legacy_send`, `test_disable_during_observe_cannot_fall_back_to_legacy_send` |
| `test_panels_controller.py` | 28 | | Slice 3d (`WorkerOwnershipTest`): `test_a_command_runs_only_on_its_own_devices_worker`, `test_commands_admitted_mid_pass_stay_with_their_own_device`, `test_panels_override_governs_only_the_panels`, `test_panels_mode_command_is_journaled_by_the_panels_worker`, `test_uncertain_panels_mode_write_holds_only_the_panels`, `test_panels_hold_leaves_the_lines_running`, `test_lines_hold_leaves_panels_commands_running`, `test_each_worker_discovers_only_its_own_scenes`, `test_panels_scene_follows_the_panels_mode`, `test_panels_instance_still_owns_no_shared_ingestion`; and `LedgerTest.test_local_mode_change_cancels_only_that_devices_controls`. Not ported: `test_revoke_or_disable_that_missed_the_panels_ledger_ends_its_request` (credentials), the other eleven `LedgerTest` cases, `IntegrationTest` (3), `HttpTest` (1) and `CompatibilityTest` (1) (the ledger, integration API and HTTP routes) |
| `test_wall_devices.py` | 9 | 4 in 3b (`edits.test.ts`): `test_actions_address_the_named_device`, `test_mode_changes_address_the_named_device_and_leave_the_other_scene_alone`, `test_one_zone_elements_reject_coverage_and_half_swaps`, `test_eviction_is_routed_to_the_named_device`. Partly: all but `test_one_zone_elements_reject_coverage_and_half_swaps` | Not ported (the wall server and its view, #844): `test_untargeted_state_addresses_lines_and_lists_registered_devices`, `test_targeted_panels_state_uses_cached_triangle_geometry`, `test_registered_device_without_saved_layout_reports_an_error_without_contact`, `test_unknown_device_is_rejected_without_fallback_or_change`, `test_http_state_query_rejections_and_privacy` |
| `test_integration_api.py` | 15 | 2 in 3b (`edits.test.ts`), each partly: `test_all_operations_preserve_unrelated_state_and_scene`, `test_shared_mapping_source_and_notices_survive_edits` | Not ported (integration admission, processing, snapshot, receipts and HTTP): the other 13, including `test_actual_worker_applies_configuration` and `test_concurrent_wall_edit_wins_without_overwrite` |
| `test_controller_animations.py` | 19 | | Slice 3d: `WorkerTest` (10), except their revocation and disable checks. Not ported: `AdmissionTest` (8) and `HTTPTest` (1); preset resolution is covered by `test_effects.py` in slice 2b |
| `test_palette.py` | 16 | 14: 8 in 2a (`renderer.test.ts`), `test_upgrade_keeps_preferences_and_adopts_defaults`, `test_damaged_rows_fall_back_to_defaults` and the six `PaletteFrameTest` cases; `test_defaults_partial_update_reset_and_restart` and `test_invalid_palette_requests_apply_nothing` in 3b; `PaletteWorkerTest` (4) in 3c (`scenes.test.ts`). Partly: `test_upgrade_keeps_preferences_and_adopts_defaults`, `test_off_base_keeps_unused_lines_dark_and_restores_scene` | Not ported: `test_palette_write_requires_origin_and_token` (wall server), `test_integration_settings_api_offers_no_palette` (integration API) |
| `test_connector_geometry.py` | 13 | 3 in 2a (`geometry.test.ts`): `test_actual_layout_preserves_identity_and_reported_housings`, `test_graph_is_allowlisted_and_rejects_invalid_geometry`, `test_synthetic_topologies_and_orientation_preserve_zone_ownership` | Not ported: the other 10 test the wall server's geometry enrichment, its connector cache file and its state (#844) |
| `test_comets.py` | 16 | 13: 2 in 2a (`renderer.test.ts`), `test_geometry_head_tail_duration_and_zone_pairs`, `test_protect_red_yellow_lines_and_outward_waves`; 3 in 3b (`comets.test.ts`), `test_completion_without_slot_waits_for_assignment`, `test_free_quiet_clear_queue_and_do_not_accumulate`, `test_expired_comet_not_replayed_after_restart`; 8 in 3c (`comets.test.ts`), the rest but three. Partly: the cases marked in [Partly translated for shared input only](#partly-translated-for-shared-input-only) | Not ported (shared input only): `test_historical_unread_reconciliation_does_not_enqueue`, `test_read_active_source_is_reserved_until_finish`, `test_scene_end_after_read_keeps_active_source_until_finish` |
| `test_modes.py` | 15 | 15: 1 in 2a (`renderer.test.ts`), `test_quiet_frames_are_steady_paired_colors`; the other 14 in 3c (`scenes.test.ts`). Partly: the cases marked in [Partly translated for shared input only](#partly-translated-for-shared-input-only) | |
| `test_effects.py` | 18 | 18: 1 in 2a, `EncoderTest.test_display_encodes_zone_frames`, with the display encoder; 17 in 2b. All in `effects.test.ts`. Partly: `test_presets_resolve_to_identical_bounded_explicit_frames` | |
| `test_animation_favorites.py` | 7 | 4 in 2b (`favorites.test.ts`), each partly: `test_save_freezes_recipe_survives_reopen_and_replays`, `test_collision_atomic_rename_delete_bound_and_name_identity`, `test_preset_defaults_are_frozen_without_snapshot_or_display_mutation`, `test_malformed_names_recipes_mixed_selectors_and_bounds_are_rejected` | Not ported: `test_stale_authority_replay_cancel_expiry_and_hold`, `test_worker_applies_save_without_light_write_and_rejects_changed_revision`, `test_revocation_and_wrong_target_never_save_or_play` (integration admission, processing and credentials) |
| `test_device_worker.py` | 40 | 3 in 2a (`configuration.test.ts`): `AddressChangeTest.test_unreadable_configuration_keeps_the_current_transport`, `MirroredTest.test_layout_save_keeps_the_other_devices_entry` and, partly, `UntargetedOrderTest.test_untargeted_calls_address_lines_whatever_the_registry_order`, whose mode command 3b restored | Slice 3e; its CLI, installer and controller API checks are not ported |
| `test_edit_parity.py` | 4 | 3 in 3b (`edits.test.ts`), each partly: `test_equivalent_edits_save_equivalent_state`, `test_active_comet_defers_browser_edit_and_holds_machine_edit`, `test_browser_only_edits_keep_their_ledger_scope` | Not ported: `test_browser_edit_after_admission_is_a_machine_revision_conflict` (integration admission) |
| `test_scene_restore.py` | 13 | 13 in 3c (`scenes.test.ts`). Partly: the cases marked in [Partly translated for shared input only](#partly-translated-for-shared-input-only) | |
| `test_controller_state.py`, `test_controller_api.py`, `test_controller_cli.py`, `test_controller_contracts.py`, `test_integration_geometry.py`, `test_codex_links.py`, `test_prism_assets.py` | | | Not ported: the controller ledger, HTTP controller, integration API and wall server. Wall view and link behavior moves with #844 |
| `test_hook_management.py` | | | Not ported: hook registration is retired |
| `test_linux_runtime.py`, `test_runtime_install.py`, `test_runtime_adapter.py`, `test_cli_compatibility.py`, `test_observability.py`, `test_measure_shared.py`, `test_verify_vendor.py`, `test_module_dependencies.py` | | | Not ported: install, packaging, CLI, diagnostics, tooling and vendored copies. The module boundary lint replaces the import-direction checks |
| `test_demo_fixture.py`, `test_demo_runs.py`, `verify_*.mjs` | | | Not ported: #844 replaces the demo and verification adapter with simulated transport and scenarios |
| `*_checks.cjs`, `wall_options.cjs` | | | Wall page browser checks move with the pages (#844); `workflow_checks.cjs` is the old repository's |

The port adds tests of its own:

- `consumer envelope check` (the generation rule and revision floor), `shared input only` (a new
  configuration while shared input is selected, a repeated selection, a paused idle task's Line and refused `bindings`)
  and `transaction helpers`, in
  `shared-input.test.ts`;
- `registry lock` (in-process turns), in `enrollment.test.ts`;
- `an empty saved receipt reads as no receipt`, in `project-map.test.ts`;
- `worker checks the port adds` (a preview ends with the tasks shown again; a wall edit a comet
  deferred applies once it ends), in `worker.test.ts`, and `an idle pass leaves a device the
  indicators do not hold` and `a restarted worker returns a scene the indicators still own`, in
  `scenes.test.ts`;
- `edits recorded from Python` and `mode command checks the port adds` (an explicit mode command ends
  overrides on every device; an unknown mode changes nothing), in `edits.test.ts`;
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
now loads both devices through `loadConfig` as Python did. Assertions about legacy input are listed in
[Partly translated for shared input only](#partly-translated-for-shared-input-only).

Slice 3b restored the map edits', palette writes' and mode commands' own validation, deferral and
application, which the slice 1 and 2a translations had saved as rows, and the migrated comet,
pending edit and deferred Locate of `test_pre_change_linux_database_migrates_and_repeats_without_change`.

Slice 3c restored the Panels worker pass that sends nothing after enrollment
(`test_enrolled_device_stays_dark_until_activated`), the migrated scene file of
`test_pre_change_linux_database_migrates_and_repeats_without_change`, and each device's scene file in
`test_modes_and_scene_files_are_independent_per_device`.

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
- `test_conflicts_are_refused_before_pairing_or_prompting`,
  `test_malformed_layout_is_refused_before_removal_writes`,
  `test_failure_after_the_registry_write_asks_for_a_rerun`: the command line's output and
  ordering.
- `test_poll_refreshes_same_revision_without_lifecycle_or_effect_changes`: the poller itself; its
  two ticks are direct acceptances.
- `test_files_are_owner_only_and_output_never_contains_the_credential`: command output and the
  wall view never show the credential. The wall view moves with #844, which keeps this rule.
- `test_machine_credentials_are_unchanged`, `test_pre_change_linux_database_migrates_and_repeats_without_change`:
  the controller credential table.
- `test_untargeted_calls_address_lines_whatever_the_registry_order`: the command-line route
  (`bridge.main`) that carried its mode command; the command itself runs through `setMode`.
- `test_api_validation_and_no_credentials`: the wall view never shows the credential or private
  content. The wall view moves with #844, which keeps this rule.
- `test_actions_address_the_named_device`: the wall view's per-element list, read here as each
  device's `owners()`. `test_mode_changes_address_the_named_device_and_leave_the_other_scene_alone`
  and `test_eviction_is_routed_to_the_named_device`: the wall server's routes and its refusal of an
  unknown device, which #844's command target replaces. Python replaced the eviction to see its
  device; the port evicts a shared task from each device in turn.
- The three `test_edit_parity.py` cases and the two `test_integration_api.py` cases: the
  integration extension's admission, processing, opaque IDs, snapshot and receipts, and the Lines
  controller ledger's revision. Each edit runs directly, with local IDs, in its own transaction.
  Python used that revision for wall-editor ownership, and #844 keeps these rules with a
  replacement for it:
  1. A machine edit is refused while a wall edit is pending.
  2. A queued machine edit fails, and never overwrites, when a later wall, mode or project
     assignment edit lands first.
  3. Machine edits wait for the Lines comet to end.

  The tests that checked them are `test_concurrent_wall_edit_wins_without_overwrite`,
  `test_browser_edit_after_admission_is_a_machine_revision_conflict` and the machine half of
  `test_active_comet_defers_browser_edit_and_holds_machine_edit`.
- `test_upgrade_keeps_preferences_and_adopts_defaults`: the wall view, which moves with #844. Its
  palette and mode are read from the saved state instead, and its check that opening the view
  leaves the scene file unchanged is not translated.
- `test_presets_resolve_to_identical_bounded_explicit_frames`: the MCP host's advertised preset list.
  The runtime module will advertise `PRESETS` itself (#844).
- The four `test_animation_favorites.py` cases: the integration API's admission, HTTP statuses,
  request IDs, receipts and controller snapshot, and its Free-only rule for playing (runtime
  commands, #844), and the worker's play (slice 3d). The tests run each edit as admission and the
  worker did: checked, then checked again and applied in its own transaction. Refusals are checked
  by their failure codes. Python patched the byte bound to 100; the port checks it on a wall too
  large for the recipe. #844 keeps two rules these cases checked through the integration API: the
  read-scope snapshot never contains favorites or preset names, and reads never write the status
  store.

### test_bridge.py

Translated in slice 2a (rendering and Line pairing): `test_render_returns_the_successfully_accepted_output_and_timing`,
`test_render_returns_completion_comet_receipt`, `test_radiation_spreads_by_distance_from_task_in_both_directions`,
`test_both_zones_match_and_animation_has_two_second_period`, `test_fifteen_physical_lines_are_paired_from_real_layout`,
`test_red_radiation_has_priority_when_different_colors_overlap`, `test_unread_completion_pulses_locally_without_legacy_wave`,
`test_assigned_lines_keep_their_status_hue_at_every_pulse_brightness`, `test_concurrent_local_statuses_keep_independent_hues`,
`test_source_keeps_status_color_during_outward_and_following_local_pulses`.

Translated in slice 3c (the worker and display receipts, with tasks from shared input instead of hook events,
`worker.test.ts`):
`test_update_display_keeps_only_the_last_fully_successful_receipt`, `test_update_display_persists_the_accepted_completion_comet`,
`test_first_working_pulse_radiates_then_only_local_loop`, `test_each_color_gets_one_radiating_pulse`,
`test_finished_and_interrupted_tasks_return_to_blue_not_off`, `test_state_change_interrupts_animation_without_resetting_other_task_epoch`,
`test_other_task_start_does_not_restore_old_radiation`, `test_task_slots_are_stable_and_completed_slots_can_be_reused`,
`test_concurrent_tasks_never_share_a_slot`, `test_failed_send_keeps_status_for_retry_on_next_event`,
`test_worker_recovers_if_finite_animation_was_interrupted_by_failure`, `test_only_one_worker_and_state_updates_remain_available`.

Not ported: `test_merge_preserves_other_hooks_and_uninstall` (hook registration), and the 19 legacy hook reducer and
unread-file reader cases in [Shared input only](#shared-input-only).

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

## Shared input only

The port keeps shared input only
([owner decision, 2026-10-06](https://github.com/jimmie-potts/agent-device-hub/issues/26#issuecomment-6022041192)).
Slice 3a removed the legacy input that slice 1 ported. Every device behavior stays, fed by shared input:
effects, Work, Quiet and Free, the unread policy fed by core read evidence, preferences, scenes,
reservations, task and effect epochs, geometry and wall-editor ownership. The #840 cutover keeps the
whole old database as a private backup and imports no legacy backup rows. Until #840, rollback is the
old Python installation; #839 ends that path.

### Not ported (owner decision 2026-10-06, shared input only)

Module parts:

- `shared_source.select_source`: the legacy branch and its hooks check. Selecting shared input is
  `selectShared`.
- `shared_input`: the legacy task backup (`BACKUP`, `dump_tables`, `_backup_values`,
  `restore_tables`, `save_legacy_tasks`, `restore_legacy_tasks`) and the configuration's `bindings`.
- `devices.legacy_row`, which only the backup restore used.
- The legacy hook reducer: `bridge.transition`, `bridge.handle_event` and `project_map.record_event`.
- The Codex Desktop unread-file reader: `bridge.unread_reader`, `bridge.reconcile_read_state` and
  `run_worker`'s reads through them.

Tests:

- `test_shared_input.py` (11): `test_rollback_preserves_mode_and_current_bound_assignment`,
  `test_rollback_completion_can_be_read_and_release_its_line`,
  `test_switching_preserves_bound_placements_on_every_device`,
  `test_selecting_legacy_without_hooks_preserves_shared_source`,
  `test_selecting_legacy_with_partial_hooks_preserves_shared_source` and `TaskBackupTest` (6).
- `test_shared_metadata.py`: `test_source_switch_preserves_manual_preference`.
- `test_devices.py`: `test_pre_change_shared_input_backup_restores_after_migration`,
  `test_backup_names_every_column_in_table_order`,
  `test_rows_saved_before_the_device_key_belong_to_the_original_device`,
  `test_device_aware_backup_restores_each_devices_rows`.
- `test_bridge.py`, the legacy hook reducer (10): `test_tool_progress_does_not_restart_flashes_or_send_more_effects`,
  `test_async_question_is_yellow_while_other_work_continues`, `test_unanswered_question_becomes_red_when_response_stops`,
  `test_blocking_input_is_red_until_its_own_result_returns`, `test_permission_block_has_priority_over_nonblocking_question`,
  `test_duplicate_and_stale_events_cannot_restart_finished_task`, `test_session_end_clears_activity_and_waits`,
  `test_no_prompt_or_question_content_is_stored`, `test_unknown_events_are_ignored`,
  `test_runtime_closing_does_not_clear_unread_completion`.
- `test_bridge.py`, the unread-file reader (9): `test_unread_completion_pulses_until_desktop_flag_clears`,
  `test_unread_flag_can_arrive_after_stop_without_losing_notification`, `test_unavailable_read_state_does_not_acknowledge_completion`,
  `test_missing_completion_receipt_recovers_without_replaying_or_skipping_settle`,
  `test_read_indicator_is_read_only_and_malformed_state_is_not_seen`, `test_current_read_indicator_refreshes_and_overrides_legacy`,
  `test_current_read_evidence_releases_occupied_lines`, `test_invalid_current_read_marker_never_uses_old_empty_indicator`,
  `test_invalid_legacy_read_ids_are_unavailable`.
- `test_comets.py`: `test_historical_unread_reconciliation_does_not_enqueue`;
  `test_read_active_source_is_reserved_until_finish` and
  `test_scene_end_after_read_keeps_active_source_until_finish`, whose read legacy task ended and left
  its Line while its comet kept the Line reserved. A read shared task stays on its Line as idle, and
  the owner removing it forgets its task, comet included; the trace's placement script pins the
  reservation of an empty comet source.
- `test_project_map.py`: `test_turn_elapsed_not_status_elapsed`, the legacy recorder's turn start.
  The trace replay compares `task_info` after every shared input step, which pins the shared
  projection's turn start.

From slice 3b, tests that create tasks through hook events get them through shared input instead
(the `Feed` test helper), where the device behavior is their subject. Each slice lists here any
assertion about the hook events themselves that it drops. Two follow from shared input's rules:
an interrupted or read task stays on its Line, so the owner removing the session frees the Line;
and a repeated hook event is the owner publishing the same state again.

### Partly translated for shared input only

Python's `SelectionTest.setUp` prompted a legacy task and bound it to the shared one. These
translations start from shared input alone and leave out what came from that task.
`tests/fixtures/shared_only.py` runs Python's tests the same way and confirms each changed expectation
(see [Recorded comparisons](#recorded-comparisons)).

- `test_atomic_cutover_identity_and_legacy_suppression`: the slot and epoch the bound task carried
  over, and the legacy hook event ignored while shared input is selected. The task's epoch is its
  evidence time, 990.
- `test_failed_preflight_and_comet_reservation_preserve_legacy`: the legacy task kept after the
  refused selection; no task is left.
- `test_wall_projects_survive_retirement_recreation_restart_and_source_switch`: the Line the bound
  task carried over, and the switch back to legacy input with its project color.
- `test_child_without_its_parent_shows_only_attention`: the parent takes Line 102 and the orphan
  Line 100; the bound task had held Line 100 for the parent.
- `test_retained_child_tasks_leave_without_disturbing_other_tasks`: the manual project the bound task
  carried over.
- `test_eviction_unknown_turn_and_source_selection_do_not_replay`,
  `test_declaring_a_source_later_does_not_replay_comets_or_waves`: a new configuration, which pauses
  shared input, takes the place of the switch to legacy input and back. The pause clears the
  eviction, so the paused view shows the task again without an eviction token. Python's view at that
  point followed its legacy rules, so it is not compared.
- `test_delayed_poll_cannot_overwrite_rollback`: a new configuration and a second selection take the
  place of the switch to legacy input. A poll and a failure report carrying the first selection's
  generation change no saved row, where Python kept its restored legacy task; the poll carries a
  newer revision that would change the task.
- `test_local_title_and_project_enrich_shared_task`,
  `test_shared_metadata_updates_preserve_effects_and_project_preferences`: the manual project is
  chosen on the shared task, saved as a wall edit saves it, instead of carried over.
- `test_shared_title_and_project_precede_local_metadata`, `test_hub_precedence_and_other_provider_isolation`,
  `test_poll_refreshes_same_revision_without_lifecycle_or_effect_changes`: the shared task has no
  manual project.

From slice 3c the worker cases run on shared input, and each replays a case recorded from Python
(`worker.json`). Shared input's rules change these:

- The worker passes at least once a second while shared input is selected, as Python's did to poll
  the feed. A radiating pulse is therefore sent once a second until it ends:
  `test_first_working_pulse_radiates_then_only_local_loop`, `test_each_color_gets_one_radiating_pulse`.
- A read or interrupted shared task stays on its Line as idle, shown in the base blue, so the scene
  returns only when the owner removes the last task: `test_finished_and_interrupted_tasks_return_to_blue_not_off`,
  `test_task_slots_are_stable_and_completed_slots_can_be_reused`,
  `test_first_viewed_task_goes_to_base_and_only_last_read_restores_scene`,
  `test_scene_change_during_quiet_work_becomes_restore_target_without_new_hooks`,
  `test_upgrade_adopts_cached_indicators_before_restoring_idle_baseline`,
  `test_read_during_comet_finishes_before_scene_returns`,
  `test_project_early_read_comet_finishes_before_scene_restore`,
  `test_off_base_keeps_unused_lines_dark_and_restores_scene`,
  `test_color_edit_invalidates_display_without_pulse_or_comet_replay`. The comet still runs to its
  end after a read.
- The worker keeps running until its stop signal, so it keeps its rendering mark
  (`test_worker_recovers_if_finite_animation_was_interrupted_by_failure`), and a preview's end is
  checked by what is written after the mode command, not by an early exit
  (`test_mode_change_interrupts_preview`).
- An interrupt reported after a completion leaves the task unread, so its comet runs on
  (`test_new_turn_and_interrupt_cancel_active_comet`); a new turn still ends it.
- Owner read evidence replaces the Codex unread file: `test_read_queued_task_is_skipped`,
  `test_read_receipts_clear_in_free_without_light_requests` (whose receipts were the unread file's).
- A repeated Stop event is the owner publishing the same state again:
  `test_completions_queue_in_order_and_duplicate_stop_is_ignored`.
- `test_worker_polls_and_refreshes_metadata_in_free_without_legacy_unread_reads`: the worker reads
  no feed and no unread file; refreshing Codex metadata belongs to each envelope's acceptance.
- `test_free_releases_once_and_never_requests_lights_on_events`: the device's scene after Free is
  checked at the end of the case.
- Concurrent hook processes become one owner revision per task (`test_concurrent_tasks_never_share_a_slot`),
  and the second worker starts during the first one's wait, in one process
  (`test_only_one_worker_and_state_updates_remain_available`).
- The comet's start is read from the saved rows during a run, where Python read each request's
  configuration: `test_start_time_survives_failed_send_and_restart`,
  `test_queued_comets_play_sequentially_in_worker`.

## Recorded comparisons

Where the translated tests leave behavior open, the port is compared with Python on recorded inputs.
`record.py` is the Python oracle: it runs the Python bridge read-only, CI does not run it, and it
retires with codex-nanoleaf (#839). It writes:

- `values.json`: identity keys, eviction tokens, default project colors, fallback titles, path
  normalization, float text, rounding, float remainders, JSON text and private-address checks
  (`compat.test.ts`).
- `numbers.json`, one case per line: `math.hypot` and `sum()` on random floats (`compat.test.ts`).
- `setups.json`: the state the Python tests' setUp methods saved, `SelectionTest`'s without its legacy
  task. Python made this state through hook events, which the port does not take, so the translated
  tests load it instead. Three test helpers are checked against it: `taskRow` and `completion`, the
  rows a prompt and a completion saved, and `setMode`.
- `owner-snapshot.json`: the released agent-state 3.3.0 owner's snapshot for `ReleaseTest`.
- `trace.json`, one step per line: three random sequences and two scripted ones (comets; Line
  placement) through the selection of shared input, owner revisions, feed loss, placement,
  evictions, comets, modes, reservations and Codex metadata. Each trace selects shared input once
  and never leaves it.
- `edits.json`, one member per line to a fixed depth (`edits.test.ts`): 86 cases on the 15 straight
  Lines and the NL22 triangles. Most start from a task in a project, and optionally its started comet
  or a mode. Three start from shared input selected with no session and take their tasks from the
  shared feed (`record.Feed`, the `Feed` test helper): the steps of the three `test_comets.py`
  cases 3b translates. Each case runs edits, the pending wall edit, Locate, feed changes, placement,
  comet steps, mode commands, queries and rendering receipt reads in turn, records each outcome (a
  result, or an exception's class and message), and then the rows they leave in `map_settings`,
  `line_prefs`, `palette`, `projects`, `task_info`, `map_pending` (parsed), `locate`, `comets`,
  `slots` and `meta`. Inputs include true and false where Python's `in` took them as 1 and 0,
  malformed palettes, unknown elements, projects and tasks, edits merged while a comet defers them,
  comets queued in a different order than they start, and an empty saved rendering receipt.
- `worker.json`, one member per line to a fixed depth (`worker-support.ts`): 41 worker cases, one per
  translated Python worker test and three the port adds, on SceneTest's 15 Lines and its fake device
  with two saved scenes. Each case selects shared input with no session at 1000 and then runs feed
  changes, mode commands, edits, queries, device changes and worker runs in turn. A worker run lasts
  to a set time, with scheduled steps taken at its first wait at or after their time, as Python's
  sleep took them, and the stop signal at its first wait at or after the end. Python's worker runs
  with its feed poll replaced by a reader of the selected state, and a clock kept in milliseconds:
  now() is milliseconds divided by 1000 and a sleep of s seconds adds s * 1000, the arithmetic the
  port does through the runtime's clock and scheduler, so both compute the same instants. The
  recording holds each step's outcome, every device request with its time and payload, each send a
  run captured, and the rows (`display_v3` parsed), scene file, device state and clock at the end.
  The port must match all of it exactly.
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
`connection` and `error`, and the envelope by hash. The `palette`, `map_pending`,
`locate` and `shared_ack` tables and `shared_input`'s `config` and `backup` are not compared.

To re-record, run from the repository root with a codex-nanoleaf checkout at the provenance commit:

```bash
PYTHONDONTWRITEBYTECODE=1 fnm exec --using=.nvmrc -- python3 modules/nanoleaf/tests/fixtures/record.py <codex-nanoleaf>
```

`shared_only.py` records nothing. It runs Python's `test_shared_input.py` and
`test_shared_metadata.py` from shared input only, with the adjustments
[Partly translated for shared input only](#partly-translated-for-shared-input-only) lists, and passes
when the only failures are the not-ported tests that need the bound legacy task. Run it the same way,
on a read-only export of that commit, since the Python tests import from their own directory.

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
- `acceptEnvelope` and `selectShared` refresh Codex metadata inside the caller's transaction;
  Python read the files before opening it.
- Shared input only:
  - A new configuration while shared input is selected pauses it, as leaving shared input did: active
    comets refuse it, queued comets and completion receipts are dropped, every task is held stale,
    and evictions and display caches are cleared. Shared tasks stay until the caller selects shared
    input again, which projects a fresh start. Python refused the configuration
    (`select-legacy-before-configure`) until legacy input was selected, which restored the legacy
    tasks.
  - A configuration with `bindings` is refused as `invalid-config`. A saved Python configuration
    must drop them before it is configured here.
  - `shared_input.source` keeps Python's stored `'legacy'` (`NOT_SELECTED`) for shared input not
    selected, so migrated state reads unchanged. The `backup` column stays in the schema, unused.
  - `visibleTasks` applies shared input's rules whether or not it is selected: idle tasks are shown
    and the device's evictions are hidden. Python applied its legacy rules while legacy input was
    selected (idle tasks hidden, evictions ignored). So a task held while shared input is paused
    keeps its Line. Tests that save task rows directly (the `taskRow` helper and the recorded
    `enrollment` setup) see the same rules.
- `execute()` binds every JavaScript number as a SQLite REAL. A column with integer affinity stores
  a whole number as an integer, but a TEXT column stores `5` as `'5.0'` where Python stored `'5'`.
  Slice 1 writes `meta` values as text; slices 2 and 3 must do the same.
- JSON numbers carry no int or float type. Whole numbers are written without `.0` in saved JSON,
  and a whole float such as `5.0` passes checks that Python's `type(x) is int` refused. Saved
  `meta` float text keeps Python's form.
- JavaScript lists integer-like object keys first, so a device or project ID such as `2` would
  change position in a rewritten JSON file. Device and project IDs in use are not integer-like, but
  Panels element IDs are: a pending wall edit lists them first in its saved text and applies them
  in that order. Nothing reads `line_prefs` in insertion order, and the recorded comparison reads
  the pending edit parsed.
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
  and counts the zones before reading their other fields. Line positions take the last entry with
  each panel ID and read only `x` and `y`. A device
  reply without `panelLayout`, a reported entry that is not an object or lacks a field Python read
  (`shapeType`; `panelId`, `x`, `y` and `o` of a zone being paired; `panelId`, `x` and `y` for
  positions), and a non-numeric coordinate are `ValueError`s; Python raised `KeyError` or
  `TypeError`. A registered device without an address or credential reaches the request as an
  empty string, where Python passed `None`.
- `pairLines` refuses a panel ID that is not a number. Python's `pair_lines` paired string IDs, and
  `load_config` then refused them as `Invalid physical Line mapping.`; through `loadConfig` both
  refuse, with a different message.
- A color must be `#` and six hexadecimal digits, or it is a `ValueError`. Python's
  `int(text, 16)` on each pair of characters also refused `#1g2233` and `#abc`, but accepted a
  short last channel (`#12345`), a sign or space (`#+1aabb`), extra characters (`#aabbccdd`) and a
  first character other than `#`. Saved colors are always written as `#` and six digits.
  `effects.rgb` applies the same rule to animation colors, which `effects.valid` checks first.
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
- Edits and mode commands (3b):
  - No edit or mode command advances a controller ledger; the ledger is not ported. Each still
    wakes the display once.
  - An explicit mode command ends the device's power and brightness overrides on every device,
    including a command for the current mode. Python did so only on a device with a controller
    ledger, the only devices that could hold overrides; the port takes controls on every device.
  - `setMode` refuses an unknown mode inside the transaction, as `set_mode` did before opening it.
    `changeMode` keeps Python's `change_mode`, which took any mode.
  - Settings that are not an object are a `ValueError`; Python raised `AttributeError`. A list or
    object given as an edit's `project`, `session` or `line` is a `ValueError`, where Python raised
    `TypeError` (an unhashable value) or a SQLite binding error. A task ID that is not text is an
    unknown task.
  - A started comet without a numeric source or start is a `TypeError`; Python returned it as
    saved.
- The display worker (3c):
  - It takes the runtime's clock in epoch milliseconds and its scheduler, and keeps seconds inside.
    Each of Python's sleeps is a timer of s * 1000 milliseconds, and the stop signal ends the worker
    at its next wait.
  - It reads no feed: shared input arrives through `acceptEnvelope`, which also refreshes Codex
    metadata. It reads no Codex unread file and keeps no read settle, so it ignores the
    `receipts` table's settle times; it still watches for receipts, as Python did.
  - Python saved its display cache with whole floats written as `1000.0`; the port writes `1000`.
    After the cutover the first pass of each device therefore sends its display once more.
  - A saved scene file that is not an object is a `ValueError`; Python raised `AttributeError`. A
    whole float such as `50.0` passes as a brightness, where Python's `type(x) is int` refused it.
    A malformed scene list or brightness from the device is a `ValueError`, where Python raised
    `KeyError` or `TypeError` for some.
  - The display cache's text keeps Python's encoding of infinities (`-Infinity`) for an unset wave
    cutoff, so it reads back as Python's did.

## Known limits

- The tests read task rows through `wallView`, a test helper that mirrors
  `wall_server.App.state`. No Python recording checks that helper; #844 ports the real view.
- The worker holds a write transaction while it sends to the device, as Python's did. In one process,
  another writer that waits inside SQLite (an envelope's acceptance, an edit or a mode command) would
  block the event loop until its timeout; #844 must let them wait without blocking, or queue them.
- The worker's per-device lock is Python's lock file in the state directory, which also excludes a
  second process. #844 may replace it with an in-process guard.
- Two of the worker's checks cannot fail in 3c, because a pass holds its write transaction across its
  sends, so nothing can commit between the check and the send: the preview send's own revision check,
  and the restart check after a pass's sends. Removing either changes no test. 3d's journaled sends
  run outside the transaction, which makes the restart check live; 3d adds a test that fails without
  it.
- The `worker` command's retry loop (record the failure, wait two seconds, run again while the device
  is registered) is not ported yet; `recordFailure` is. 3e ports it with the multi-device worker
  cases, or #844's module host takes it over.
