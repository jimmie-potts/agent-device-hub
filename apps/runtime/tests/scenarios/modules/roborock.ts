import type { RunsPage, VacuumStatus } from '@jimmie-potts/roborock';
import { act, answers, bodyOf, deviceState, expect, holds, noToken, refusedWith, running, type Harness, type Scenario, } from '../framework.js';
const OWNER = 'bunny/modules/roborock';
const ROOT = '/modules/roborock/content/';
const status = (h: Harness): VacuumStatus | undefined => h.reader.states<VacuumStatus>('roborock-vacuum', OWNER)[0]?.data;
const calls = (h: Harness): readonly string[] => deviceState<{
    calls: string[];
}>(h, 'roborock').calls;
const safe = (text: string): boolean => !['owner_note', 'Synthetic private', 'base64', 'blobHash', 'sessionPath'].some(value => text.includes(value));
async function mcpStatus(h: Harness): Promise<VacuumStatus | undefined> {
    const version = '2025-11-25';
    const headers = {accept: 'application/json, text/event-stream'};
    const initialized = await h.gateway({as: 'reader', method: 'POST', path: '/mcp', headers, body: {
        jsonrpc: '2.0', id: 1, method: 'initialize', params: {
            protocolVersion: version, capabilities: {}, clientInfo: {name: 'roborock-synthetic', version: '1'},
        },
    }});
    const session = initialized.headers['mcp-session-id'];
    if (initialized.status !== 200 || session === undefined) return undefined;
    const admitted = {...headers, 'mcp-session-id': session, 'mcp-protocol-version': version};
    try {
        await h.gateway({as: 'reader', method: 'POST', path: '/mcp', headers: admitted,
            body: {jsonrpc: '2.0', method: 'notifications/initialized'}});
        const called = await h.gateway({as: 'reader', method: 'POST', path: '/mcp', headers: admitted,
            body: {jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'roborock_status', arguments: {}}}});
        if (called.status !== 200 || !safe(called.text)) return undefined;
        return bodyOf<{result?: {structuredContent?: {data?: {result?: VacuumStatus}}}}>(called)
            ?.result?.structuredContent?.data?.result;
    } finally {
        await h.gateway({as: 'reader', method: 'DELETE', path: '/mcp', headers: admitted});
    }
}
export const scenarios: readonly Scenario[] = [{
        id: 'roborock-observations',
        title: 'read-only Roborock observations preserve private history across unavailable input and restart',
        seed: {
            modules: ['core', 'roborock'],
            follows: [{ owner: OWNER, families: ['device', 'roborock-vacuum'] }],
            sections: { roborock: { id: 'vacuum' } },
        },
        steps: [
            expect('core and registered Roborock module run', h => running(h, ['core', 'roborock'])),
            expect('first actual poll publishes qualified availability with partial history', h => {
                const value = status(h);
                return value?.availability === 'available' && value.collection.retainedRuns >= 4
                    && value.observedAtMs.status === 'known' && value.observedAtMs.value <= h.now()
                    && value.collection.history === 'partial' && value.collection.maps === 'unverified'
                    && value.collection.clock === 'unqualified' || 'initial observation differs';
            }),
            ...Array.from({ length: 7 }, (_, index) => [
                act('host requests another synthetic reconciliation cycle', h => { h.simulate({ device: 'roborock', action: 'online' }); }),
                expect('bounded reconciliation eventually retains all requested records', h => (status(h)?.collection.retainedRuns ?? 0) >= Math.min(30, (index + 2) * 4)
                    || 'record queue did not advance'),
            ]).flat(),
            expect('content and sync serve the same selected public status', answers({ as: 'reader', method: 'GET', path: ROOT + 'status' }, answer => {
                const value = bodyOf<VacuumStatus>(answer);
                return answer.status === 200 && value?.id === 'vacuum' && value.schema === 'roborock-vacuum/2.0'
                    && value.collection.retainedRuns === 30 && safe(answer.text) || 'public content differs';
            })),
            expect('read-scoped MCP returns the same retained status projection', async h => {
                const value = await mcpStatus(h);
                return value !== undefined && JSON.stringify(value) === JSON.stringify(status(h))
                    || 'MCP and synced status differ';
            }),
            expect('bounded archive pages have disjoint membership', async (h) => {
                const firstAnswer = await h.gateway({ as: 'reader', method: 'GET', path: ROOT + 'runs?limit=25' });
                const first = bodyOf<RunsPage>(firstAnswer);
                if (firstAnswer.status !== 200 || first?.runs.length !== 25 || first.next.status !== 'known')
                    return 'first page differs';
                const secondAnswer = await h.gateway({ as: 'reader', method: 'GET', path: ROOT + 'runs?limit=25&cursor=' + encodeURIComponent(first.next.value) });
                const second = bodyOf<RunsPage>(secondAnswer);
                return secondAnswer.status === 200 && second?.runs.length === 5 && second.next.status === 'unknown'
                    && second.runs.every(run => !first.runs.some(previous => previous.recordId === run.recordId))
                    && [...first.runs, ...second.runs].every(run => run.battery.availability === 'missing' && run.map.availability === 'missing')
                    && safe(firstAnswer.text) && safe(secondAnswer.text) || 'archive membership or missing evidence differs';
            }),
            expect('unknown query keys refuse without private fields', answers({ as: 'reader', method: 'GET', path: ROOT + 'runs?owner_note=private' }, answer => refusedWith(answer, 400, 'invalid-request') === true && safe(answer.text) || 'query was not refused safely')),
            expect('unauthenticated content is refused', answers({ as: 'anonymous', method: 'GET', path: ROOT + 'status' }, answer => refusedWith(answer, 401, 'unauthenticated'))),
            expect('another origin cannot read through a browser session', answers({ as: 'browser', method: 'GET', path: ROOT + 'status', origin: 'other' }, answer => refusedWith(answer, 403, 'forbidden'))),
            expect('reader cannot send device commands', answers({ as: 'reader', method: 'POST', path: '/api/v2/commands/power-set', body: { target: 'vacuum', data: { on: true } } }, answer => refusedWith(answer, 403, 'forbidden'))),
            act('vendor temporarily becomes unavailable', h => { h.simulate({ device: 'roborock', action: 'offline' }); }),
            expect('unavailable input preserves retained history and original observation time', h => {
                const value = status(h);
                return value?.availability === 'unavailable' && value.collection.retainedRuns === 30
                    && value.observedAtMs.status === 'known' && value.collection.gaps > 0 || 'unavailable state erased evidence';
            }),
            act('vendor recovers with an empty history summary', async (h) => {
                h.simulate({ device: 'roborock', action: 'empty-history' });
                await h.wait(10);
                h.simulate({ device: 'roborock', action: 'online' });
            }),
            expect('recovered empty summary never deletes retained records', h => status(h)?.availability === 'available' && status(h)?.collection.retainedRuns === 30 || 'recovery erased retained history'),
            act('runtime restarts on its own private database', h => h.restart()),
            expect('restart retains public history and records a collection gap', h => status(h)?.availability === 'available' && status(h)?.collection.retainedRuns === 30
                && (status(h)?.collection.gaps ?? 0) > 0 || 'restart lost history or gap'),
            holds('inspection and restart issue only read operations', h => calls(h).every(name => ['status', 'consumables', 'summary', 'record', 'rooms', 'map'].includes(name))
                && !calls(h).includes('map') || 'unexpected control or historical map read', 100),
            expect('published projections and runtime credentials remain private', async (h) => await noToken(h) === true && h.published().filter(({ message }) => message.source === OWNER)
                .every(({ message }) => safe(JSON.stringify(message.data))) || 'publication contains private original fields'),
        ],
    }];
