// Retained review evidence in the agent-skills#54 format: deliver-work's
// review reports (references/review-reports.md, references/github.md) holding
// review-work's result and reviewer returns (references/result-contract.md).
// An axis counts only through a complete retained return whose digest and
// provenance match the current comparison and whose own text states a
// satisfied verdict. Summary rows, gate lines, description sections and
// free-form summaries are the coordinator's words and never approve anything.
import { createHash } from 'node:crypto';

import { short } from './context.mjs';

export const REVIEW_FORMAT = 'jimmie-potts/agent-skills@5d03ee40d119ba432dca39c17345d4ae00d0c2d7';
export const POLICY_PATHS = ['AGENTS.md', 'CLAUDE.md', 'docs/sdlc.md'];

const MARKER = /^<!-- deliver-work (\S+) report final ([1-9]\d*)(?: part ([1-9]\d*)\/([1-9]\d*))?; head ([0-9a-f]{40}) -->$/;
const ROWS = ['Work', 'Round', 'Comparison', 'Requirements', 'Policy', 'Standards', 'Specification', 'Reviewers', 'Open findings'];
const RETURN_ROWS = ['Axis', 'Comparison', 'Requirements', 'Policy', 'Return', 'Digest', 'Redactions'];
const PROVENANCE = ['Comparison', 'Requirements', 'Policy'];
const AXES = ['standards', 'specification'];
const FINDING = /^- (\S+) \((P[0-3]), ([a-z]+), (unresolved|resolved|regression|accepted|deferred)\): /;
const WRAPPER = /^(?:<details>|<\/details>|<summary>.*<\/summary>)$/;

