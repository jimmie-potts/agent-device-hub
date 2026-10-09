// Concise text form of a preflight report. The JSON form is the report object.
import { short } from './context.mjs';

const TAGS = { satisfied: 'ok', unresolved: 'unresolved', 'read-failure': 'read-failure', 'not-applicable': 'n/a' };
const MAX_REASONS = 8;

function summary(gate) {
  const e = gate.evidence || {};
  switch (gate.id) {
    case 'ci-pr':
    case 'ci-main':
      if (Array.isArray(e.jobs)) {
        const passed = e.jobs.filter(job => job.result === 'success').length;
        return `${passed} of ${e.expected.length} expected jobs succeeded at ${short(e.revision)} (${e.event})`;
      }
      return '';
    case 'review':
      if (!e.round) return '';
      return `${e.round} ${e.report}; returns: ${(e.returns || []).map(r => `${r.label} ${r.return}${r.digestVerified ? '' : ' (digest unverified)'}`).join(', ')}`;
    case 'proof':
      return (e.receipts || []).map(r => `${r.runId} at ${short(r.sourceRevision)}, ${r.sha256sums || 'no SHA256SUMS'}`).join('; ');
    case 'counterparts':
      return (e.items || []).map(item => `${item.ref} ${item.state}`).join(', ');
    default:
      return '';
  }
}

export function renderText(report) {
  const lines = [];
  const c = report.candidate;
  const title = c ? `${c.repository}#${c.pr} (${c.state}${c.draft ? ', draft' : ''})` : `PR #${report.declared.pr}`;
  lines.push(`Delivery preflight  ${title}  ${report.result.toUpperCase()}`);
  if (c) {
    lines.push(`  head ${c.head}`);
    lines.push(`  base ${c.base || 'unknown'} (${c.baseRef})  merge-base ${c.mergeBase || 'unknown'}`);
    if (c.mergeCommit) lines.push(`  merged as ${c.mergeCommit}`);
    lines.push(`  ${c.url}`);
  }
  lines.push(`  finish line ${report.finishLine}; read at ${report.readAt}`);
  lines.push('');
  for (const gate of report.gates) {
    const detail = summary(gate);
    lines.push(`[${TAGS[gate.status]}] ${gate.title}${detail ? ` - ${detail}` : ''}`);
    const limit = gate.status === 'satisfied' || gate.status === 'not-applicable' ? 3 : MAX_REASONS;
    for (const reason of gate.reasons.slice(0, limit)) lines.push(`    ${reason}`);
    if (gate.reasons.length > limit) lines.push(`    ... ${gate.reasons.length - limit} more in --json`);
  }
  lines.push('');
  const open = report.gates.filter(gate => gate.status === 'unresolved' || gate.status === 'read-failure').map(gate => gate.id);
  lines.push(`Result: ${report.result}${open.length ? ` (${open.join(', ')})` : ''}; exit ${report.exitCode}.`);
  lines.push(report.notice);
  return `${lines.join('\n')}\n`;
}
