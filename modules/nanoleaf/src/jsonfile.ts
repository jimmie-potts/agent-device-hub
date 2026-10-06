// Private JSON files of the installation, each replaced in one rename (jsonfile.py), and their readers.
import {chmodSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {parseJson, pyJsonIndented, withoutBom} from './compat.js';
import {ValueError} from './errors.js';

export type WriteJson = (path: string, value: unknown) => void;

export const writeJson: WriteJson = (path, value) => {
  const temporary = path + '.tmp';
  writeFileSync(temporary, pyJsonIndented(value) + '\n', {encoding: 'utf8', mode: 0o600});
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
};

/** Python's Path.read_text(): undecodable UTF-8 is a ValueError, as Python's UnicodeDecodeError is. */
export function readText(path: string, utf8Sig = false): string {
  const bytes = readFileSync(path);
  let text: string;
  try {
    text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    throw new ValueError("'utf-8' codec can't decode the file.");
  }
  return utf8Sig ? withoutBom(text) : text;
}

/** json.loads(path.read_text()), with Python's utf-8-sig codec when `utf8Sig` is set. */
export const readJson = (path: string, utf8Sig = false): unknown => parseJson(readText(path, utf8Sig));
