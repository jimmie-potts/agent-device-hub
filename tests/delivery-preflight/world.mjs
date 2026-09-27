// Deterministic GitHub state and proof directories for the delivery preflight.
// A world starts as one fully evidenced source candidate; each scenario changes
// one fact so the preflight must report that gate as unresolved.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const REPO = 'jimmie-potts/agent-device-hub';
export const OWNER = 'jimmie-potts';
export const PR = 700;
export const ISSUE = 496;
export const fakeSha = label => createHash('sha1').update(label).digest('hex');
export const BASE = fakeSha('main-before');
export const HEAD = fakeSha('candidate-head');
export const OLD_HEAD = fakeSha('candidate-earlier');
export const MERGE = fakeSha('squash-merge');
export const NEWER_MAIN = fakeSha('main-after-another-merge');
export const POLICY = fakeSha('policy-sources');
export const GUIDE_HTML = Buffer.from('<!doctype html><title>Guide</title>\n');
export const sha256 = data => createHash('sha256').update(data).digest('hex');

export const EXPECTED_JOBS = [
  'Checks / Workflow checks on ubuntu-latest',
  'Checks / Contracts and state Python 3.12 on ubuntu-latest',
  'Checks / Contracts and state Python 3.14 on ubuntu-latest',
  'Checks / MCP on ubuntu-latest',
  'Checks / Dashboard browser and contracts on ubuntu-latest',
  'Work guide / Work guide build and browser checks',
];

const workflowFiles = Object.fromEntries(['ci.yml', 'work-guide.yml'].map(file => [
  file, fs.readFileSync(path.join(root, '.depot/workflows', file), 'utf8'),
]));

let nextId = 1000;
const id = () => (nextId += 1);

export function checkRun(name, sha, suite, overrides = {}) {
  return {
    id: id(),
    name,
    head_sha: sha,
    status: 'completed',
    conclusion: 'success',
    started_at: '2026-09-27T07:00:00Z',
    completed_at: '2026-09-27T07:05:00Z',
    details_url: `https://depot.dev/orgs/example/workflows/run?job=${name.length}`,
    html_url: `https://github.com/${REPO}/runs/${nextId}`,
    app: { slug: 'depot-code-access' },
    check_suite: { id: suite },
    output: { annotations_count: 0 },
    ...overrides,
  };
}

export function suite(suiteId, sha, branch, overrides = {}) {
  return {
    id: suiteId,
    head_sha: sha,
    head_branch: branch,
    app: { slug: 'depot-code-access' },
    repository: { full_name: REPO },
    ...overrides,
  };
}

// ---- #54 review reports (agent-skills@5d03ee40d119ba432dca39c17345d4ae00d0c2d7) ----

export function comparison(base = BASE, head = HEAD, mergeBase = base) {
  return `base ${base}; head ${head}; merge-base ${mergeBase}`;
}

export const REQUIREMENTS = `${REPO}#${ISSUE} at 2026-09-27T06:00:00Z`;
export const POLICY_ROW = `${REPO}@${POLICY}`;