// Verdict phrases a reviewer return may state on a "Verdict:" line (any
// heading, list or bold markup). Anything else on such a line is not satisfied.
export const SATISFIED_VERDICTS = ['satisfied', 'approve', 'approved'];
const VERDICT_LINE = /^[\s>#*_`-]*verdict(?:\s*\([^)]*\))?[\s*_`]*[:\u2013\u2014-][\s*_`]*(.*)$/i;

/**
 * The verdict a reviewer's own return states: 'satisfied', 'not-satisfied' or
 * 'none'. Verdict lines decide when present, and every one must be satisfied.
 * Without one, the text must use the contract's `satisfied` and none of
 * `action-required`, `changes requested` or `not satisfied`.
 */
export function statedVerdict(text) {
  const lines = String(text).split('\n');
  const phrases = [];
  lines.forEach((line, index) => {
    const match = line.match(VERDICT_LINE);
    if (!match) return;
    let phrase = match[1];
    if (!phrase.trim()) phrase = lines.slice(index + 1).find(next => next.trim()) || '';
    phrases.push(phrase.replace(/[*_`]/g, '').split(/[.;,:(]| - /)[0].trim().toLowerCase().replace(/\s+/g, ' '));
  });
  if (phrases.length) return phrases.every(phrase => SATISFIED_VERDICTS.includes(phrase)) ? 'satisfied' : 'not-satisfied';
  const lower = String(text).toLowerCase();
  if (/\baction-required\b|\bchanges requested\b|\bnot satisfied\b|\bunsatisfied\b/.test(lower)) return 'not-satisfied';
  return /\bsatisfied\b/.test(lower) ? 'satisfied' : 'none';
}

function byTime(a, b) {
  return String(a.created_at).localeCompare(String(b.created_at)) || Number(a.id) - Number(b.id);
}

/**
 * Collect final-round reports published by the delivery's account.
 * Returns {rounds, ignored}; each round has {round, head, work, text, url, parts, problems}.
 */
export function collectReports(comments, publisher) {
  const byKey = new Map();
  const ignored = [];
  for (const item of [...comments].sort(byTime)) {
    const body = String(item.body || '').replace(/\r\n/g, '\n');
    const match = body.split('\n', 1)[0].trim().match(MARKER);
    if (!match) continue;
    if (!item.user || item.user.login !== publisher) {
      ignored.push({ url: item.html_url, author: item.user && item.user.login, reason: 'not published by the delivery account' });
      continue;
    }
    const [, work, round, part, parts, head] = match;
    const key = `${round}:${part || 1}/${parts || 1}`;
    if (byKey.has(key)) {
      ignored.push({ url: item.html_url, author: item.user.login, reason: `duplicate of ${byKey.get(key).url}` });
      continue;
    }
    byKey.set(key, { round: Number(round), part: Number(part || 1), parts: Number(parts || 1), work, head, url: item.html_url, text: body.slice(body.indexOf('\n') + 1) });
  }
  const grouped = new Map();
  for (const entry of byKey.values()) {
    if (!grouped.has(entry.round)) grouped.set(entry.round, []);
    grouped.get(entry.round).push(entry);
  }
  const rounds = [...grouped.entries()].sort((a, b) => a[0] - b[0]).map(([round, entries]) => {
    entries.sort((a, b) => a.part - b.part);
    const problems = [];
    const total = entries[0].parts;
    if (entries.some(entry => entry.parts !== total) || entries.length !== total || entries.some((entry, index) => entry.part !== index + 1)) {
      problems.push(`final ${round} is split into parts that are missing or inconsistent`);
    }
    if (new Set(entries.map(entry => entry.head)).size !== 1 || new Set(entries.map(entry => entry.work)).size !== 1) {
      problems.push(`final ${round} parts name different heads or work`);
    }
    return {
      round,
      head: entries[0].head,
      work: entries[0].work,
      url: entries[0].url,
      split: total > 1,
      text: entries.map(entry => entry.text).join('\n'),
      problems,
    };
  });
  return { rounds, ignored };
}

function tableRow(line) {
  if (!line.startsWith('| ') || !line.endsWith(' |')) return null;
  const cells = line.slice(2, -2).split(' | ');
  if (cells.length !== 2) return null;
  return [cells[0].trim(), cells[1].trim()];
}

function readTable(lines, start) {
  let index = start;
  while (index < lines.length && lines[index].trim() === '') index += 1;
  if (lines[index] !== '| Field | Value |' || lines[index + 1] !== '| --- | --- |') return { rows: null, next: index };
  index += 2;
  const rows = {};
  const order = [];
  while (index < lines.length && lines[index].startsWith('|')) {
    const row = tableRow(lines[index]);
    if (row && !(row[0] in rows)) {
      rows[row[0]] = row[1];
      order.push(row[0]);
    }
    index += 1;
  }
  return { rows, order, next: index };
}

const skippable = line => line.trim() === '' || WRAPPER.test(line.trim());

/** Parse one assembled report into its result and retained returns. */
export function parseReport(text, { split = false } = {}) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const problems = [];
  const gateLine = lines.find(line => line.startsWith('**Review gate for this comparison:**')) || null;
  const resultAt = lines.indexOf('## Review result');
  if (resultAt < 0) return { problems: ['no "## Review result" section'], returns: [], rows: {}, findings: [], gateLine };
  const { rows, order, next } = readTable(lines, resultAt + 1);
  if (!rows) return { problems: ['the review result has no field table'], returns: [], rows: {}, findings: [], gateLine };
  const missing = ROWS.filter(field => !(field in rows));
  if (missing.length) problems.push(`the review result is missing ${missing.join(', ')}`);
  if (order.join() !== ROWS.filter(field => field in rows).join()) problems.push('the review result rows are out of order');

  const findings = [];
  let index = next;
  const findingsAt = lines.indexOf('**Findings:**', index);
  if (findingsAt >= 0) {
    for (index = findingsAt + 1; index < lines.length && lines[index].trim() !== ''; index += 1) {
      const match = lines[index].match(FINDING);
      if (match) findings.push({ id: match[1], severity: match[2], axis: match[3], state: match[4] });
      else if (lines[index].trim() !== 'none') problems.push(`finding line ${findings.length + 1} is unreadable`);
    }
  } else {
    problems.push('no findings list');
  }

  const returns = [];
  for (; index < lines.length; index += 1) {
    const heading = lines[index].match(/^### Reviewer return: (.+)$/);
    if (!heading) continue;
    const label = heading[1].trim();
    const table = readTable(lines, index + 1);
    index = table.next;
    const entry = { label, rows: table.rows || {}, problems: [] };
    if (!table.rows) entry.problems.push('no field table');
    else if (table.order.join() !== RETURN_ROWS.join()) entry.problems.push('field rows missing or out of order');
    const body = [];
    let fenced = false;
    for (;;) {
      while (index < lines.length && skippable(lines[index])) index += 1;
      const open = index < lines.length && lines[index].match(/^(~{3,})text$/);
      if (!open || (fenced && !split)) break;
      const fence = open[1];
      index += 1;
      let closed = false;
      for (; index < lines.length; index += 1) {
        if (lines[index] === fence) {
          closed = true;
          index += 1;
          break;
        }
        if (lines[index].startsWith(fence)) entry.problems.push('a return line would close its fence');
        body.push(lines[index]);
      }
      if (!closed) {
        entry.problems.push('unterminated return fence');
        break;
      }
      fenced = true;
      if (!split) break;
    }
    index -= 1;
    if (!fenced) entry.problems.push('no fenced return');
    entry.text = body.length ? `${body.join('\n')}\n` : '';
    const digest = `sha256:${createHash('sha256').update(entry.text, 'utf8').digest('hex')}`;
    entry.digest = entry.rows.Digest || null;
    entry.digestVerified = fenced && entry.rows.Digest === digest;
    if (fenced && entry.rows.Digest && entry.rows.Digest !== digest) entry.problems.push('digest does not match its text');
    returns.push(entry);
  }
  return { rows, findings, returns, problems, gateLine };
}

function reviewerEntries(value) {
  if (!value || value === 'none') return [];
  return value.split('; ').map((entry, index) => {
    const match = entry.match(/^([a-z0-9]+(?:-[a-z0-9]+)*): ([a-z]+), requested /);
    return match ? { label: match[1], axis: match[2] } : { label: null, axis: null, index: index + 1 };
  });
}

export function comparisonRow({ base, head, mergeBase }) {
  return `base ${base}; head ${head}; merge-base ${mergeBase}`;
}

const COMPARISON = /^base ([0-9a-f]{40}); head ([0-9a-f]{40}); merge-base ([0-9a-f]{40})$/;

function describeComparison(value) {
  const match = String(value).match(COMPARISON);
  return match ? `base ${short(match[1])} head ${short(match[2])} merge-base ${short(match[3])}` : 'an unreadable comparison';
}

/** Parse "<reference> at <version>" into a GitHub issue reference when possible. */
export function requirementReference(value) {
  const match = String(value || '').match(/^(\S+) at (\S+)$/);
  if (!match) return null;
  const [, reference, version] = match;
  const ref = reference.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/)
    || reference.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d+)$/);
  return { reference, version, issue: ref ? { owner: ref[1], name: ref[2], number: Number(ref[3]) } : null };
}

/** Split a Policy row into this repository's revisions and other sources. */
export function policyComponents(value, repo) {
  const [owner, name] = repo.split('/');
  return String(value || '').split(' + ').map(part => {
    const match = part.match(/^(?:([\w.-]+)\/)?([\w.-]+)@([0-9a-f]{40})$/);
    if (match && match[2] === name && (!match[1] || match[1] === owner)) return { source: part, revision: match[3], local: true };
    return { source: part, local: false };
  });
}

/**
 * Judge the latest final round against the current comparison. Freshness of
 * requirements and policy needs reads, so the caller adds those reasons.
 */
export function judgeRound(round, { current, work }) {
  const reasons = [];
  const parsed = parseReport(round.text, { split: round.split });
  reasons.push(...round.problems, ...parsed.problems.map(problem => `final ${round.round}: ${problem}`));
  const { rows } = parsed;
  const expected = comparisonRow(current);
  if (round.head !== current.head) {
    reasons.push(`stale: final ${round.round} reviewed head ${short(round.head)}, current head is ${short(current.head)}`);
  } else if (rows.Comparison && rows.Comparison !== expected) {
    reasons.push(`stale: final ${round.round} reviewed comparison ${describeComparison(rows.Comparison)}; current comparison is ${describeComparison(expected)}`);
  }
  if (rows.Comparison && !rows.Comparison.includes(`head ${round.head};`)) reasons.push(`final ${round.round}: its marker head and Comparison row disagree`);
  if (rows.Round && rows.Round !== `final ${round.round}`) reasons.push(`final ${round.round}: its Round row says ${rows.Round}`);
  if (work && rows.Work && ![work.reference, work.url].includes(rows.Work)) {
    const named = /^[\w.-]+\/[\w.-]+#\d+$/.test(rows.Work) ? rows.Work : 'another work item';
    reasons.push(`final ${round.round} names work ${named}, not ${work.reference}`);
  }
  for (const axis of AXES) {
    const status = rows[axis[0].toUpperCase() + axis.slice(1)];
    if (status && status !== 'satisfied') reasons.push(`${axis} is ${status}`);
  }
  const counts = Object.fromEntries((rows['Open findings'] || '').split('; ').map(part => part.split(' ')).filter(pair => pair.length === 2));
  const openBlockers = parsed.findings.filter(finding => finding.severity !== 'P3' && ['unresolved', 'regression'].includes(finding.state));
  if (['P0', 'P1', 'P2'].some(level => Number(counts[level] || 0) > 0) || openBlockers.length) {
    reasons.push(`open P0-P2 findings: ${openBlockers.map(finding => `${finding.id} (${finding.severity})`).join(', ') || rows['Open findings']}`);
  }
  if (rows.Requirements === 'none') reasons.push('specification has no authoritative requirement');
  if (rows.Policy === 'unknown') reasons.push('the review policy is unknown');

  const entries = reviewerEntries(rows.Reviewers);
  for (const entry of entries) {
    if (!entry.label) reasons.push(`reviewer entry ${entry.index} is unreadable`);
    else if (entry.label.startsWith('coordinator')) reasons.push(`${entry.label}: a coordinator cannot fill an axis`);
    if (entry.axis === 'both') reasons.push(`${entry.label}: a final round needs separate axes`);
  }
  const returnLabels = parsed.returns.map(item => item.label);
  for (const entry of entries) {
    if (entry.label && !returnLabels.includes(entry.label)) reasons.push(`reviewer ${entry.label} has no retained return`);
  }
  for (const item of parsed.returns) {
    for (const problem of item.problems) reasons.push(`retained return ${item.label}: ${problem}`);
  }
  for (const axis of AXES) {
    const qualifying = parsed.returns.filter(item => {
      const entry = entries.find(candidate => candidate.label === item.label);
      return entry && entry.axis === axis && !entry.label.startsWith('coordinator')
        && item.rows.Axis === axis && item.rows.Return === 'complete' && item.digestVerified
        && item.problems.length === 0 && PROVENANCE.every(field => rows[field] !== undefined && item.rows[field] === rows[field]);
    });
    if (!qualifying.length) {
      reasons.push(`${axis}: no complete retained return matching this comparison, requirements and policy`);
      continue;
    }
    // The summary row never approves an axis; each qualifying return must state it.
    const unstated = qualifying.filter(item => statedVerdict(item.text) !== 'satisfied');
    if (unstated.length) {
      reasons.push(`${axis}: retained return ${unstated.map(item => item.label).join(', ')} does not itself state a satisfied verdict (${SATISFIED_VERDICTS.join(', ')}), whatever the summary row says`);
    }
  }
  const comparisonMatch = String(rows.Comparison || '').match(COMPARISON);
  return {
    reasons,
    rows,
    reviewedBase: comparisonMatch ? comparisonMatch[1] : null,
    returns: parsed.returns.map(item => ({
      label: item.label,
      axis: item.rows.Axis || null,
      return: item.rows.Return || null,
      verdict: statedVerdict(item.text),
      digest: item.digest,
      digestVerified: item.digestVerified,
      redactions: item.rows.Redactions || null,
    })),
    gateLine: parsed.gateLine,
  };
}
