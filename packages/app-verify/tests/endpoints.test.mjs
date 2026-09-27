// Extra endpoints (1.1): other loopback listeners of the same application,
// announced in the ready line, recorded in the receipt, printed in the card,
// held to their ports across a relaunch and read by doctor's listener check.
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {validateReceipt} from '@jimmie-potts/app-verify';
import {refused, sandbox, supervisorSkipReason, units} from './helpers.mjs';

const skip = supervisorSkipReason();

test('extra endpoints are recorded, printed, given to steps and held to their ports across a reseed', {skip}, async () => {
  const box = await sandbox();
  try {
    const started = await box.cli(['start', '--scenario', 'endpoint', '--lease', '10']);
    assert.equal(started.code, 0, started.stderr);
    const {runId, url, port, endpoints} = started.result;
    const controller = endpoints.controller;
    const controllerPort = Number(new URL(controller).port);
    assert.match(controller, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.notEqual(controllerPort, port);
    assert.deepEqual(await (await fetch(controller)).json(), {controller: true, scenario: 'endpoint'});
    const receipt = await box.receipt(runId);
    assert.deepEqual(validateReceipt(receipt), {ok: true});
    assert.deepEqual(receipt.owned.endpoints, {controller});
    assert.equal(receipt.preview.url, url);
    assert.ok(started.result.card.includes(`Endpoint  controller ${controller}`), 'the card names the endpoint');
    assert.deepEqual((await box.events(runId)).find(e => e.event === 'ready').endpoints, {controller});

    const [row] = (await box.cli(['doctor', runId])).result.runs;
    assert.equal(row.state, 'running');
    assert.deepEqual(row.listener, {recorded: port, ports: [port, controllerPort].sort((a, b) => a - b), outcome: 'matches', endpoints: {controller: {port: controllerPort, outcome: 'matches'}}});
    const step = await box.cli(['capture', runId, 'controller-answers']);
    assert.equal(step.code, 0, step.stderr);

    // A reseed relaunches the endpoint on its recorded port.
    const reseeded = await box.cli(['scenario', runId, 'endpoint']);
    assert.equal(reseeded.code, 0, reseeded.stderr);
    assert.deepEqual(reseeded.result.endpoints, {controller});
    assert.deepEqual((await box.receipt(runId)).owned.endpoints, {controller});
    assert.equal((await box.cli(['capture', runId, 'controller-answers'])).code, 0);

    // A receipt naming an endpoint port the unit does not listen on is stale.
    const path = join(box.proofRoot, runId, 'receipt.json');
    const original = await readFile(path, 'utf8');
    const moved = JSON.parse(original);
    const elsewhere = controllerPort === 65535 ? 65534 : controllerPort + 1;
    moved.owned.endpoints.controller = `http://127.0.0.1:${elsewhere}/`;
    await writeFile(path, JSON.stringify(moved));
    const stale = (await box.cli(['doctor', runId])).result.runs[0];
    assert.equal(stale.state, 'stale');
    assert.deepEqual(stale.reasons, ['listener-mismatch']);
    assert.deepEqual(stale.listener.endpoints, {controller: {port: elsewhere, outcome: 'mismatch'}});
    await writeFile(path, original);
    assert.equal((await box.cli(['doctor', runId])).result.runs[0].state, 'running');

    // A relaunch that moves a recorded endpoint is a failed reset, never a silently changed address.
    const movedOn = await box.cli(['scenario', runId, 'endpoint-moves']);
    assert.equal(movedOn.code, 1);
    assert.equal(movedOn.result.cause, 'reset-failed');
    assert.match(movedOn.result.detail, new RegExp(`^port-changed: endpoint controller relaunched on port \\d+, expected ${controllerPort}`));
    assert.equal((await box.receipt(runId)).state, 'stopped');
    assert.deepEqual(units(box.app), []);
    assert.ok(await refused(controllerPort), 'the stopped run answers nothing on its endpoint');
  } finally {
    await box.close();
  }
});

test('an endpoint on an installed or reserved port fails the start with port-reserved and cleans up', {skip}, async () => {
  const box = await sandbox();
  try {
    // The fixture only names the installed port in its ready line; nothing binds or connects to it.
    const installed = await box.cli(['start', '--scenario', 'endpoint-announce'], {entry: await box.wrapper(box.repo, 'verify-installed.mjs', {announcePort: 8788})});
    assert.equal(installed.code, 1, installed.stderr);
    assert.equal(installed.result.cause, 'port-reserved');
    assert.equal(installed.result.detail, 'the application announced reserved port 8788 for endpoint controller');
    assert.equal(installed.result.cleanup.result, 'clean');

    const probe = createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const free = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const reserved = await box.cli(['start', '--scenario', 'endpoint-announce'], {entry: await box.wrapper(box.repo, 'verify-reserved.mjs', {announcePort: free, reservedPorts: [free]})});
    assert.equal(reserved.code, 1, reserved.stderr);
    assert.equal(reserved.result.cause, 'port-reserved');
    assert.equal(reserved.result.detail, `the application announced reserved port ${free} for endpoint controller`);
    assert.equal(reserved.result.cleanup.result, 'clean');
    assert.deepEqual(units(box.app), []);
    for (const result of [installed, reserved]) assert.equal('endpoints' in (await box.receipt(result.result.runId)).owned, false, 'a refused endpoint is never recorded');
  } finally {
    await box.close();
  }
});