export function reviewerReturn({ label, axis, ret = 'complete', text, comparisonRow, requirements = REQUIREMENTS, policy = POLICY_ROW, digest }) {
  const body = text ?? `${axis} review of the candidate.\n\nVerdict: satisfied.\n\nBlocking findings: none.\n\nCoverage: the whole comparison.\n`;
  const computed = `sha256:${sha256(Buffer.from(body, 'utf8'))}`;
  return [
    '<details>',
    `<summary>Reviewer return: ${label}</summary>`,
    '',
    `### Reviewer return: ${label}`,
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Axis | ${axis} |`,
    `| Comparison | ${comparisonRow} |`,
    `| Requirements | ${requirements} |`,
    `| Policy | ${policy} |`,
    `| Return | ${ret} |`,
    `| Digest | ${digest ?? computed} |`,
    '| Redactions | none |',
    '',
    `~~~text\n${body}~~~`,
    '',
    '</details>',
  ].join('\n');
}

export function reviewReport({
  round = 1, head = HEAD, base = BASE, mergeBase = base, work = `${REPO}#${ISSUE}`,
  standards = 'satisfied', specification = 'satisfied', requirements = REQUIREMENTS, policy = POLICY_ROW,
  openFindings = 'P0 0; P1 0; P2 0; P3 0', findings = 'none', returns,
} = {}) {
  const comparisonRow = comparison(base, head, mergeBase);
  const reviewers = returns ?? [
    { label: 'standards-reviewer-1', axis: 'standards' },
    { label: 'specification-reviewer-1', axis: 'specification' },
  ];
  const entries = reviewers.map(r => `${r.label}: ${r.axis}, requested opus at default, model unknown (unknown), level unknown (unknown)`).join('; ');
  const gate = standards === 'satisfied' && specification === 'satisfied' ? 'satisfied' : 'not satisfied';
  return [
    `<!-- deliver-work ${work} report final ${round}; head ${head} -->`,
    `**Review gate for this comparison:** ${gate}`,
    '',
    '## Review result',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Work | ${work} |`,
    `| Round | final ${round} |`,
    `| Comparison | ${comparisonRow} |`,
    `| Requirements | ${requirements} |`,
    `| Policy | ${policy} |`,
    `| Standards | ${standards} |`,
    `| Specification | ${specification} |`,
    `| Reviewers | ${entries} |`,
    `| Open findings | ${openFindings} |`,
    '',
    '**Findings:**',
    findings,
    '',
    '**Coverage:** Both axes covered the whole comparison.',
    '',
    ...reviewers.map(r => reviewerReturn({ comparisonRow, requirements, policy, ...r })),
  ].join('\n');
}

export function comment(body, overrides = {}) {
  const commentId = id();
  return {
    id: commentId,
    user: { login: OWNER },
    created_at: '2026-09-27T07:10:00Z',
    body,
    html_url: `https://github.com/${REPO}/pull/${PR}#issuecomment-${commentId}`,
    issue_url: `https://api.github.com/repos/${REPO}/issues/${PR}`,
    ...overrides,
  };
}

// ---- The clean world ----

export function cleanWorld() {
  const prSuite = 9001;
  const world = {
    pr: {
      number: PR,
      state: 'open',
      merged: false,
      draft: false,
      user: { login: OWNER },
      head: { sha: HEAD, ref: 'claude/gh-700-example', repo: { full_name: REPO } },
      base: { sha: BASE, ref: 'main', repo: { full_name: REPO } },
      body: `Refs #${ISSUE}`,
      mergeable_state: 'clean',
      merge_commit_sha: null,
      merged_at: null,
      html_url: `https://github.com/${REPO}/pull/${PR}`,
    },
    refs: { main: BASE },
    files: [
      { filename: 'scripts/delivery-preflight.mjs', status: 'added' },
      { filename: 'docs/development.md', status: 'modified' },
    ],
    prCommits: [OLD_HEAD, HEAD],
    compares: {},
    workflows: { [HEAD]: { ...workflowFiles }, [MERGE]: { ...workflowFiles } },
    blobs: {},
    checkRuns: { [HEAD]: EXPECTED_JOBS.map(name => checkRun(name, HEAD, prSuite)) },
    checkSuites: { [HEAD]: [suite(prSuite, HEAD, 'claude/gh-700-example')] },
    annotations: {},
    branchRules: [],
    comments: [comment(reviewReport())],
    reviews: [],
    threads: [],
    closingIssues: [],
    issues: {
      [`${REPO}#${ISSUE}`]: { state: 'open', state_reason: null, lastEditedAt: '2026-09-26T22:15:10Z', blockedBy: [
        { repository_url: `https://api.github.com/repos/${REPO}`, number: 493, state: 'closed', state_reason: 'completed', html_url: `https://github.com/${REPO}/issues/493` },
        { repository_url: `https://api.github.com/repos/${OWNER}/agent-skills`, number: 54, state: 'closed', state_reason: 'completed', html_url: `https://github.com/${OWNER}/agent-skills/issues/54` },
      ] },
    },
    pulls: {},
    commits: {},
    failures: [],
    requests: [],
  };
  world.compares[`${BASE}...${HEAD}`] = { status: 'ahead', merge_base_commit: { sha: BASE }, files: world.files };
  world.compares[`${POLICY}...${BASE}`] = { status: 'ahead', merge_base_commit: { sha: POLICY }, files: [{ filename: 'README.md', status: 'modified' }] };
  return world;
}

