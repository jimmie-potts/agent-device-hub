import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import YAML from 'yaml';
import {imageIdentity} from '../build.mjs';
import {fetchJobs, resultOutcome} from '../finalize.mjs';
import {EXPECTED_JOB_NAMES} from '../qualification.mjs';

const sha = 'a'.repeat(40), digest = 'sha256:' + 'b'.repeat(64);
test('packaged artifact refuses wrong source, architecture, user and derivative identity', () => {
  const good = {Id: digest, Os: 'linux', Architecture: 'arm64', Config: {User: '1000:1000', Labels: {'org.opencontainers.image.revision': sha}}};
  assert.equal(imageIdentity(good, sha), digest);
  for (const mutate of [i => {i.Architecture = 'amd64';}, i => {i.Config.User = 'root';},
    i => {i.Config.Labels['org.opencontainers.image.revision'] = 'c'.repeat(40);}, i => {i.Id = 'mutable:tag';}]) {
    const bad = structuredClone(good); mutate(bad); assert.throws(() => imageIdentity(bad, sha), /release-image-refused/);
  }
  assert.throws(() => imageIdentity(good, sha, {derivative: true}), /release-image-refused/);
  good.Config.Labels['org.bunny.verify.portable'] = '1';
  assert.equal(imageIdentity(good, sha, {derivative: true}), digest);
});
test('coverage failure and unavailable evidence cannot report qualification', () => {
  const needs = Object.fromEntries(['pin', 'checks', 'workflow', 'image'].map(name => [name, {result: 'success'}]));
  const checks = EXPECTED_JOB_NAMES.map(name => ({name, result: 'success'}));
  assert.equal(resultOutcome(needs, checks, {}), 'qualified');
  assert.equal(resultOutcome(needs, checks.slice(1), {}), 'incomplete');
  assert.equal(resultOutcome(needs, checks, null), 'incomplete');
  needs.image.result = 'failure'; assert.equal(resultOutcome(needs, checks, null), 'failed');
  needs.image.result = 'cancelled'; assert.equal(resultOutcome(needs, checks, null), 'incomplete');
});
test('job readback fully paginates the exact attempt and refuses a truncated read', async () => {
  const calls = [];
  const options = {repository: 'jimmie-potts/agent-device-hub', runId: 10, runAttempt: 2, token: 'synthetic'};
  const jobs = await fetchJobs({...options, fetch: async url => {
    calls.push(url); return {ok: true, json: async () => ({total_count: 2, jobs: [calls.length]})};
  }});
  assert.deepEqual(jobs, [1, 2]);
  assert.match(calls[1], /runs\/10\/attempts\/2\/jobs\?per_page=100&page=2$/);
  await assert.rejects(fetchJobs({...options, fetch: async () => ({ok: true, json: async () => ({total_count: 2, jobs: []})})}), /release-jobs-incomplete/);
  await assert.rejects(fetchJobs({...options, fetch: async () => ({ok: false})}), /release-jobs-unavailable/);
});
test('qualification reuses all current coverage and native concurrency without weakening normal gates', async () => {
  const read = async name => YAML.parse(await readFile(new URL(`../../../.github/workflows/${name}`, import.meta.url), 'utf8'));
  const release = await read('release-qualification.yml'), checks = await read('checks.yml'), workflow = await read('workflow.yml');
  assert.deepEqual(Object.keys(release.on), ['workflow_dispatch']);
  assert.equal(release.concurrency['cancel-in-progress'], false);
  assert.equal(release.concurrency.group, 'bunny-release-qualification');
  for (const [key, child] of [['checks', checks], ['workflow', workflow]]) {
    assert.equal(release.jobs[key].uses, `./.github/workflows/${key === 'checks' ? 'checks' : 'workflow'}.yml`);
    assert.equal(release.jobs[key].with.qualification, true);
    assert.equal(child.on.workflow_call.inputs.qualification.default, false);
    assert.ok(child.on.pull_request);
    assert.ok(child.on.push);
  }
  assert.notEqual(checks.concurrency.group, workflow.concurrency.group, 'called workflows cannot cancel each other');
  assert.equal(checks.jobs.select.steps.at(-1).env.GITHUB_EVENT_NAME, "${{ inputs.qualification && 'release_qualification' || github.event_name }}");
  const names = ['Pin candidate'];
  for (const [key, child] of [['checks', checks], ['workflow', workflow]]) {
    for (const job of Object.values(child.jobs)) names.push(`${release.jobs[key].name} / ${job.name.replace('${{ matrix.os }}', 'ubuntu-latest')}`);
  }
  names.push(release.jobs.image.name);
  assert.deepEqual(names, EXPECTED_JOB_NAMES);
  assert.equal(release.jobs.image['runs-on'], 'ubuntu-24.04-arm');
  assert.match(release.jobs.pin.steps.at(-1).run, /git merge-base --is-ancestor/);
  assert.equal(release.jobs.result.if, 'always()');
});
