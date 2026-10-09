"""Verify retained diagram definitions, source pins and generated artifact hashes."""
from pathlib import Path
import hashlib
import json
import architecture_diagrams as legacy

ROOT = Path(__file__).resolve().parent

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check():
    receipts = json.loads((legacy.ARCH / 'diagram-receipts.json').read_text())['diagrams']
    assert [d['id'] for d in legacy.DIAGRAMS] == [r['id'] for r in receipts]
    for definition, receipt in zip(legacy.DIAGRAMS, receipts):
        name = definition['id']
        spec = legacy.SPECS / f'{name}.json'
        assert spec.read_text() == legacy.spec_text(definition), f'{name}: definition drift'
        assert digest(spec) == receipt['specification']['sha256'], f'{name}: spec receipt'
        assert digest(legacy.RENDERED / f'{name}.svg') == receipt['svgSha256'], f'{name}: SVG receipt'
        assert digest(legacy.RENDERED / receipt['viewer']) == receipt['artifact']['sha256'], f'{name}: HTML receipt'
    provenance = json.loads((ROOT / 'current/provenance.json').read_text())
    for diagram in provenance['diagrams']:
        name = diagram['id']
        assert digest(ROOT / 'current' / f'{name}.json') == diagram['specificationSha256'], f'{name}: spec drift'
        assert digest(ROOT / 'current' / f'{name}.html') == diagram['artifactSha256'], f'{name}: HTML drift'
        assert all((ROOT.parents[1] / path).is_file() for path in diagram['sources']), f'{name}: missing source'
    print(f"PASS: {len(receipts)} dated diagrams and {len(provenance['diagrams'])} current sequences; hashes are not semantic proof.")


if __name__ == '__main__':
    check()