/** Declare the delivery the way the CLI does. */
export function declaration(overrides = {}) {
  return { repo: REPO, pr: PR, finishLine: 'source', counterparts: [], receipts: [], ...overrides };
}

/** Turn the world into a merged PR with successful main CI for the squash commit. */
export function mergeWorld(world) {
  const mainSuite = 9002;
  Object.assign(world.pr, { state: 'closed', merged: true, merge_commit_sha: MERGE, merged_at: '2026-09-27T07:30:00Z', mergeable_state: 'unknown' });
  world.refs.main = MERGE;
  world.commits[MERGE] = { sha: MERGE, parents: [{ sha: BASE }], files: world.files };
  world.checkRuns[MERGE] = EXPECTED_JOBS.map(name => checkRun(name, MERGE, mainSuite));
  world.checkSuites[MERGE] = [suite(mainSuite, MERGE, 'main')];
  return world;
}

// ---- Fake transport ----

function page(items) {
  return { status: 200, link: null, json: items };
}

function issueLike(world, repo, number) {
  const key = `${repo}#${number}`;
  if (world.pulls[key]) {
    return { number, state: world.pulls[key].state, state_reason: null, pull_request: {}, html_url: `https://github.com/${repo}/pull/${number}` };
  }
  const issue = world.issues[key];
  if (!issue) return null;
  return { number, state: issue.state, state_reason: issue.state_reason, html_url: `https://github.com/${repo}/issues/${number}` };
}

