#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {appendFile, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {EXPECTED_JOB_NAMES, REPOSITORY, qualificationArtifactNames, validateQualification} from './qualification.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const inputs = {lockfile: 'package-lock.json', workflow: '.github/workflows/release-qualification.yml',
  checksWorkflow: '.github/workflows/checks.yml', workflowWorkflow: '.github/workflows/workflow.yml',
  dockerfile: 'deploy/container/Dockerfile', verifyDockerfile: 'deploy/container/Dockerfile.verify'};
async function fetchCollection({repository, runId, runAttempt, token, fetch = globalThis.fetch}, kind) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const path = kind === 'jobs' ? `${runId}/attempts/${runAttempt}/jobs` : `${runId}/artifacts`;
    const response = await fetch(`https://api.github.com/repos/${repository}/actions/runs/${path}?per_page=100&page=${page}`,
      {headers: {authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28'}});
    if (!response.ok) throw new Error(`release-${kind}-unavailable`);
    const data = await response.json();
    if (!Array.isArray(data[kind]) || !Number.isSafeInteger(data.total_count)) throw new Error(`release-${kind}-unavailable`);
    items.push(...data[kind]);
    if (items.length >= data.total_count) return items;
    if (data[kind].length === 0 || page >= 100) throw new Error(`release-${kind}-incomplete`);
  }
}
export const fetchJobs = options => fetchCollection(options, 'jobs');
export const fetchArtifacts = options => fetchCollection(options, 'artifacts');
export function imageArtifactPresent(artifacts, {candidate, runId, runAttempt}) {
  const name = qualificationArtifactNames(candidate, runId, runAttempt).image;
  const matches = artifacts.filter(artifact => artifact.name === name);
  return matches.length === 1 && Number.isSafeInteger(matches[0].id) && matches[0].id > 0
    && matches[0].expired === false && matches[0].workflow_run?.id === runId
    && matches[0].workflow_run?.head_sha === candidate;
}
export function resultOutcome(needs, checks, image, artifactPresent = false) {
  const outcomes = ['pin', 'checks', 'workflow', 'image'].map(name => needs?.[name]?.result);
  if (outcomes.includes('failure') || checks.some(check => ['failure', 'timed_out', 'action_required'].includes(check.result))) return 'failed';
  if (outcomes.some(result => result !== 'success') || !image || !artifactPresent || checks.length !== EXPECTED_JOB_NAMES.length
    || checks.some(check => check.result !== 'success')) return 'incomplete';
  return 'qualified';
}
export async function finalize(destination, env = process.env, fetch = globalThis.fetch) {
  const candidate = env.GITHUB_SHA, runId = Number(env.GITHUB_RUN_ID), runAttempt = Number(env.GITHUB_RUN_ATTEMPT);
  const names = qualificationArtifactNames(candidate, runId, runAttempt);
  if (env.GITHUB_REPOSITORY !== REPOSITORY || !destination) throw new Error('release-finalization-refused');
  const evaluationInputs = Object.fromEntries(await Promise.all(Object.entries(inputs).map(async ([key, path]) =>
    [key, createHash('sha256').update(await readFile(root + path)).digest('hex')])));
  let actualJobs = [], artifacts = [];
  try {
    const options = {repository: REPOSITORY, runId, runAttempt, token: env.GITHUB_TOKEN, fetch};
    [actualJobs, artifacts] = await Promise.all([fetchJobs(options), fetchArtifacts(options)]);
  }
  catch { /* An unavailable authoritative read stays incomplete, never successful. */ }
  const checks = EXPECTED_JOB_NAMES.flatMap(name => actualJobs.filter(job => job.name === name).map(job =>
    ({id: job.id, name, result: job.status === 'completed' && job.run_id === runId && job.run_attempt === runAttempt ? job.conclusion : 'incomplete', headSha: job.head_sha})));
  let image = null;
  try {image = {...JSON.parse(env.RELEASE_IMAGE), artifactName: names.image};}
  catch { /* A failed image build has no promotable artifact. */ }
  const receipt = {schema: 'bunny-release-qualification/1.0', repository: REPOSITORY, candidate, evaluationRevision: candidate,
    runId, runAttempt, outcome: resultOutcome(JSON.parse(env.RELEASE_NEEDS), checks, image, imageArtifactPresent(artifacts, {candidate, runId, runAttempt})), architecture: 'linux/arm64',
    evaluationInputs, image, checks, createdAt: new Date().toISOString()};
  if (receipt.outcome === 'qualified') {
    try {validateQualification(receipt, {repository: REPOSITORY, candidate});}
    catch {receipt.outcome = 'incomplete';}
  }
  await writeFile(destination, JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY,
    `### Release ${receipt.outcome}\n\nCandidate: \`${candidate}\`\n\nRun: ${runId}, attempt ${runAttempt}. Evidence binds only this candidate.\n`);
  return receipt;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  finalize(process.argv[2]).then(receipt => {if (receipt.outcome !== 'qualified') process.exitCode = 1;}, () => {
    process.stderr.write('release-finalization-incomplete\n'); process.exitCode = 1;
  });
}
