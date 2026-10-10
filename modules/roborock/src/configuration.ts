import { errorBody, type ErrorBody } from '@jimmie-potts/event-contracts/v2';
import type { Configured } from '@jimmie-potts/sdk';
export type RoborockConfig = {
    id: string;
};
export function configureRoborock(section: unknown, synthetic = false): Configured<RoborockConfig> | ErrorBody {
    const refuse = (): ErrorBody => errorBody('invalid-request', { detail: 'Roborock requires a routing id and its named private target/session files' });
    if (typeof section !== 'object' || section === null || Array.isArray(section))
        return refuse();
    const v = section as Record<string, unknown>;
    if (Object.keys(v).some(k => !['id', 'secrets'].includes(k)) || typeof v.id !== 'string' || v.id.length > 128 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.id))
        return refuse();
    if (!synthetic) {
        if (typeof v.secrets !== 'object' || v.secrets === null || Array.isArray(v.secrets))
            return refuse();
        const secrets = v.secrets as Record<string, unknown>;
        if (Object.keys(secrets).length !== 2 || !['target', 'session'].every(k => typeof secrets[k] === 'string' && secrets[k].startsWith('/')))
            return refuse();
    }
    else if (v.secrets !== undefined)
        return refuse();
    return { config: { id: v.id }, devices: [v.id] };
}
