"""Check the port's shared-input-only expectations against the Python bridge (Hub #26, owner decision 2026-10-06).

Runs Python's test_shared_input.py and test_shared_metadata.py with SelectionTest.setUp reduced to shared input only:
no legacy task is prompted or bound. The tests whose assertions depended on that bound task are adjusted as their
translations are (PORTING.md, "Shared input only"). Python still changes its configuration the only way it could, through
legacy input, so its hooks stay registered here. Run from the repository root with a read-only export of codex-nanoleaf
at the provenance commit in PORTING.md:

    PYTHONDONTWRITEBYTECODE=1 fnm exec --using=.nvmrc -- python3 modules/nanoleaf/tests/fixtures/shared_only.py <codex-nanoleaf>

It passes when the only failures are the not-ported legacy-input tests that need the bound legacy task. It writes
nothing outside temporary directories.
"""
import contextlib
import inspect
import io
from pathlib import Path
import sys
import tempfile
import textwrap
import unittest
from unittest.mock import patch

SOURCE = Path(sys.argv[1]).resolve()
sys.dont_write_bytecode = True
sys.path.insert(0, str(SOURCE / 'tests'))
import test_shared_input as t  # noqa: E402
import test_shared_metadata as m  # noqa: E402
from test_shared_input import b  # noqa: E402
import codex_hooks  # noqa: E402
import database  # noqa: E402
import shared_source  # noqa: E402

# The not-ported legacy-input tests that need the bound legacy task, so fail with shared input only. The other
# not-ported ones (PORTING.md) set up their own state and still pass.
NEED_LEGACY_TASK = {
    'test_rollback_preserves_mode_and_current_bound_assignment',
    'test_rollback_completion_can_be_read_and_release_its_line',
    'test_switching_preserves_bound_placements_on_every_device',
    'test_cutover_and_rollback_preserve_legacy_state_and_carry_bound_choices',
    'test_switch_operations_stay_inside_the_callers_transaction',
    'test_source_switch_preserves_manual_preference',
}


def setUp(self):
    """SelectionTest.setUp without the legacy task and its binding."""
    import shared_input as s
    self.s = s
    self.temp = tempfile.TemporaryDirectory()
    self.addCleanup(self.temp.cleanup)
    self.path = Path(self.temp.name)
    self.instant = 1000.0
    self.codex_home = self.path / 'codex-home'
    environment = patch.dict(b.os.environ, {'CODEX_HOME': str(self.codex_home)})
    environment.start()
    self.addCleanup(environment.stop)
    codex_hooks.manage_hooks(self.codex_home, 'register', script=Path(b.__file__))
    self.config = {'version': 1, 'ownerId': 'owner', 'consumerId': 'nanoleaf',
                   'endpoint': 'http://127.0.0.1:12345/api/monitor/v1', 'tokenFile': str(self.path / 'token'),
                   'clearOnNewTurn': True,
                   'qualifiedSources': [{'provider': 'codex', 'client': 'desktop', 'hostId': 'host', 'sourceId': 'source'}],
                   'bindings': []}
    with contextlib.closing(database.connect_state(self.path)) as db, db:
        db.execute("INSERT INTO projects VALUES ('project','LOCAL TITLE','#112233','[]')")
    shared_source.configure(self.path, self.config)


t.SelectionTest.setUp = setUp
# Classes that copied SelectionTest.setUp when they were defined.
for cls in vars(t).values():
    if isinstance(cls, type) and issubclass(cls, unittest.TestCase) and cls.__dict__.get('setUp') is not None \
            and getattr(cls.__dict__['setUp'], '__qualname__', '') == 'SelectionTest.setUp':
        cls.setUp = setUp


def adjusted(cls, name, edits):
    """Each edit is (old, new): a replacement, or with new None the deletion of every line containing old."""
    source = textwrap.dedent(inspect.getsource(getattr(cls, name)))
    for old, new in edits:
        assert old in source, (name, old)
        if new is None:
            source = ''.join(line for line in source.splitlines(keepends=True) if old not in line)
        else:
            source = source.replace(old, new)
    scope = dict(vars(sys.modules[cls.__module__]))
    exec(source, scope)
    setattr(cls, name, scope[name])


# shared_input.test.ts: the bound legacy task's slot, epoch and manual project, and the ignored legacy hook event.
adjusted(t.SelectionTest, 'test_atomic_cutover_identity_and_legacy_suppression', [
    ("self.assertEqual(self.rows('SELECT session,slot FROM slots'),[(key,0)])", None),
    ("'turn_id':'bad','hook_event_name':'UserPromptSubmit'}", None),
    ("self.assertEqual(self.rows('SELECT started FROM activity'),[(1000.0,)])",
     "self.assertEqual(self.rows('SELECT started FROM activity'),[(990.0,)])")])
adjusted(t.SelectionTest, 'test_failed_preflight_and_comet_reservation_preserve_legacy', [
    ("self.assertEqual(self.rows('SELECT id FROM sessions'),[('legacy',)])",
     "self.assertEqual(self.rows('SELECT id FROM sessions'),[]); self.assertEqual(self.s.inspect(self.path)['source'],'legacy')")])
