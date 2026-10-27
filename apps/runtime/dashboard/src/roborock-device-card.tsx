import React, {useMemo} from 'react';
import type {FrontendContext} from '@jimmie-potts/sdk/frontend';
import {RoborockWidget} from '@jimmie-potts/roborock/frontend';
import type {DashboardConnection} from './connection.ts';
import {ModuleFrontend} from './module-page.tsx';

/** The saved Home source names the selected robot. The module owns all observations. */
export function RoborockDeviceCard({target, label, connection, live}: {
  target: string; label?: string | undefined; connection: DashboardConnection; live: boolean;
}): React.JSX.Element {
  const Component = useMemo(() => function SelectedRoborock({context}: {context: FrontendContext}): React.JSX.Element {
    return <RoborockWidget context={context} expectedTarget={target} label={label}/>;
  }, [target, label]);
  return <ModuleFrontend module="roborock" Component={Component} connection={connection} connected={live} control={false} operations={[]} operationsLive={false}/>;
}
