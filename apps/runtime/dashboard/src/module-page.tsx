import React, {useEffect, useMemo} from 'react';
import type {FrontendContext, FrontendContribution, FrontendUi} from '@jimmie-potts/sdk/frontend';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {DashboardConnection} from './connection.ts';
import {moduleView, type ModuleEntry, type ModulePage} from './modules.ts';
import {Badge, Facts, InfoTip, Select} from './ui.tsx';
import {Command} from './command-control.tsx';

const ui: FrontendUi = {Badge, Facts, InfoTip, Select, Command};
type Props = {
  module: ModuleEntry; page: ModulePage; frontends: readonly FrontendContribution[]; connection: DashboardConnection;
  connected: boolean; control: boolean; operations: readonly OperationRecord[]; operationsLive: boolean;
};

/** Mount only the contribution chosen by the current authenticated catalog and the static browser build. */
export function ModulePageView(props: Props): React.JSX.Element {
  const view = moduleView(props.module, props.page.id, props.frontends);
  if (!props.connected || view === undefined || view.kind === 'unavailable') return <p role="status">This module page is unavailable.</p>;
  if (view.kind === 'frame') return <iframe className="module-page" title={props.page.title} src={view.path}
    sandbox={view.trusted ? undefined : 'allow-same-origin'}/>;
  return <ModuleFrontend module={props.module.name} connection={props.connection} connected={props.connected} control={props.control}
    operations={props.operations} operationsLive={props.operationsLive} Component={view.Component}/>;
}

/** The same shell-owned scope serves a module page or a fixed module widget. */
export function ModuleFrontend({module, connection, Component, connected, control, operations, operationsLive}: {
  module: string; connection: DashboardConnection; connected: boolean; control: boolean;
  operations: readonly OperationRecord[]; operationsLive: boolean;
  Component: FrontendContribution['pages'][number]['Component'];
}): React.JSX.Element {
  const scope = useMemo(() => connection.openModule(module), [connection, module]);
  useEffect(() => () => { void scope.close(); }, [scope]);
  const context: FrontendContext = {module, api: scope.api, ui, connected, control, operations, operationsLive};
  return <Component context={context}/>;
}