/** A transport that answers from the world and records every request it receives. */
export function fakeTransport(world) {
  return async ({ method, url, body }) => {
    world.requests.push({ method, url, body });
    const route = url.replace('https://api.github.com', '');
    for (const failure of world.failures) {
      if (failure.match.test(route) || (body && failure.match.test(body.query))) {
        if (failure.status) return { status: failure.status, link: null, json: { message: failure.message || 'Service Unavailable' } };
        throw new Error(failure.message || 'getaddrinfo ENOTFOUND api.github.com');
      }
    }
    if (method === 'POST' && route === '/graphql') return graphql(world, body);
    const [pathname, query = ''] = route.split('?');
    const params = new URLSearchParams(query);
    let m;
    const repoPath = `/repos/${REPO}`;
    if (pathname === `${repoPath}/pulls/${PR}`) return { status: 200, json: { ...world.pr, changed_files: world.pr.changed_files ?? world.files.length } };
    if (pathname === `${repoPath}/pulls/${PR}/files`) return page(world.files);
    if (pathname === `${repoPath}/pulls/${PR}/commits`) return page(world.prCommits.map(sha => ({ sha })));
    if (pathname === `${repoPath}/pulls/${PR}/reviews`) return page(world.reviews);
    if (pathname === `${repoPath}/issues/${PR}/comments`) return page(world.comments);
    if ((m = pathname.match(/^\/repos\/[^/]+\/[^/]+\/git\/ref\/heads\/(.+)$/))) {
      const sha = world.refs[m[1]];
      return sha ? { status: 200, json: { object: { sha } } } : { status: 404, json: { message: 'Not Found' } };
    }
    if ((m = pathname.match(/^\/repos\/[^/]+\/[^/]+\/compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)$/))) {
      const found = world.compares[`${m[1]}...${m[2]}`];
      return found ? { status: 200, json: found } : { status: 404, json: { message: 'Not Found' } };
    }
    if ((m = pathname.match(/^\/repos\/[^/]+\/[^/]+\/contents\/\.depot\/workflows$/))) {
      const files = world.workflows[params.get('ref')];
      if (!files) return { status: 404, json: { message: 'Not Found' } };
      return { status: 200, json: Object.keys(files).map(name => ({ type: 'file', name, path: `.depot/workflows/${name}` })) };
    }
    if ((m = pathname.match(/^\/repos\/[^/]+\/[^/]+\/contents\/\.depot\/workflows\/(.+)$/))) {
      const text = world.workflows[params.get('ref')]?.[m[1]];
      if (text === undefined) return { status: 404, json: { message: 'Not Found' } };
      return { status: 200, json: { type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64') } };
    }
    if ((m = pathname.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/))) {
      const blob = world.blobs[`${params.get('ref')}:${m[1]}`];
      if (!blob) return { status: 404, json: { message: 'Not Found' } };
      return { status: 200, json: { type: 'file', sha: sha256(blob).slice(0, 40), size: blob.length, encoding: 'none', content: '' } };
    }
    if ((m = pathname.match(/^\/repos\/[^/]+\/[^/]+\/git\/blobs\/([0-9a-f]+)$/))) {
      const blob = Object.values(world.blobs).find(data => sha256(data).slice(0, 40) === m[1]);
      return blob ? { status: 200, json: { encoding: 'base64', content: blob.toString('base64') } } : { status: 404, json: { message: 'Not Found' } };
    }
    if ((m = pathname.match(/^\/repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]{40})\/check-runs$/))) {
      const runs = world.checkRuns[m[1]] || [];
      return { status: 200, link: null, json: { total_count: runs.length, check_runs: runs } };
    }
    if ((m = pathname.match(/^\/repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]{40})\/check-suites$/))) {
      const suites = world.checkSuites[m[1]] || [];
      return { status: 200, link: null, json: { total_count: suites.length, check_suites: suites } };
    }
    if ((m = pathname.match(/^\/repos\/[^/]+\/[^/]+\/check-runs\/(\d+)\/annotations$/))) return page(world.annotations[m[1]] || []);
    if ((m = pathname.match(/^\/repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]{40})$/))) {
      const commit = world.commits[m[1]];
      return commit ? { status: 200, json: commit } : { status: 404, json: { message: 'Not Found' } };
    }
    if ((m = pathname.match(/^\/repos\/[^/]+\/[^/]+\/rules\/branches\/(.+)$/))) return page(world.branchRules);
    if ((m = pathname.match(/^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/dependencies\/blocked_by$/))) {
      return page(world.issues[`${m[1]}#${m[2]}`]?.blockedBy || []);
    }
    if ((m = pathname.match(/^\/repos\/([^/]+\/[^/]+)\/issues\/comments\/(\d+)$/))) {
      const found = world.comments.find(item => String(item.id) === m[2]);
      return found ? { status: 200, json: found } : { status: 404, json: { message: 'Not Found' } };
    }
    if ((m = pathname.match(/^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/))) {
      const found = issueLike(world, m[1], Number(m[2]));
      return found ? { status: 200, json: found } : { status: 404, json: { message: 'Not Found' } };
    }
    if ((m = pathname.match(/^\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/))) {
      const found = world.pulls[`${m[1]}#${m[2]}`];
      return found ? { status: 200, json: found } : { status: 404, json: { message: 'Not Found' } };
    }
    return { status: 404, json: { message: `No fixture for ${method} ${route}` } };
  };
}

function graphql(world, body) {
  const { query, variables = {} } = body;
  if (/reviewThreads/.test(query)) {
    return { status: 200, json: { data: { repository: { pullRequest: {
      closingIssuesReferences: { nodes: world.closingIssues.map(number => ({ number, repository: { nameWithOwner: REPO } })) },
      reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: world.threads },
    } } } } };
  }
  if (/lastEditedAt/.test(query)) {
    const issue = world.issues[`${variables.owner}/${variables.name}#${variables.number}`];
    if (!issue) return { status: 200, json: { data: { repository: { issue: null } } } };
    return { status: 200, json: { data: { repository: { issue: {
      lastEditedAt: issue.lastEditedAt, createdAt: '2026-09-26T22:08:05Z', state: issue.state.toUpperCase(),
    } } } } };
  }
  return { status: 200, json: { errors: [{ message: 'unknown fixture query' }] } };
}

