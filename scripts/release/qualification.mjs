// Release receipts are promotion inputs, not authority. Consumers also verify the authentic hosted run and artifacts.
export const REPOSITORY = 'jimmie-potts/agent-device-hub';
export const WORKFLOW_PATH = '.github/workflows/release-qualification.yml';
export const EXPECTED_JOB_NAMES = Object.freeze([
  'Pin candidate',
  'Source coverage / Select affected checks',
  'Source coverage / Build, lint and core tests on ubuntu-latest',
  'Source coverage / Firmware host tests and ARM build on ubuntu-latest',
  'Source coverage / App verification on ubuntu-latest',
  'Source coverage / Runtime verification on ubuntu-latest',
  'Source coverage / Selected checks gate',
  'Workflow coverage / Workflow checks on ubuntu-latest',
  'Workflow coverage / Retained documentation checks',
  'Packaged ARM64 image',
]);
const SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/, IMAGE = /^sha256:[a-f0-9]{64}$/;
const positive = v => Number.isSafeInteger(v) && v > 0;
const refuse = () => {throw new Error('qualification-refused');};
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
export function qualificationArtifactNames(candidate, runId, runAttempt) {
  if (!SHA.test(candidate) || !positive(runId) || !positive(runAttempt)) refuse();
  const identity = `${candidate}-${runId}-${runAttempt}`;
  return {image: `release-image-${identity}`, evidence: `release-evidence-${identity}`};
}

export function validateQualification(receipt, expected) {
  if (!keys(receipt, ['schema', 'repository', 'candidate', 'evaluationRevision', 'runId', 'runAttempt', 'outcome',
    'architecture', 'evaluationInputs', 'image', 'checks', 'createdAt'])
    || receipt.schema !== 'bunny-release-qualification/1.0' || receipt.repository !== REPOSITORY
    || receipt.repository !== expected.repository || !SHA.test(receipt.candidate) || receipt.candidate !== expected.candidate
    || receipt.evaluationRevision !== receipt.candidate || !positive(receipt.runId) || !positive(receipt.runAttempt)
    || receipt.outcome !== 'qualified' || receipt.architecture !== 'linux/arm64'
    || typeof receipt.createdAt !== 'string' || !Number.isFinite(Date.parse(receipt.createdAt))) refuse();
  if (!keys(receipt.evaluationInputs, ['lockfile', 'workflow', 'checksWorkflow', 'workflowWorkflow', 'dockerfile', 'verifyDockerfile'])
    || !Object.values(receipt.evaluationInputs).every(v => typeof v === 'string' && HASH.test(v))) refuse();
  const image = receipt.image;
  if (!keys(image, ['id', 'revision', 'archive', 'archiveSha256', 'artifactName']) || !IMAGE.test(image.id)
    || image.revision !== receipt.candidate || image.archive !== 'production-image.tar.gz' || !HASH.test(image.archiveSha256)
    || image.artifactName !== qualificationArtifactNames(receipt.candidate, receipt.runId, receipt.runAttempt).image
    || expected.imageId !== undefined && image.id !== expected.imageId
    || expected.archiveSha256 !== undefined && image.archiveSha256 !== expected.archiveSha256) refuse();
  if (!Array.isArray(receipt.checks) || receipt.checks.length !== EXPECTED_JOB_NAMES.length) refuse();
  const ids = new Set();
  for (const name of EXPECTED_JOB_NAMES) {
    const matches = receipt.checks.filter(c => c?.name === name);
    if (matches.length !== 1) refuse();
    const check = matches[0];
    if (!keys(check, ['id', 'name', 'result', 'headSha']) || !positive(check.id) || ids.has(check.id)
      || check.result !== 'success' || check.headSha !== receipt.candidate) refuse();
    ids.add(check.id);
  }
  return receipt;
}

export function validateHostedQualification(receipt, hosted, expected) {
  validateQualification(receipt, expected);
  const {run, jobs, artifacts} = hosted;
  if (!run || run.id !== receipt.runId || run.run_attempt !== receipt.runAttempt || run.head_sha !== receipt.candidate
    || run.repository?.full_name !== receipt.repository || run.path !== WORKFLOW_PATH
    || !['workflow_dispatch', 'push'].includes(run.event) || run.status !== 'completed' || run.conclusion !== 'success') refuse();
  if (!Array.isArray(jobs) || !Array.isArray(artifacts)) refuse();
  for (const check of receipt.checks) {
    const matches = jobs.filter(job => job.name === check.name);
    if (matches.length !== 1) refuse();
    const job = matches[0];
    if (job.id !== check.id || job.run_id !== receipt.runId || job.run_attempt !== receipt.runAttempt
      || job.head_sha !== receipt.candidate || job.status !== 'completed' || job.conclusion !== 'success') refuse();
  }
  for (const name of Object.values(qualificationArtifactNames(receipt.candidate, receipt.runId, receipt.runAttempt))) {
    const matches = artifacts.filter(artifact => artifact.name === name);
    if (matches.length !== 1 || !positive(matches[0].id) || matches[0].expired !== false
      || matches[0].workflow_run?.id !== receipt.runId || matches[0].workflow_run?.head_sha !== receipt.candidate) refuse();
  }
  return receipt;
}
