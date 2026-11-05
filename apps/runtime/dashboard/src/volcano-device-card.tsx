import React, {useMemo} from 'react';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {FrontendContext} from '@jimmie-potts/sdk/frontend';
import {VolcanoWidget} from '@jimmie-potts/volcano/frontend';
import type {DashboardConnection} from './connection.ts';
import {ModuleFrontend} from './module-page.tsx';

/** The saved source names the selected device. The module owns its observations and its one command, the session threshold. */
export function VolcanoDeviceCard({target, label, connection, live, control, operations, operationsLive}: {
  target: string; label?: string | undefined; connection: DashboardConnection; live: boolean; control: boolean; operations: readonly OperationRecord[]; operationsLive: boolean;
}): React.JSX.Element {
  const Component = useMemo(() => function SelectedVolcano({context}: {context: FrontendContext}): React.JSX.Element {
    return <VolcanoWidget context={context} expectedTarget={target} label={label}/>;
  }, [target, label]);
  return <ModuleFrontend module="volcano" Component={Component} connection={connection} connected={live} control={control} operations={operations} operationsLive={operationsLive}/>;
}
