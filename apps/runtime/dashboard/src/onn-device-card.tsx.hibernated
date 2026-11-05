import React, {useMemo} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {OnnWidget} from '@jimmie-potts/onn/frontend';
import type {DashboardConnection} from './connection.ts';
import {ModuleFrontend} from './module-page.tsx';

/** Home supplies its selected identity; the module remains the authoritative status/command owner. */
export function OnnDeviceCard({record, owner, live, control, operations, operationsLive, connection}: {
  record: DeviceRecord; owner: string; live: boolean; control: boolean; operations: readonly OperationRecord[];
  operationsLive: boolean; connection: DashboardConnection;
}): React.JSX.Element {
  const target = record.id, label = record.label ?? 'ONN TV';
  const Component = useMemo(() => function SelectedOnn({context}: {context: FrontendContext}): React.JSX.Element {
    return <OnnWidget context={context} expectedTarget={target} label={label}/>;
  }, [target, label]);
  return <ModuleFrontend module="onn" Component={Component} connection={connection} connected={live && owner === 'bunny/modules/onn' && record.kind === 'onn'}
    control={control} operations={operations} operationsLive={operationsLive}/>;
}
