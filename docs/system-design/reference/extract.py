#!/usr/bin/env python3
"""Extract documentation inputs from immutable Git objects, never runtime state."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import subprocess

ROOT = Path(__file__).resolve().parent
PINS = {
    'pixoo': ('divoom-app-upgrade', '9f1c0ec75651810a441606b0c08fbdeee824c8d8'),
    'nanoleaf': ('codex-nanoleaf', '2558df5a2fc543247b0c75898ef0260ba3ea264b'),
}


def ddl_from_python(source, function):
    tree = ast.parse(source)
    owner = next((n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == function), None)
    if owner is None:
        raise ValueError(f'Missing schema owner: {function}')
    statements = [(n.lineno, n.value.strip().rstrip(';') + ';') for n in ast.walk(owner)
                  if isinstance(n, ast.Constant) and isinstance(n.value, str)
                  and re.match(r'CREATE\s+(TABLE|INDEX|TRIGGER)\b', n.value, re.I)]
    return [s for _, s in sorted(statements)]


def schema_metadata(sql):
    # This function has no database path argument. It can only create a fresh
    # in-memory database, and it never imports or executes controller modules.
    with sqlite3.connect(':memory:') as db:
        def authorize(action, _a, _b, _db, _source):
            return sqlite3.SQLITE_DENY if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH) else sqlite3.SQLITE_OK
        db.set_authorizer(authorize)
        db.executescript(sql)
        tables = []
        for name, create in db.execute("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
            quoted = '"' + name.replace('"', '""') + '"'
            assert db.execute(f'SELECT count(*) FROM {quoted}').fetchone()[0] == 0, 'Schema input contains rows'
            columns = [dict(zip(('position','name','type','declaredNotNull','default','primaryKeyOrder'), row))
                       for row in db.execute(f'PRAGMA table_info({quoted})')]
            foreign = [dict(zip(('id','sequence','table','from','to','onUpdate','onDelete','match'), row))
                       for row in db.execute(f'PRAGMA foreign_key_list({quoted})')]
            indexes = []
            for _seq, index, unique, origin, partial in db.execute(f'PRAGMA index_list({quoted})'):
                iq = '"' + index.replace('"', '""') + '"'
                indexes.append(dict(name=index, unique=bool(unique), origin=origin, partial=bool(partial),
                                    columns=[row[2] for row in db.execute(f'PRAGMA index_info({iq})')]))
            tables.append(dict(name=name, sql=create, columns=columns, foreignKeys=foreign,
                               indexes=sorted(indexes, key=lambda x:x['name'])))
        triggers = [dict(name=n, table=t, sql=s) for n,t,s in db.execute("SELECT name,tbl_name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name")]
        return dict(tables=tables, triggers=triggers)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def extract(pixoo_root, nanoleaf_root):
    paths = {'pixoo': pixoo_root, 'nanoleaf': nanoleaf_root}
    evidence = {}
    def source(service, file):
        repo, revision = PINS[service]
        value = subprocess.check_output(['git', '-C', str(paths[service]), 'show', f'{revision}:{file}'])
        evidence[f'{service}/{file}'] = dict(repository=repo, revision=revision, path=file,
            sha256=hashlib.sha256(value).hexdigest(),
            url=f'https://github.com/jimmie-potts/{repo}/blob/{revision}/{file}')
        return value.decode('utf-8')

    migration = source('pixoo', 'packages/library/src/migrations.ts')
    blocks = re.findall(r'\{version:(\d+),sql:`(.*?)`', migration, re.S)
    if [int(v) for v,_ in blocks] != [1,2,3]:
        raise ValueError('Review the selected migration inventory')
    migration_table = re.search(r"db.exec\('(CREATE TABLE IF NOT EXISTS schema_migrations[^']+)'\)", migration).group(1)
    pixoo_sql = migration_table + ';\n' + '\n'.join(sql.strip() for _,sql in blocks) + '\n'
    owner_source = source('pixoo', 'packages/library/src/files.ts')
    owner_sql = re.search(r'CREATE TABLE IF NOT EXISTS owner\([^;]+', owner_source).group(0) + ';\n'
    nano_statements = []
    for file, function in [('bridge/project_map.py','init'), ('bridge/bridge.py','connect_state'), ('bridge/controller_state.py','init')]:
        nano_statements += ddl_from_python(source('nanoleaf', file), function)
    sql_sets = {'pixoo-library':pixoo_sql, 'pixoo-owner':owner_sql, 'nanoleaf': '\n'.join(nano_statements)+'\n'}
    for name, sql in sql_sets.items():
        (ROOT/'schemas').mkdir(exist_ok=True)
        (ROOT/'schemas'/f'{name}.sql').write_text(sql, encoding='utf-8')
        write_json(ROOT/'schemas'/f'{name}.json', schema_metadata(sql))

    routes = []
    for file in ['app.ts','api.ts','catalog-routes.ts','player-routes.ts','device-routes.ts','events.ts']:
        path = 'apps/server/src/' + file
        value = source('pixoo', path)
        for match in re.finditer(r"app\.(get|post|put|patch|delete)[^'\n]*\('([^']+)'", value):
            routes.append(dict(service='pixoo', method=match[1], path=re.sub(r':(\w+)', r'{\1}', match[2]),
                               file=path, line=value[:match.start()].count('\n')+1))
    # Python handlers dispatch by path; retain explicit method ownership.
    for service, file, definitions in [
        ('nanoleaf-controller','bridge/controller_server.py', [('get','/controller/v1/devices'),('get','/controller/v1/snapshot'),('get','/controller/v1/feed'),('post','/controller/v1/commands')]),
        ('nanoleaf-map','bridge/wall_server.py', [('get','/health'),('get','/api/state'),*[('post','/api/'+p) for p in ['mode','settings','assign','project','task','locate']]])]:
        value = source('nanoleaf', file)
        for method, path in definitions:
            offset = value.index(repr(path))
            routes.append(dict(service=service, method=method, path=path, file=file, line=value[:offset].count('\n')+1))
    write_json(ROOT/'routes.json', routes)
    for file in ['packages/core/src/api.ts','packages/core/src/index.ts','packages/library/src/contracts.ts','packages/media/src/contracts.ts','packages/playback/src/contracts.ts','packages/playback/src/player.ts','packages/library/src/checkpoint.ts','packages/device/src/contracts.ts','apps/server/src/security.ts','apps/server/src/commands.ts','apps/server/src/control-service.ts','apps/server/src/device-settings.ts','apps/server/src/mcp.ts','docs/api.md','docs/library-persistence.md','package-lock.json']:
        source('pixoo', file)
    source('nanoleaf','docs/controller-api.md')
    shared = json.loads(source('nanoleaf', 'bridge/vendor/device-contracts-1.0.0/package/schemas/controller-v1.schema.json'))
    write_json(ROOT/'schemas'/'controller-contract.json', shared)
    write_json(ROOT/'sources.json', dict(pins={key:dict(repository=repo, revision=rev) for key,(repo,rev) in PINS.items()}, files=evidence))
    print(f'Extracted {len(routes)} explicit operations and {sum(len(schema_metadata(s)["tables"]) for s in sql_sets.values())} empty tables from pinned Git source.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pixoo-root', type=Path, required=True)
    parser.add_argument('--nanoleaf-root', type=Path, required=True)
    args = parser.parse_args()
    extract(args.pixoo_root, args.nanoleaf_root)
