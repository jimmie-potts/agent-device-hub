import {useEffect, useState} from 'react';
import type {FrontendApi, FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {SyncedCopy} from '@jimmie-potts/sdk/remote';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import type {VacuumStatus} from '../contracts.js';
import {refusal, statusDocument, same, messageStatus, Refused} from './documents.js';
const ROOT = '/modules/roborock/content/';
export type StatusView = {
    target: string | undefined;
    module: string;
    api: FrontendApi;
    doc: VacuumStatus | undefined;
    live: boolean;
    error: ErrorCode | undefined;
};
export function useStatus(context: FrontendContext, attempt: number, target?: string): StatusView | undefined {
    const [view, setView] = useState<StatusView | undefined>();
    useEffect(() => {
        let stopped = false;
        let copy: SyncedCopy<VacuumStatus> | undefined;
        let doc: VacuumStatus | undefined;
        let expectedId = target;
        let conflict = false;
        let live = false;
        let error: ErrorCode | undefined;
        const publish = (): void => {
            if (!stopped)
                setView({ api: context.api, target, module: context.module, doc, live: live && !conflict, error });
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
                conflict = true;
                throw new Refused('invalid-message');
            }
            if (expectedId !== undefined && next.id !== expectedId) {
                conflict = true;
                throw new Refused('invalid-message');
            }
            if (conflict) throw new Refused('invalid-message');
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
                            api: context.api, target, module: context.module,
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
    }, [context.api, context.connected, context.module, attempt, target]);
    return view?.api === context.api && view.target === target && view.module === context.module ? view : undefined;
}
type ReadView<T> = {
    api: FrontendApi;
    decode: (value: unknown) => T;
    path: string;
    attempt: number;
    value: T | undefined;
    error: ErrorCode | undefined;
};
export function useRead<T>(api: FrontendApi | undefined, path: string, attempt: number, decode: (value: unknown) => T): ReadView<T> | undefined {
    const [view, setView] = useState<ReadView<T> | undefined>();
    useEffect(() => {
        let stopped = false;
        if (api === undefined) {setView(undefined); return;}
        setView({ api, decode, path, attempt, value: undefined, error: undefined });
        void api.read(path).then(input => {
            if (stopped)
                return;
            const value = decode(input);
            if (!stopped)
                setView({ api, decode, path, attempt, value, error: undefined });
        }).catch(error => {
            if (!stopped) {
                setView({ api, decode, path, attempt, value: undefined, error: refusal(error) });
            }
        });
        return () => { stopped = true; };
    }, [api, path, attempt, decode]);
    return view?.api === api && view?.decode === decode && view.path === path && view.attempt === attempt
        ? view
        : undefined;
}
