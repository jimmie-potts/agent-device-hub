import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EXPECTED_JOB_NAMES, qualificationArtifactNames, validateQualification, validateHostedQualification} from '../qualification.mjs';

const sha = 'a'.repeat(40), digest = 'sha256:' + 'b'.repeat(64), archiveSha256 = 'c'.repeat(64);
const expected = {repository: 'jimmie-potts/agent-device-hub', candidate: sha, imageId: digest, archiveSha256};
function fixture() {
  const jobs = EXPECTED_JOB_NAMES.map((name, index) => ({id: index + 1, name, status: 'completed', conclusion: 'success',
    head_sha: sha, run_id: 10, run_attempt: 1, started_at: '2026-11-01T12:00:00Z', completed_at: '2026-11-01T12:01:00Z'}));
  const names = qualificationArtifactNames(sha, 10, 1);
  const receipt = {schema: 'bunny-release-qualification/1.0', repository: expected.repository, candidate: sha, evaluationRevision: sha,
    runId: 10, runAttempt: 1, outcome: 'qualified', architecture: 'linux/arm64',
    evaluationInputs: {lockfile: 'd'.repeat(64), workflow: 'e'.repeat(64), checksWorkflow: 'f'.repeat(64), workflowWorkflow: '1'.repeat(64), dockerfile: '2'.repeat(64), verifyDockerfile: '3'.repeat(64)},
    image: {id: digest, revision: sha, archive: 'production-image.tar.gz', archiveSha256, artifactName: names.image},
    checks: jobs.map(j => ({id: j.id, name: j.name, result: j.conclusion, headSha: j.head_sha})),
    createdAt: '2026-11-01T12:02:00Z'};
  const hosted = {run: {id: 10, run_attempt: 1, head_sha: sha, event: 'workflow_dispatch', status: 'completed', conclusion: 'success',
    path: '.github/workflows/release-qualification.yml', repository: {full_name: expected.repository}}, jobs,
    artifacts: Object.values(names).map((name, index) => ({id: index + 20, name, expired: false, workflow_run: {id: 10, head_sha: sha}}))};
  return {receipt, hosted};
}

test('matching evidence and authentic hosted provenance qualifies the exact artifact', () => {
  const {receipt, hosted} = fixture();
  assert.equal(validateQualification(receipt, expected), receipt);
  assert.equal(validateHostedQualification(receipt, hosted, expected), receipt);
});
for (const [name, mutate] of [
  ['failed check', r => {r.checks[0].result = 'failure';}],
  ['missing check', r => {r.checks.pop();}],
  ['unexpected skip', r => {r.checks[0].result = 'skipped';}],
  ['wrong candidate', r => {r.candidate = '0'.repeat(40);}],
  ['wrong evaluation revision', r => {r.evaluationRevision = '0'.repeat(40);}],
  ['wrong image', r => {r.image.id = 'sha256:' + '0'.repeat(64);}],
  ['wrong image source', r => {r.image.revision = '0'.repeat(40);}],
  ['wrong archive', r => {r.image.archiveSha256 = '0'.repeat(64);}],
  ['wrong attempt', r => {r.runAttempt = 2;}],
  ['duplicate job', r => {r.checks[1] = r.checks[0];}],
  ['unqualified outcome', r => {r.outcome = 'failed';}],
  ['incomplete outcome', r => {r.outcome = 'incomplete';}],
  ['unrecognized field', r => {r.personal = 'not allowed';}],
]) test(`receipt refuses ${name}`, () => {
  const {receipt} = fixture(); mutate(receipt);
  assert.throws(() => validateQualification(receipt, expected), /qualification-refused/);
});
for (const [name, mutate] of [
  ['wrong workflow', h => {h.run.path = '.github/workflows/checks.yml';}],
  ['wrong repository', h => {h.run.repository.full_name = 'other/repo';}],
  ['wrong run revision', h => {h.run.head_sha = '0'.repeat(40);}],
  ['unfinished run', h => {h.run.status = 'in_progress';}],
  ['failed run', h => {h.run.conclusion = 'failure';}],
  ['PR run', h => {h.run.event = 'pull_request';}],
  ['new attempt', h => {h.run.run_attempt = 2;}],
  ['missing actual job', h => {h.jobs.pop();}],
  ['wrong job revision', h => {h.jobs[0].head_sha = '0'.repeat(40);}],
  ['failed actual job', h => {h.jobs[0].conclusion = 'failure';}],
  ['unfinished actual job', h => {h.jobs[0].status = 'in_progress';}],
  ['wrong actual job ID', h => {h.jobs[0].id = 999;}],
  ['missing image artifact', h => {h.artifacts.shift();}],
  ['expired artifact', h => {h.artifacts[0].expired = true;}],
  ['wrong artifact run', h => {h.artifacts[0].workflow_run.id = 11;}],
  ['duplicate artifact', h => {h.artifacts.push(h.artifacts[0]);}],
]) test(`hosted readback refuses ${name}`, () => {
  const {receipt, hosted} = fixture(); mutate(hosted);
  assert.throws(() => validateHostedQualification(receipt, hosted, expected), /qualification-refused/);
});
