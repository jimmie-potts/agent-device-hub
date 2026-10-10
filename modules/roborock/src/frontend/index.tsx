import React, { useEffect, useId, useMemo, useState } from 'react';
import type { FrontendApi, FrontendContext, FrontendContribution } from '@jimmie-potts/sdk/frontend';
import type { SyncedCopy } from '@jimmie-potts/sdk/remote';
import type { ErrorCode } from '@jimmie-potts/event-contracts/v2/errors';
import type { RunsPage, SamplesPage, VacuumStatus, Value } from '../contracts.js';
import { refusal, statusDocument, runsDocument, runDocument, samplesDocument, same, messageStatus, Refused, type RunDocument } from './documents.js';
const ROOT = '/modules/roborock/content/';
type StatusView = {
    api: FrontendApi;
    doc: VacuumStatus | undefined;
    live: boolean;
    error: ErrorCode | undefined;
};
function useStatus(context: FrontendContext, attempt: number): StatusView | undefined {
    const [view, setView] = useState<StatusView | undefined>();
    useEffect(() => {
        let stopped = false;
        let copy: SyncedCopy<VacuumStatus> | undefined;
        let doc: VacuumStatus | undefined;
        let expectedId: string | undefined;
        let live = false;
        let error: ErrorCode | undefined;
        const publish = (): void => {
            if (!stopped)
                setView({ api: context.api, doc, live, error });
        };
        const close = (): void => {
            if (copy !== undefined)
                void copy.close().catch(() => { });
        };
        const fail = (failure: unknown): void => {
            if (stopped)
                return;
            live = false;
            error = refusal(failure);
            publish();
        };
        const accept = (next: VacuumStatus): void => {
            if (stopped)
                return;
            if (doc !== undefined && next.revision < doc.revision)
                return;
            if (doc !== undefined
                && next.revision === doc.revision
                && !same(doc, next)) {
                throw new Refused('invalid-message');
            }
            expectedId = next.id;
            doc = next;
            error = undefined;
            publish();
        };
        publish();
        if (!context.connected || context.module !== 'roborock') {
            return () => { stopped = true; close(); };
        }
        void context.api.sync<VacuumStatus>(['roborock-vacuum'], change => {
            if (stopped)
                return;
            try {
                switch (change.type) {
                    case 'updated': {
                        const next = messageStatus(change.message, expectedId);
                        if (change.entity.family !== 'roborock-vacuum'
                            || change.entity.id !== next.id) {
                            throw new Refused('invalid-message');
                        }
                        accept(next);
                        break;
                    }
                    case 'synced':
                        live = true;
                        publish();
                        break;
                    case 'failed':
                        fail({ body: change.error });
                        break;
                    case 'removed':
                        if (change.entity.family !== 'roborock-vacuum')
                            break;
                        stopped = true;
                        setView({
                            api: context.api,
                            doc: undefined,
                            live: false,
                            error: 'not-found',
                        });
                        close();
                        break;
                }
            }
            catch (failure) {
                fail(failure);
            }
        }).then(async (result) => {
            if (result.status === 'rejected') {
                fail({ body: result.error });
                return;
            }
            if (stopped) {
                await result.copy.close();
                return;
            }
            copy = result.copy;
            const states = copy.states();
            const first = states[0];
            if (states.length !== 1 || first === undefined) {
                throw new Refused('invalid-message');
            }
            accept(messageStatus(first, expectedId));
            live = true;
            publish();
            const response = await context.api.read(`${ROOT}status`);
            if (!stopped)
                accept(statusDocument(response, expectedId));
        }).catch(fail);
        return () => { stopped = true; close(); };
    }, [context.api, context.connected, context.module, attempt]);
    return view?.api === context.api ? view : undefined;
}
type ReadView<T> = {
    api: FrontendApi;
    path: string;
    attempt: number;
    value: T | undefined;
    error: ErrorCode | undefined;
};
function useRead<T>(api: FrontendApi, path: string, attempt: number, decode: (value: unknown) => T): ReadView<T> | undefined {
    const [view, setView] = useState<ReadView<T> | undefined>();
    useEffect(() => {
        let stopped = false;
        setView({ api, path, attempt, value: undefined, error: undefined });
        void api.read(path).then(input => {
            if (stopped)
                return;
            const value = decode(input);
            if (!stopped)
                setView({ api, path, attempt, value, error: undefined });
        }).catch(error => {
            if (!stopped) {
                setView({ api, path, attempt, value: undefined, error: refusal(error) });
            }
        });
        return () => { stopped = true; };
    }, [api, path, attempt, decode]);
    return view?.api === api && view.path === path && view.attempt === attempt
        ? view
        : undefined;
}
function timestamp(value: number): string {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
        ? date.toISOString()
        : `${value} ms since Unix epoch (outside calendar display range)`;
}
function display(value: Value<number>, unit = ''): string {
    return value.status === 'known'
        ? `${value.value}${unit === '' ? '' : ` ${unit}`}`
        : 'unknown';
}
function Time({ value }: {
    value: Value<number>;
}): React.JSX.Element {
    if (value.status === 'unknown')
        return <>unknown</>;
    const text = timestamp(value.value);
    return Number.isFinite(new Date(value.value).getTime())
        ? <time dateTime={text} data-evidence-at={value.value}>{text}</time>
        : <span data-evidence-at={value.value}>{text}</span>;
}
function age(value: Value<number>, now: number, live: boolean): string {
    if (value.status === 'unknown')
        return 'Observation age: unknown.';
    if (now < value.value)
        return 'Observation age: unknown; clock comparison is unqualified.';
    const seconds = Math.floor((now - value.value) / 1000);
    return `Observation age: ${seconds} seconds${live ? '.' : '; status stream is stale.'}`;
}
function Refusal({ code }: {
    code: ErrorCode | undefined;
}): React.JSX.Element | null {
    return code === undefined ? null : <p role="alert">Read refused: {code}.</p>;
}
function Facts({ items }: {
    items: readonly (readonly [
        string,
        React.ReactNode
    ])[];
}): React.JSX.Element {
    return <dl>{items.map(([label, value]) => <React.Fragment key={label}>
    <dt>{label}</dt><dd style={{ overflowWrap: 'anywhere' }}>{value}</dd>
  </React.Fragment>)}</dl>;
}
function Pager({ kind, next, previous, onNext, onPrevious }: {
    kind: 'runs' | 'samples';
    next: Value<string>;
    previous: boolean;
    onNext: (cursor: string) => void;
    onPrevious: () => void;
}): React.JSX.Element {
    return <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
    <button disabled={!previous} onClick={onPrevious}>Previous {kind}</button>
    <button disabled={next.status !== 'known'} onClick={() => { if (next.status === 'known')
        onNext(next.value); }}>Next {kind}</button>
  </div>;
}
function Battery({ page, firstPage }: {
    page: SamplesPage;
    firstPage: boolean;
}): React.JSX.Element {
    const titleId = useId();
    const descriptionId = useId();
    const samples = [...page.samples].sort((a, b) => a.observedAtMs !== b.observedAtMs ? a.observedAtMs - b.observedAtMs : a.observationId.localeCompare(b.observationId));
    const first = samples[0];
    const last = samples[samples.length - 1];
    const start = first?.observedAtMs ?? 0;
    const span = Math.max(1, (last?.observedAtMs ?? start) - start);
    const x = (at: number): number => 42 + ((at - start) / span) * 606;
    const y = (battery: number): number => 160 - battery * 1.3;
    // Lines require the complete returned gap inventory. A paged window shows
    // points only, so an omitted gap cannot become a fabricated connecting line.
    const join = firstPage && page.next.status === 'unknown'
        && page.gaps.every(gap => gap.endAtMs.status === 'unknown' || gap.endAtMs.value >= gap.startAtMs);
    const segments: typeof samples[] = [];
    let segment: typeof samples = [];
    for (const sample of samples) {
        const previous = segment[segment.length - 1];
        const broken = previous !== undefined && page.gaps.some(gap => {
            const end = gap.endAtMs.status === 'known'
                ? gap.endAtMs.value
                : Number.POSITIVE_INFINITY;
            return gap.startAtMs <= sample.observedAtMs && end >= previous.observedAtMs;
        });
        if (broken && segment.length > 0) {
            segments.push(segment);
            segment = [];
        }
        segment.push(sample);
    }
    if (segment.length > 0)
        segments.push(segment);
    const lines = join ? segments.filter(points => points.length >= 2) : [];
    return <section aria-label="Battery evidence">
    <h3>Observed battery samples</h3>
    <p>Battery evidence: {samples.length === 0 ? 'missing on this page' : 'partial'}.
      {' '}Clock: unqualified. Missing intervals have no invented points.</p>
    {!join && samples.length > 0
            && <p>Samples are shown as separate points because the gap inventory is paged or incomplete.</p>}
    {samples.length > 0 && <svg viewBox="0 0 680 190" role="img" aria-labelledby={`${titleId} ${descriptionId}`} data-battery-segments={lines.length} style={{ display: 'block', width: '100%', maxWidth: 680 }}>
      <title id={titleId}>Observed battery percentage</title>
      <desc id={descriptionId}>
        Only observed samples are plotted. Lines stop across reported collection
        gaps. The tables below provide every plotted sample and returned gap.
        Device and collector clock alignment is unqualified.
      </desc>
      <line x1="42" y1="30" x2="42" y2="160" stroke="currentColor"/>
      <line x1="42" y1="160" x2="648" y2="160" stroke="currentColor"/>
      <text x="4" y="35" fill="currentColor" fontSize="12">100%</text>
      <text x="14" y="165" fill="currentColor" fontSize="12">0%</text>
      <text x="42" y="184" fill="currentColor" fontSize="12">Earlier observation</text>
      <text x="648" y="184" fill="currentColor" fontSize="12" textAnchor="end">Later observation</text>
      {lines.map(points => <polyline key={points[0]?.observationId} points={points.map(point => `${x(point.observedAtMs)},${y(point.batteryPercent)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2"/>)}
      {samples.map(sample => <circle key={sample.observationId} cx={x(sample.observedAtMs)} cy={y(sample.batteryPercent)} r="4" fill="currentColor"/>)}
    </svg>}
    <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
      <table>
        <caption>Observed battery samples on this page</caption>
        <thead><tr>
          <th scope="col">Observation</th>
          <th scope="col">Collector time</th>
          <th scope="col">Battery</th>
        </tr></thead>
        <tbody>{samples.map(sample => <tr key={sample.observationId}>
          <th scope="row">{sample.observationId}</th>
          <td>{timestamp(sample.observedAtMs)}</td>
          <td>{sample.batteryPercent}%</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
      <table>
        <caption>Collection gaps on this page</caption>
        <thead><tr>
          <th scope="col">Start</th>
          <th scope="col">End</th>
          <th scope="col">Reason</th>
        </tr></thead>
        <tbody>{page.gaps.map((gap, index) => <tr key={`${gap.startAtMs}-${index}`}>
          <th scope="row">{timestamp(gap.startAtMs)}</th>
          <td><Time value={gap.endAtMs}/></td>
          <td>{gap.reason}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {page.gaps.length === 0 && <p>No gaps were returned on this page. This does not establish complete coverage.</p>}
  </section>;
}
function Detail({ api, id, selected }: {
    api: FrontendApi;
    id: string;
    selected: number;
}): React.JSX.Element {
    const [attempt, setAttempt] = useState(0);
    const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
    const current = cursors[cursors.length - 1];
    const runPath = `${ROOT}run?recordId=${selected}`;
    const samplesPath = `${ROOT}samples?recordId=${selected}&limit=100`
        + (current === undefined ? '' : `&cursor=${encodeURIComponent(current)}`);
    const decodeRun = useMemo(() => (value: unknown): RunDocument => runDocument(value, id, selected), [id, selected]);
    const decodeSamples = useMemo(() => (value: unknown): SamplesPage => samplesDocument(value, id, selected), [id, selected]);
    const detail = useRead(api, runPath, attempt, decodeRun);
    const samples = useRead(api, samplesPath, attempt, decodeSamples);
    const run = detail?.value?.run;
    return <section aria-label="Run detail" data-selected-record={selected}>
    <h2>Run detail</h2>
    <Refusal code={detail?.error}/>
    {run === undefined
            ? <p role="status">Run measurements are {detail?.error === undefined ? 'loading' : 'unavailable'}.</p>
            : <>
        <h3>Run {run.recordId}</h3>
        <Facts items={[
                    ['Record observation', timestamp(run.observedAtMs)],
                    ['Robot start time', timestamp(run.startAtMs)],
                    ['Robot end time', <Time value={run.endAtMs}/>],
                    ['Reported duration', display(run.durationSeconds, 'seconds')],
                    ['Reported area', display(run.areaMm2, 'mm²')],
                    ['Reported cleaned area', display(run.cleanedAreaMm2, 'mm²')],
                    ['Error code', display(run.errorCode)],
                    ['Complete code', display(run.complete)],
                    ['Start type code', display(run.startType)],
                    ['Clean type code', display(run.cleanType)],
                    ['Finish reason code', display(run.finishReason)],
                    ['Avoid count', display(run.avoidCount)],
                    ['Wash count', display(run.washCount)],
                    ['Battery availability', run.battery.availability],
                    ['Associated observed samples', run.battery.samples],
                    ['Map availability', run.map.availability],
                    ['Map association reason', run.map.reason],
                ]}/>
        <p>Map coverage is unverified. Robot and collector clock alignment is unqualified.</p>
        <p>Reported duration and the two area measurements are independent vendor fields.</p>
      </>}
    <Refusal code={samples?.error}/>
    {samples?.value === undefined
            ? <p role="status">Battery evidence is {samples?.error === undefined ? 'loading' : 'unavailable'}.</p>
            : <>
        <Battery page={samples.value} firstPage={current === undefined}/>
        <Pager kind="samples" next={samples.value.next} previous={cursors.length > 1} onPrevious={() => { setCursors(value => value.slice(0, -1)); }} onNext={next => { setCursors(value => [...value, next]); }}/>
      </>}
    {(detail?.error !== undefined || samples?.error !== undefined)
            && <button onClick={() => { setAttempt(value => value + 1); }}>Reload run detail</button>}
  </section>;
}
function History({ api, id }: {
    api: FrontendApi;
    id: string;
}): React.JSX.Element {
    const [attempt, setAttempt] = useState(0);
    const [selected, setSelected] = useState<number | undefined>();
    const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
    const current = cursors[cursors.length - 1];
    const path = `${ROOT}runs?limit=25`
        + (current === undefined ? '' : `&cursor=${encodeURIComponent(current)}`);
    const decode = useMemo(() => (value: unknown): RunsPage => runsDocument(value, id), [id]);
    const result = useRead(api, path, attempt, decode);
    const page = result?.value;
    const clearSelection = (): void => { setSelected(undefined); };
    return <>
    <section aria-label="Run history">
      <h2>Run history</h2>
      <p>History is partial. These are retained records; the robot may no longer report every prior run.</p>
      <Refusal code={result?.error}/>
      {page === undefined
            ? <p role="status">Retained runs are {result?.error === undefined ? 'loading' : 'unavailable'}.</p>
            : <>
          {page.runs.length === 0
                    ? <p>No retained runs were returned on this page. History completeness is unknown.</p>
                    : <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
              <table>
                <caption>Retained runs on this page</caption>
                <thead><tr>
                  <th scope="col">Record</th>
                  <th scope="col">Robot start time</th>
                  <th scope="col">Reported duration</th>
                  <th scope="col">Reported area</th>
                  <th scope="col">Evidence</th>
                </tr></thead>
                <tbody>{page.runs.map(run => <tr key={run.recordId}>
                  <th scope="row">
                    <button data-record-id={run.recordId} aria-pressed={selected === run.recordId} onClick={() => { setSelected(run.recordId); }}>Inspect run {run.recordId}</button>
                  </th>
                  <td>{timestamp(run.startAtMs)}</td>
                  <td>{display(run.durationSeconds, 'seconds')}</td>
                  <td>{display(run.areaMm2, 'mm²')}</td>
                  <td>Battery {run.battery.availability}; map {run.map.availability}</td>
                </tr>)}</tbody>
              </table>
            </div>}
          <Pager kind="runs" next={page.next} previous={cursors.length > 1} onPrevious={() => {
                    clearSelection();
                    setCursors(value => value.slice(0, -1));
                }} onNext={next => {
                    clearSelection();
                    setCursors(value => [...value, next]);
                }}/>
        </>}
      <button onClick={() => {
            clearSelection();
            setAttempt(value => value + 1);
        }}>Reload run history</button>
    </section>
    {selected !== undefined
            && <Detail key={selected} api={api} id={id} selected={selected}/>}
  </>;
}
function Page({ context }: {
    context: FrontendContext;
}): React.JSX.Element {
    const [attempt, setAttempt] = useState(0);
    const [now, setNow] = useState(Date.now);
    const view = useStatus(context, attempt);
    const doc = view?.doc;
    const live = context.connected && view?.live === true;
    useEffect(() => {
        const timer = window.setInterval(() => { setNow(Date.now()); }, 1000);
        return () => { window.clearInterval(timer); };
    }, []);
    return <div style={{ minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>
    <section aria-label="Roborock observations">
      <h2>Roborock observations</h2>
      <Refusal code={view?.error}/>
      {doc === undefined ? <p role="status">Roborock observations are unknown.</p> : <>
        <p>Availability: {doc.availability}. Activity: {doc.activity}.</p>
        <p>Observed at: <Time value={doc.observedAtMs}/></p>
        <p data-observation-age>{age(doc.observedAtMs, now, live)}</p>
        <p>Observation age comes from the retained evidence timestamp, not service health.</p>
        <Facts items={[
                ['Battery', display(doc.status.batteryPercent, '%')],
                ['State code', display(doc.status.state)],
                ['Reported clean time', display(doc.status.cleanTimeSeconds, 'seconds')],
                ['Reported clean area', display(doc.status.cleanAreaMm2, 'mm²')],
                ['In-cleaning code', display(doc.status.inCleaning)],
                ['In-returning code', display(doc.status.inReturning)],
                ['Error code', display(doc.status.errorCode)],
                ['Dock error code', display(doc.status.dockErrorStatus)],
                ['Charge code', display(doc.status.chargeStatus)],
                ['Dust collection code', display(doc.status.dustCollectionStatus)],
                ['Water box code', display(doc.status.waterBoxStatus)],
                ['Water shortage code', display(doc.status.waterShortageStatus)],
                ['Wash code', display(doc.status.washStatus)],
                ['Wash phase code', display(doc.status.washPhase)],
                ['Dry code', display(doc.status.dryStatus)],
                ['Avoid count', display(doc.status.avoidCount)],
                ['Dock DSS raw code', display(doc.status.dss)],
            ]}/>
        <p>Vendor codes are reported without unqualified meaning labels.
          Docked counters may describe a previous run. Pause, wash, charge and
          unavailable input alone do not establish completion.</p>
        <h3>Measured consumable usage</h3>
        <p>Observed at: <Time value={doc.consumables.observedAtMs}/></p>
        <Facts items={[
                ['Main brush', display(doc.consumables.mainBrushSeconds, 'seconds')],
                ['Side brush', display(doc.consumables.sideBrushSeconds, 'seconds')],
                ['Filter', display(doc.consumables.filterSeconds, 'seconds')],
                ['Filter element', display(doc.consumables.filterElementSeconds, 'seconds')],
                ['Sensor dirty time', display(doc.consumables.sensorSeconds, 'seconds')],
                ['Strainer', display(doc.consumables.strainerCycles, 'cycles')],
                ['Dust collection', display(doc.consumables.dustCollectionCycles, 'cycles')],
                ['Cleaning brush', display(doc.consumables.cleaningBrushCycles, 'cycles')],
            ]}/>
        <p>These are measured usage counters. Remaining life and replacement dates are unknown.</p>
        <h3>Robot-reported totals</h3>
        <p>Observed at: <Time value={doc.totals.observedAtMs}/></p>
        <Facts items={[
                ['Clean time', display(doc.totals.cleanTimeSeconds, 'seconds')],
                ['Clean area', display(doc.totals.cleanAreaMm2, 'mm²')],
                ['Clean count', display(doc.totals.cleanCount)],
                ['Dust collection count', display(doc.totals.dustCollectionCount)],
                ['Retained runs', doc.collection.retainedRuns],
                ['Observed samples', doc.collection.observedSamples],
                ['Collection gaps', doc.collection.gaps],
                ['Last collection failure', doc.collection.lastFailure.status === 'known'
                        ? doc.collection.lastFailure.value
                        : 'unknown'],
            ]}/>
        <p>History: partial. Maps: unverified. Clock: unqualified.</p>
      </>}
      <button onClick={() => { setAttempt(value => value + 1); }}>Reload observations</button>
    </section>
    {doc !== undefined && context.connected
            && <History key={`${doc.id}-${attempt}`} api={context.api} id={doc.id}/>}
  </div>;
}
export const frontend: FrontendContribution = {
    module: 'roborock',
    pages: [{ id: 'status', Component: Page }],
};
