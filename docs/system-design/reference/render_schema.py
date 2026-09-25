#!/usr/bin/env python3
"""Render SchemaSpy reports from fresh empty databases built from committed DDL."""
import argparse
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import tempfile

from extract import schema_metadata

ROOT = Path(__file__).resolve().parent
DATABASES = ('pixoo-library', 'pixoo-owner', 'nanoleaf')
TEXT = {'.html', '.xml', '.svg', '.dot', '.txt'}


def normalize(source, destination, database, name):
    """Remove temporary paths/dates and share unchanged bundled browser assets."""
    for path in sorted(source.rglob('*')):
        if not path.is_file() or path.name == 'info-html.txt':
            continue
        relative = path.relative_to(source)
        shared = relative.parts[0] in ('bower', 'fonts')
        target = destination.parent/'shared'/relative if shared else destination/relative
        target.parent.mkdir(parents=True, exist_ok=True)
        data = path.read_bytes()
        if not shared and path.suffix in TEXT:
            value = data.decode('utf-8').replace(str(database), database.name)
            value = re.sub(r'Generated on [^<\n]+', 'Source schema baseline: 2026-09-20. Empty documentation database.', value)
            value = value.replace('http://schemaspy.org/', 'https://schemaspy.org/').replace('http://stackoverflow.com/', 'https://stackoverflow.com/')
            if path.suffix == '.html':
                prefix = '../' * len(relative.parts)
                value = re.sub(r'((?:href|src)=[\"\'])(?:\.\./)*(bower|fonts)/', lambda m:m[1]+prefix+'shared/'+m[2]+'/', value)
                value = value.replace('width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no', 'width=device-width, initial-scale=1')
                value = value.replace('<html>', '<html lang="en">')
                banner = f'<div style="padding:14px 20px;background:#102a2b;color:#e8f6f1;font:16px/1.5 system-ui"><a style="color:#9cf1d5" href="{prefix}../index.html">B.U.N.N.Y. reference</a> · {html.escape(name)} · source schema only; no live data. Relationships show declared foreign keys only.</div>'
                value = re.sub(r'(<body[^>]*>)', r'\1'+banner, value, count=1)
            data = value.encode('utf-8')
        if shared and target.exists():
            assert target.read_bytes() == data, f'Conflicting shared SchemaSpy asset: {relative}'
        else:
            target.write_bytes(data)


def build(tool_directory):
    lock = json.loads((ROOT/'tools.json').read_text())
    for name in ('schemaspy', 'sqliteJdbc'):
        tool = lock[name]
        path = tool_directory/tool['filename']
        assert hashlib.new(tool['algorithm'], path.read_bytes()).hexdigest() == tool['digest'], f'Unverified {name}'
    output = ROOT/'database'
    with tempfile.TemporaryDirectory(prefix='bunny-schema-') as folder:
        temporary = Path(folder)
        staged = temporary/'site'
        for name in DATABASES:
            sql = (ROOT/'schemas'/f'{name}.sql').read_text()
            metadata = schema_metadata(sql)
            assert metadata == json.loads((ROOT/'schemas'/f'{name}.json').read_text()), f'Schema drift: {name}'
            database = temporary/f'{name}.sqlite'
            # A new private temporary file only; callers cannot supply a live DB.
            with sqlite3.connect(database) as db:
                db.executescript(sql)
            report = temporary/f'{name}-report'
            command = ['java', '-jar', str(tool_directory/'schemaspy-app.jar'), '-t', 'sqlite-xerial', '-dp', str(tool_directory/'sqlite-jdbc.jar'), '-db', str(database), '-cat', '%', '-s', 'main', '-u', 'documentation', '-dbThreads', '1', '-noimplied', '-norows', '-vizjs', '-imageformat', 'svg', '-o', str(report)]
            result = subprocess.run(command, capture_output=True, text=True, env={**os.environ, 'TZ':'UTC'})
            if result.returncode:
                raise RuntimeError(result.stdout + result.stderr)
            normalize(report, staged/name, database, name)
            print(f'Rendered {name}: {len(metadata["tables"])} tables; no live database opened.', flush=True)
        receipt = {'tools':{key:lock[key]['version'] for key in ('schemaspy','sqliteJdbc')},
                   'inputs':{name:hashlib.sha256((ROOT/'schemas'/f'{name}.sql').read_bytes()).hexdigest() for name in DATABASES},
                   'files':{str(p.relative_to(staged)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(staged.rglob('*')) if p.is_file()}}
        if output.exists():
            shutil.rmtree(output)
        shutil.copytree(staged, output)
        (ROOT/'database-receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tools', type=Path, required=True, help='Directory containing the two verified JAR files in tools.json')
    build(parser.parse_args().tools.resolve())
