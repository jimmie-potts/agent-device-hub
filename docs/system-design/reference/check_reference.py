#!/usr/bin/env python3
"""Check reference coverage, schema-only inputs, provenance and offline links."""
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess
import sys
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

from extract import PINS, schema_metadata

ROOT = Path(__file__).resolve().parent
METHODS = {'get','post','put','patch','delete'}


class Links(HTMLParser):
    def __init__(self, path):
        super().__init__(convert_charrefs=True)
        self.targets, self.ids = [], set()
        self.feed(path.read_text())

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        self.ids.update(v for k,v in attributes if k == 'id' or (tag == 'a' and k == 'name'))
        for attr in ('href','src','data'):
            if attr in attrs and (attr != 'data' or tag == 'object'):
                self.targets.append(attrs[attr])


def walk(value):
    yield value
    if isinstance(value, dict):
        for item in value.values(): yield from walk(item)
    elif isinstance(value, list):
        for item in value: yield from walk(item)


def check():
    for script in ('build_api.py','build_pages.py'):
        subprocess.run([sys.executable,str(ROOT/script),'--check'],check=True)
    subprocess.run([sys.executable,'-B','-m','unittest','discover','-s',str(ROOT),'-p','test_reference.py'],check=True)
    sources = json.loads((ROOT/'sources.json').read_text())
    assert sources['pins'] == {key:dict(repository=repo,revision=rev) for key,(repo,rev) in PINS.items()}
    for value in sources['files'].values():
        assert len(value['sha256']) == 64 and len(value['revision']) == 40
        assert value['url'].endswith('/'+value['revision']+'/'+value['path'])
    expected = {(r['service'],r['method'],r['path']) for r in json.loads((ROOT/'routes.json').read_text())}
    actual, operation_ids = set(), set()
    for path in sorted((ROOT/'openapi').glob('*.json')):
        spec = json.loads(path.read_text())
        assert spec['openapi'] == '3.1.0'
        assert spec['servers'][0]['variables']['port']['default'] == '0'
        for route, methods in spec['paths'].items():
            for method, operation in methods.items():
                assert method in METHODS
                actual.add((path.stem,method,route))
                assert operation['operationId'] not in operation_ids
                operation_ids.add(operation['operationId'])
                assert spec['x-source-revision'] in operation['externalDocs']['url']
                assert operation['responses']
        for value in walk(spec):
            if isinstance(value,dict) and '$ref' in value:
                ref = value['$ref']
                assert ref.startswith('#/'), f'External schema dependency: {ref}'
                target=spec
                for key in ref[2:].split('/'):
                    target=target[key.replace('~1','/').replace('~0','~')]
    assert actual == expected and len(actual) == 37, 'REST/SSE inventory drift'
    receipt = json.loads((ROOT/'database-receipt.json').read_text())
    tables = 0
    for name in ('pixoo-library','pixoo-owner','nanoleaf'):
        sql = ROOT/'schemas'/f'{name}.sql'
        assert hashlib.sha256(sql.read_bytes()).hexdigest() == receipt['inputs'][name]
        metadata = schema_metadata(sql.read_text())
        assert metadata == json.loads((ROOT/'schemas'/f'{name}.json').read_text())
        tables += len(metadata['tables'])
        for table in metadata['tables']:
            assert (ROOT/'database'/name/'tables'/f'{table["name"]}.html').is_file()
        if name == 'nanoleaf':
            assert not any(t['foreignKeys'] for t in metadata['tables']), 'Invented Nanoleaf FK'
    assert tables == 28
    database_files = {str(p.relative_to(ROOT/'database')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'database').rglob('*') if p.is_file()}
    assert database_files == receipt['files'], 'SchemaSpy output differs from generation receipt'
    lock=json.loads((ROOT/'tools.json').read_text())
    assert hashlib.sha256((ROOT/lock['scalar']['asset']).read_bytes()).hexdigest() == lock['scalar']['sha256']
    assert (ROOT/'assets/SCALAR-LICENSE').stat().st_size > 1000
    assert not any(p.suffix in {'.sqlite','.db','.jar','.env'} for p in ROOT.rglob('*')), 'Unexpected runtime/build binary'
    documents={p.resolve():Links(p) for p in ROOT.rglob('*.html')}
    links=0
    for path, document in documents.items():
        assert '/tmp/' not in path.read_text() and '/home/' not in path.read_text(), f'Private build path in {path}'
        for href in document.targets:
            url = urlsplit(href)
            if url.scheme:
                assert url.scheme in {'https','data'}, f'Unexpected URL: {href}'
                continue
            assert not url.netloc and not url.path.startswith('/'), f'Nonportable reference: {href}'
            target = (path.parent/unquote(url.path)).resolve() if url.path else path
            assert target.is_file(), f'Broken reference: {path.relative_to(ROOT)} -> {href}'
            if url.fragment and target in documents:
                assert unquote(url.fragment) in documents[target].ids, f'Broken anchor: {href}'
            links += 1
    for path in (ROOT/'database').rglob('*.svg'):
        for node in ET.parse(path).iter():
            href=node.get('{http://www.w3.org/1999/xlink}href')
            if href:
                assert (path.parent/href).resolve().is_file(), f'Broken SVG link: {path}: {href}'
    print(f'PASS: 37 explicit operations, 28 empty-schema tables, {len(documents)} reference HTML pages and {links} local references; pins and asset receipts match.')


if __name__ == '__main__':
    check()
