import type {RuntimeData} from './runtime-feeds.ts';
import type {Route} from './routes.ts';

/**
 * The Companions overview (Hub #1950): Habitat and the companion features the companions module declares, as
 * sections of links. It is a projection of the catalog the page already holds; it reads nothing and sends nothing.
 * The Conversation page is left out: its conversations have their own group in the rail.
 */
export type CompanionSection = {id: string; title: string; hint: string; links: {label: string; route: Route}[]};
/** `note` says why the module's features are not offered: the catalog is loading or failed, or the module is absent or not running. */
export type CompanionsOverview = {sections: CompanionSection[]; note?: string};

const CONVERSATION = 'assistant';
/** The pages with sections of their own; every other page of the module is a companion profile. */
const OWN: Readonly<Record<string, string>> = {preferences: 'What the companions keep about how you like things done.', knowledge: 'What the companions know and the context they bring to a conversation.'};

export function companionsOverview(runtime: RuntimeData): CompanionsOverview {
  const habitat: CompanionSection = {id: 'habitat', title: 'Habitat', hint: 'Ten bunnies in one shared home, following the sessions the dashboard sees.',
    links: [{label: 'Open Habitat', route: {kind: 'habitat'}}]};
  const module = runtime.modules?.find(entry => entry.name === 'companions');
  const note = runtime.catalogFailed ? 'The module catalog is unavailable. Companion features appear once it can be read.'
    : runtime.modules === undefined ? 'Loading companion features.'
      : module === undefined ? 'No companions module is declared.'
        : module.state === 'running' ? undefined : `Companions: ${module.state}. Its features are unavailable.`;
  if (note !== undefined || module === undefined) return {sections: [habitat], ...(note === undefined ? {} : {note})};
  const pages = module.pages.filter(page => page.id !== CONVERSATION);
  const route = (page: string): Route => ({kind: 'module', module: 'companions', page});
  const profiles = pages.filter(page => OWN[page.id] === undefined);
  const sections = [habitat];
  if (profiles.length > 0) sections.push({id: 'profiles', title: 'Companion profiles', hint: 'Each companion’s own page.', links: profiles.map(page => ({label: page.title, route: route(page.id)}))});
  for (const page of pages) {
    const hint = OWN[page.id];
    if (hint !== undefined) sections.push({id: page.id, title: page.title, hint, links: [{label: `Open ${page.title}`, route: route(page.id)}]});
  }
  return {sections};
}
