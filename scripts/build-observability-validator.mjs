import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {Ajv2020} from 'ajv/dist/2020.js';
import standalone from 'ajv/dist/standalone/index.js';

const root = new URL('../packages/observability/', import.meta.url);
const schema = JSON.parse(await readFile(new URL('src/record.schema.json', root), 'utf8'));
const ajv = new Ajv2020({strict: true, code: {source: true, esm: true}});
let code = standalone(ajv, ajv.compile(schema));
// Ajv's length helper is the only external runtime dependency in this schema.
const helper = 'require("ajv/dist/runtime/ucs2length").default';
code = code.replaceAll(helper, 'ucs2length');
if (code.includes('require(')) throw new Error('unexpected-validator-runtime-dependency');
code = 'const ucs2length = value => Array.from(value).length;\n' + code;
await mkdir(new URL('dist/', root), {recursive: true});
await writeFile(new URL('dist/validator.js', root), code);