adjusted(t.SelectionTest, 'test_wall_projects_survive_retirement_recreation_restart_and_source_switch', [
    ("self.assertEqual(first['tasks'][0]['line'],'100:101')", None),
    ("shared_source.select_source(self.path,'legacy',now=lambda:1005)", None),
    ("self.assertEqual(view()['projects'][0]['color'],'#112233')", None)])
adjusted(t.ChildSessionTest, 'test_retained_child_tasks_leave_without_disturbing_other_tasks', [
    ("[('project',)])", None)])
adjusted(t.ChildSessionTest, 'test_child_without_its_parent_shows_only_attention', [
    ("{self.key: ('idle', 100, 'current'), orphan_key: ('blocked', 102, 'current')}",
     "{self.key: ('idle', 102, 'current'), orphan_key: ('blocked', 100, 'current')}"),
    ("{self.key: ('idle', 100, 'current')})", "{self.key: ('idle', 102, 'current')})")])
# The port's new configuration pauses shared input; Python's only route was legacy input, configure, shared input. Python's
# view then followed its legacy rules, which the port does not keep, so the paused view is not compared.
adjusted(t.ChildSessionTest, 'test_eviction_unknown_turn_and_source_selection_do_not_replay', [
    ("self.assertNotIn('evictionToken',app.state()['tasks'][0])", None),
    ("shared_source.select_source(self.path,'legacy',now=lambda:1003)",
     "shared_source.select_source(self.path,'legacy',now=lambda:1003); shared_source.configure(self.path,self.config)")])

# A new configuration and a second selection take the place of the switch to legacy input; a late poll or failure
# report from the first selection still changes nothing.
SAVED = "[self.rows('SELECT * FROM '+table) for table in ('sessions','activity','task_info','slots','comets','shared_stale','shared_evictions','shared_input','meta')]"
adjusted(t.RecoveryTest, 'test_delayed_poll_cannot_overwrite_rollback', [
    ("shared_source.select_source(self.path,'legacy',now=lambda:1001)",
     "shared_source.select_source(self.path,'legacy',now=lambda:1001); shared_source.configure(self.path,self.config); "
     "self.select(); saved=" + SAVED + "; late=envelope(); late['snapshot']['revision']+=1; "
     "late['snapshot']['sessions'][0]['activity']='active'"),
    ("self.assertFalse(shared_source.accept(self.path,envelope(),generation=generation))",
     "self.assertFalse(shared_source.accept(self.path,late,generation=generation))"),
    ("self.assertEqual(self.rows('SELECT id FROM sessions'),[('legacy',)])", "self.assertEqual(" + SAVED + ",saved)"),
    ("self.assertEqual(self.s.inspect(self.path)['source'],'legacy')", "self.assertEqual(self.s.inspect(self.path)['source'],'shared')")])

# shared-metadata.test.ts: no manual project unless one is chosen on the shared task, as a wall edit saves it.
MANUAL = ("\n    with contextlib.closing(database.connect_state(self.path)) as db,db: "
          "db.execute(\"UPDATE task_info SET manual_project='project' WHERE session=?\",(self.key,))")
adjusted(m.SharedMetadataTest, 'test_local_title_and_project_enrich_shared_task', [
    ("self.assertEqual(self.detail(),('Real task title','local','project'))",
     "self.assertEqual(self.detail(),('Real task title','local',None))\n"
     "    with contextlib.closing(database.connect_state(self.path)) as db: self.assertEqual(wall.task_projects(db)[self.key],'local')"
     + MANUAL)])
adjusted(m.SharedMetadataTest, 'test_shared_metadata_updates_preserve_effects_and_project_preferences', [
    ("self.select(self.value)", "self.select(self.value)" + MANUAL)])
for name, value in [('test_shared_title_and_project_precede_local_metadata', "'Shared task title','shared-project-hub'"),
                    ('test_hub_precedence_and_other_provider_isolation', "'Hub label','shared-project-hub'"),
                    ('test_poll_refreshes_same_revision_without_lifecycle_or_effect_changes', "'Updated title','nested'")]:
    adjusted(m.SharedMetadataTest, name, [(f"({value},'project')", f"({value},None)")])

suite = unittest.defaultTestLoader.loadTestsFromNames(['test_shared_input', 'test_shared_metadata'])
output = io.StringIO()
result = unittest.TextTestRunner(verbosity=0, stream=output).run(suite)
failed = {test._testMethodName for test, _ in result.failures + result.errors}
if failed != NEED_LEGACY_TASK:
    sys.stderr.write(output.getvalue())
    sys.exit(f'Unexpected outcome. Failed: {sorted(failed - NEED_LEGACY_TASK)}; passed: {sorted(NEED_LEGACY_TASK - failed)}')
print(f'{result.testsRun} runs (subclasses repeat inherited tests); the only failures are the '
      f'{len(NEED_LEGACY_TASK)} not-ported tests that need the bound legacy task.')
