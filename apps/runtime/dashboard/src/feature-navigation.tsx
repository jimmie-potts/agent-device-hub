import React from 'react';
import {categoryOf, hardwareModule, moduleLabel} from './directory.ts';
import {contextModule, featureNavigation} from './feature-navigation.ts';
import {NavLink} from './navigation.tsx';
import {RailIcon} from './rail.tsx';
import type {RuntimeData} from './runtime-feeds.ts';
import {navigationDestination, type Route} from './routes.ts';

/**
 * The tabs over a device or module page; under them, the open view's own pages when it has several, or the pages it
 * links while its own page is open, such as Display's Advanced playback and Device settings.
 */
export function FeatureNavigation({route, runtime}: {route: Route; runtime: RuntimeData}): React.JSX.Element | null {
  const navigation = featureNavigation(route, runtime);
  if (navigation === undefined) return null;
  const open = navigation.views.find(view => view.current);
  return <>
    <nav className="feature-navigation" aria-label={`${navigation.module} pages`}>{navigation.views.map(view =>
      <NavLink key={view.label} route={view.route} selected={view.current}>{view.label}</NavLink>)}</nav>
    {open !== undefined && open.pages.length > 0 && <nav className="feature-navigation feature-pages" aria-label={`${open.label} pages`} data-glass-veil>{open.pages.map(page =>
      <NavLink key={page.label} route={page.route} selected={page.current}>{page.label}</NavLink>)}</nav>}
    {open !== undefined && open.links.length > 0 && <nav className="feature-links" aria-label={`${open.label} links`}>{open.links.map(page =>
      <NavLink key={page.label} route={page.route}>{page.label}<RailIcon name="chevron" size={14}/></NavLink>)}</nav>}
  </>;
}

/**
 * The link to the open page's parent above it: a light's brand over the light's own page, All devices over the other
 * pages under Devices, Companions over the pages under Companions (Hub #1950), Home over the page of a module that is
 * not hardware, and Settings over Connections. A destination's own page, Timeline and the music pages have none.
 */
export function ShellBreadcrumb({route, runtime}: {route: Route; runtime: RuntimeData}): React.JSX.Element | null {
  const destination = navigationDestination(route, hardwareModule(runtime));
  const owner = route.kind === 'component' ? contextModule(route, runtime) : undefined;
  const parent: [string, Route] | undefined = route.kind === 'connections' ? ['Back to Settings', {kind: 'settings'}]
    : owner !== undefined && owner.serves.includes('device') && categoryOf(owner, runtime) === 'Lighting' ? [moduleLabel(owner.name), {kind: 'lighting-brand', brand: owner.name}]
      : destination === 'devices' && route.kind !== 'devices' ? ['All devices', {kind: 'devices'}]
        : destination === 'companions' && route.kind !== 'companions' ? ['Companions', {kind: 'companions'}]
          // A page of a module that is not hardware is under Home, whose cards reach it (#1950).
          : destination === 'home' && route.kind === 'module' ? ['Home', {kind: 'home'}] : undefined;
  if (parent === undefined) return null;
  return <nav className="shell-breadcrumb" aria-label="Breadcrumb" data-glass-veil><NavLink route={parent[1]}><span className="shell-back" aria-hidden="true"><RailIcon name="chevron" size={14}/></span>{parent[0]}</NavLink></nav>;
}
