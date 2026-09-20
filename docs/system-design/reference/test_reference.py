"""Focused checks for source-only schema extraction and published API contracts."""
import unittest

from extract import ddl_from_python


class ExtractionTests(unittest.TestCase):
    def test_extracts_schema_without_running_application_or_copying_rows(self):
        source = '''
raise RuntimeError("application code must never execute")
def init(db):
    db.execute('CREATE TABLE tasks '
               '(id TEXT PRIMARY KEY, value TEXT)')
    db.execute("INSERT INTO tasks VALUES ('private', 'not documentation')")
def unrelated(db):
    db.execute('CREATE TABLE unrelated(id INTEGER)')
'''
        self.assertEqual(ddl_from_python(source, "init"),
                         ['CREATE TABLE tasks (id TEXT PRIMARY KEY, value TEXT);'])

    def test_preserves_declared_constraints_in_statement_tuples(self):
        source = '''
def init(db):
    for statement in ('CREATE TABLE parent(id TEXT PRIMARY KEY)',
                      'CREATE TABLE child(id TEXT REFERENCES parent(id))',
                      'INSERT INTO parent VALUES (123)'):
        db.execute(statement)
'''
        self.assertEqual(len(ddl_from_python(source, 'init')), 2)
        self.assertIn('REFERENCES parent(id)', ddl_from_python(source, 'init')[1])

    def test_missing_schema_owner_is_an_error(self):
        with self.assertRaises(ValueError):
            ddl_from_python('def other(): pass', 'init')


if __name__ == '__main__':
    unittest.main()
