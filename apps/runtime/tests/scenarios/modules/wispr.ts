// Wispr's actual published-file reader in the catalog (Hub #927); fixtures select private synthetic files before start.
import {
  CORE_FAMILIES, answers, bodyOf, expect, noToken, refusedWith, running,
  type GatewayAnswer, type Outcome, type Scenario, type Seed,
} from '../framework.js';

type Numeric = {
  schema?: string; sourceId?: string; freshness?: string; ageMs?: number | null; lastSuccessAt?: string | null;
  data?: {totals?: {words?: number}; textAllowed?: boolean};
};
const PATH = '/modules/wispr/content/';
const seed = (observation: 'fresh' | 'stale' | 'missing', exposeToDashboard?: boolean): Seed => ({
  modules: ['core', 'wispr'], follows: [CORE_FAMILIES],
  wisprFixture: {observation, ...(exposeToDashboard === undefined ? {} : {exposeToDashboard})},
});
const safe = (answer: GatewayAnswer): boolean => !['aggregate.json', 'status.json', '/wispr/', 'SYNTHETIC_TEXT_CANARY'].some(value => answer.text.includes(value));
const numeric = (freshness: 'fresh' | 'stale') => (answer: GatewayAnswer): Outcome => {
  const value = bodyOf<Numeric>(answer);
  return (answer.status === 200 && value?.schema === 'wispr-analytics/2.0' && value.sourceId === 'dictation-sim'
    && value.data?.totals?.words === 120 && value.freshness === freshness && safe(answer)) || 'Wispr numeric observation or safe envelope differs';
};

const reads: Scenario = {
  id: 'wispr-files-read', title: 'two read-scoped clients read selected Wispr files while browser exposure defaults off', seed: seed('fresh'),
  steps: [
    expect('the core and real Wispr reader module run', h => running(h, ['core', 'wispr'])),
    expect('the read-only client reads the actual synthetic numeric observation', answers({as: 'reader', method: 'GET', path: PATH + 'summary'}, numeric('fresh'))),
    expect('another read-scoped client reads without a per-client Wispr allowlist', answers({as: 'panel', method: 'GET', path: PATH + 'export?format=json'}, numeric('fresh'))),
    expect('a browser session cannot read when exposure defaults off', answers({as: 'browser', method: 'GET', path: PATH + 'status'}, answer =>
      refusedWith(answer, 403, 'forbidden') === true && safe(answer) || 'browser exposure was not refused safely')),
    expect('analytics are not broadcast and the core keeps running', async h =>
      h.published().every(({message}) => !message.source.startsWith('bunny/modules/wispr')) && await running(h, ['core', 'wispr']) === true || 'unexpected analytics broadcast or failed module'),
    expect('private configuration credentials remain private', h => noToken(h)),
  ],
};

const browser: Scenario = {
  id: 'wispr-browser-read', title: 'explicit browser exposure permits numeric Wispr reads while text sharing remains off', seed: seed('fresh', true),
  steps: [
    expect('the browser reads numeric content through the same authenticated adapter', answers({as: 'browser', method: 'GET', path: PATH + 'summary'}, numeric('fresh'))),
    expect('exposure alone does not enable text', answers({as: 'browser', method: 'GET', path: PATH + 'status'}, answer => {
      const value = bodyOf<Numeric>(answer);
      return answer.status === 200 && value?.data?.textAllowed === false && safe(answer) || 'text sharing or exposure differs';
    })),
    expect('the browser cannot export text without both opt-ins', answers({as: 'browser', method: 'GET', path: PATH + 'export?includeText=true&period=today&corpus=cleaned'}, answer =>
      refusedWith(answer, 403, 'forbidden') === true && safe(answer) || 'text export was not refused safely')),
    expect('both modules stay healthy', h => running(h, ['core', 'wispr'])),
  ],
};

const stale: Scenario = {
  id: 'wispr-stale-read', title: 'an old Wispr observation preserves its numeric values and collection time with stale freshness', seed: seed('stale'),
  steps: [
    expect('old collection remains observable as stale rather than fresh or fabricated zero', answers({as: 'reader', method: 'GET', path: PATH + 'summary'}, numeric('stale'))),
    expect('another reader receives the original collection age', answers({as: 'panel', method: 'GET', path: PATH + 'summary'}, answer => {
      const value = bodyOf<Numeric>(answer);
      return answer.status === 200 && typeof value?.ageMs === 'number' && value.ageMs >= 3_600_000
        && typeof value.lastSuccessAt === 'string' && safe(answer) || 'original collection age or safe projection differs';
    })),
    expect('stale data does not fail the module', h => running(h, ['core', 'wispr'])),
  ],
};

const missing: Scenario = {
  id: 'wispr-missing-read', title: 'missing selected Wispr files refuse safely without invented numeric data or failing the module', seed: seed('missing'),
  steps: [
    ...(['reader', 'panel'] as const).map(as => expect(`${as} sees unavailable without private paths or zero totals`,
      answers({as, method: 'GET', path: PATH + 'summary'}, answer => refusedWith(answer, 503, 'unavailable', true) === true && safe(answer)
        && !answer.text.includes('totals') || 'missing source was not refused safely'))),
    expect('the core and Wispr remain healthy after expected file refusals', h => running(h, ['core', 'wispr'])),
  ],
};

export const scenarios: readonly Scenario[] = [reads, browser, stale, missing];