// ---- Proof directories (docs/app-verification.md receipt, app-verification/1) ----

export function writeProof(directory, { runId = 'hub-20260927T070000Z-3f9a1c', sourceRevision = HEAD, dirty = false, state = 'stopped', frozen = true, captures, checks, failure = null, tamper = false } = {}) {
  const proofDir = path.join(directory, runId);
  fs.mkdirSync(path.join(proofDir, 'verified', 'capture-1'), { recursive: true });
  const verifiedCaptures = captures ?? [{ n: 1, step: 'task-appears', set: 'verified', outcome: 'passed', screenshot: 'verified/capture-1/after.png', video: 'verified/capture-1/interaction.webm' }];
  const receipt = {
    receiptVersion: 'app-verification/1',
    runId,
    app: 'hub',
    repository: REPO,
    roots: { proof: '<canonical checkout>/.local/evidence/verify', runtime: '~/.local/state/app-verify' },
    state,
    startedAt: '2026-09-27T07:00:00Z',
    build: { sourceRevision, dirty, artifactDigest: `sha256:${'1'.repeat(64)}`, version: '0.4.0' },
    scenario: { name: 'lifecycle-basic', version: sourceRevision, seededAt: '2026-09-27T07:00:02Z' },
    components: [
      { id: 'hub', kind: 'actual' },
      { id: 'dashboard', kind: 'actual' },
      { id: 'wall-controller', kind: 'simulated' },
    ],
    checks: checks ?? [{ id: 'readiness', outcome: 'passed' }],
    captures: verifiedCaptures,
    preview: null,
    owned: { unit: `app-verify-${runId}.service`, leaseTimer: `app-verify-${runId}-lease.timer`, port: 41705, runtimeDir: runId, proofDir: runId },
    proof: { frozenAt: frozen ? '2026-09-27T07:05:00Z' : null },
    failure,
    cleanup: { result: 'clean' },
    secrets: 'none recorded',
  };
  fs.writeFileSync(path.join(proofDir, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  if (frozen) {
    fs.writeFileSync(path.join(proofDir, 'verified', 'capture-1', 'after.png'), Buffer.from('png-bytes'));
    fs.writeFileSync(path.join(proofDir, 'verified', 'capture-1', 'interaction.webm'), Buffer.from('webm-bytes'));
    fs.writeFileSync(path.join(proofDir, 'verified', 'receipt.json'), `${JSON.stringify({ ...receipt, proof: { frozenAt: null } }, null, 2)}\n`);
    const files = ['capture-1/after.png', 'capture-1/interaction.webm', 'receipt.json'];
    const sums = files.map(file => `${sha256(fs.readFileSync(path.join(proofDir, 'verified', file)))}  ${file}`).join('\n');
    fs.writeFileSync(path.join(proofDir, 'verified', 'SHA256SUMS'), `${sums}\n`);
    if (tamper) fs.writeFileSync(path.join(proofDir, 'verified', 'capture-1', 'after.png'), Buffer.from('changed'));
  }
  return proofDir;
}

/** The guide browser check's receipt (docs/work-guide/work/check_guide.cjs) and its retained files. */
export function writeGuideEvidence(directory, { html = GUIDE_HTML, errors = [], screenshots = true, print = true, overrides = {} } = {}) {
  const folder = path.join(directory, 'guide-check');
  fs.mkdirSync(folder, { recursive: true });
  const receipt = {
    checkedAt: '2026-09-27T07:20:00Z',
    htmlSha256: sha256(html),
    htmlBytes: html.length,
    issueStatusAndEvidence: 'passed',
    navigation: 'passed',
    printExpansionAndRestoration: 'passed',
    errors,
    consoleErrors: [],
    ...overrides,
  };
  fs.writeFileSync(path.join(folder, 'guide-verification.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  if (screenshots) fs.writeFileSync(path.join(folder, 'guide-status-overview.png'), Buffer.from('png'));
  if (print) fs.writeFileSync(path.join(folder, 'guide-print-check.pdf'), Buffer.from('pdf'));
  return path.join(folder, 'guide-verification.json');
}
