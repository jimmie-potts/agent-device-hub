import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium, type BrowserContext, type BrowserContextOptions, type Page} from 'playwright';
import {browserArtifactDirectory} from './browser-artifacts.ts';
import {startWorld, type World, type WorldOptions} from './harness.ts';

export const viewport = {
  desktop: {width: 1280, height: 900}, tallDesktop: {width: 1280, height: 1000}, wide: {width: 1440, height: 1000},
  phone: {width: 390, height: 844}, tallPhone: {width: 390, height: 900}, smallPhone: {width: 320, height: 900},
} as const;
const pageTimeout = {roomModel: 8000, controls: 10_000, musicLighting: 12_000, homeShapes: 20_000} as const;

export type Journey = {
  step(label: string): void;
  newContext(options?: BrowserContextOptions): Promise<BrowserContext>;
  page(context: BrowserContext, budget: keyof typeof pageTimeout): Promise<Page>;
  closeContext(context: BrowserContext): Promise<void>;
  contexts(): BrowserContext[];
  startWorld(options: WorldOptions): Promise<World>;
  closeWorld(world: World): Promise<void>;
};

/** A journey owns its simulated worlds and every context, including secondary tabs and isolated cookie jars. */
export async function runJourney(
  name: string, options: WorldOptions, exercise: (run: Journey, world: World) => Promise<void>, renderer: 'default' | 'software-webgl' = 'default',
): Promise<void> {
  // Traces can include synthetic browser credentials. Keep them in a private temp directory outside any upload path.
  const directory = await browserArtifactDirectory(tmpdir());
  const contexts = new Map<BrowserContext, string>(), worlds = new Set<World>();
  const problems: unknown[] = [];
  let label = 'start the simulated world', sequence = 0;
  const openWorld = async (settings: WorldOptions): Promise<World> => {
    const world = await startWorld(settings);
    worlds.add(world);
    return world;
  };
  const closeWorld = async (world: World): Promise<void> => {
    if (worlds.delete(world)) await world.close();
  };
  const closeContext = async (context: BrowserContext): Promise<void> => {
    const path = contexts.get(context);
    if (path === undefined) return;
    contexts.delete(context);
    // A later assertion can fail after this context was closed. Keep its trace until the entire journey succeeds.
    try {await context.tracing.stop({path});}
    finally {await context.close();}
  };
  const clean = async (close: () => Promise<void>): Promise<void> => {
    try {await close();} catch (error) {problems.push(error);}
  };
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const initialExit = process.exitCode;
  try {
    const world = await openWorld(options);
    label = 'launch Chromium';
    // Keep 3D rendering on SwiftShader and page compositing off its GPU queue (#1893).
    const launched = await chromium.launch({headless: true, args: renderer === 'software-webgl'
      ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing'] : []});
    browser = launched;
    const run: Journey = {
      step(value) {label = value;},
      async newContext(settings = {}) {
        const context = await launched.newContext({reducedMotion: 'reduce', ...settings});
        try {
          await context.tracing.start({snapshots: true});
          contexts.set(context, join(directory, `context-${String(++sequence)}.zip`));
          // Stays below transient page routes for the context's lifetime, including pages opened later (#1691).
          await context.route('**/*', route => route.fallback());
          return context;
        } catch (error) {
          if (!contexts.has(context)) await clean(() => context.close());
          throw error;
        }
      },
      async page(context, budget) {
        const page = await context.newPage();
        page.setDefaultTimeout(pageTimeout[budget]);
        return page;
      },
      contexts: () => launched.contexts(), closeContext, startWorld: openWorld, closeWorld,
    };
    label = 'set up the journey';
    await exercise(run, world);
  } catch (error) {problems.push(error);}
  for (const context of contexts.keys()) await clean(() => closeContext(context));
  const launched = browser;
  if (launched !== undefined) await clean(() => launched.close());
  for (const world of [...worlds].reverse()) await clean(() => closeWorld(world));
  // A world's health check can report a late failure at close via the process exit code.
  if (problems.length === 0 && process.exitCode === initialExit) {
    await rm(directory, {recursive: true, force: true});
    return;
  }
  throw new Error(`${name} failed at "${label}". Local traces: ${directory}`,
    {cause: problems.length > 1 ? new AggregateError(problems, 'Journey and cleanup errors') : problems[0]});
}
