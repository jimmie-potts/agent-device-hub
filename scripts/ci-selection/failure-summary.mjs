// Publication boundary. Only the two fixed record files in this step's fresh private directory can be read.
// Their contents are untrusted: every displayed field goes through the public vocabulary, even if a test wrote the file.
import {appendFileSync, closeSync, constants, fstatSync, openSync, readSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {browserFields, nodeFields, suiteId} from './failure-fields.mts';

function readRecord(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 8192) return {};
    const data = Buffer.alloc(8193);
    const size = readSync(fd, data);
    if (size > 8192) return {};
    return JSON.parse(data.toString('utf8', 0, size)) ?? {};
  } catch {return {};}
  finally {if (fd !== undefined) closeSync(fd);}
}

export function renderFailure(kind, fallback, record) {
  if (kind === 'suite') return `### Test suite failure\n\nSuite: ${suiteId(fallback)}. Individual case and duration not observed.\n`;
  if (kind === 'browser') {
    const fields = browserFields(record);
    const journey = fields.journey === 'not observed' ? browserFields({journey: fallback}).journey : fields.journey;
    return ['### Browser test failure', '', '| Journey | Step | Condition | Last feed | Last copies |',
      '| --- | --- | --- | --- | --- |', `| ${journey} | ${fields.step} | ${fields.condition} | ${fields.feed} | ${fields.copies} |`, ''].join('\n');
  }
  const lines = ['### Node test failure', ''];
  const cases = Array.isArray(record.cases) ? record.cases.slice(0, 10) : [];
  if (!cases.length) lines.push('Case and duration not observed.');
  else {
    lines.push('| Suite | Module | Case ID | Result number | Declaration (line, column) | Duration (ms) |', '| --- | --- | --- | --- | --- | --- |');
    for (const item of cases) {
      const fields = nodeFields(item ?? {});
      const suite = fields.suite === 'not observed' ? suiteId(fallback) : fields.suite;
      const module = fields.module === 'not observed' && fields.fileNumber ? `file ${fields.fileNumber}` : fields.module;
      const position = fields.line && fields.column ? `${fields.line}, ${fields.column}` : 'not observed';
      lines.push(`| ${suite} | ${module} | ${fields.caseId ?? 'not observed'} | ${fields.ordinal ?? 'not observed'} | ${position} | ${fields.duration ?? 'not observed'} |`);
    }
    if (record.omitted === true || record.cases.length > 10) lines.push('', 'Additional failing cases omitted.');
  }
  return [...lines, ''].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.env.GITHUB_STEP_SUMMARY) {
  const [kind, fallback, directory] = process.argv.slice(2);
  if (kind === 'browser' || kind === 'node' || kind === 'suite') {
    const record = readRecord(join(directory, kind));
    const outer = kind === 'browser' ? readRecord(join(directory, 'entry')).journey : undefined;
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderFailure(kind, outer ?? fallback, record));
  }
}
