import {ONN_SIMULATED_SECTION, type OnnState, type HistoryState, type HistoryPage} from '@jimmie-potts/onn';
import {act, answered, answers, bodyOf, deviceState, dispatchOnce, expect, holds, noToken, recorded, refusedWith, running, type Harness, type Scenario} from '../framework.js';
const owner = 'bunny/modules/onn';
const status = (h: Harness): OnnState | undefined => h.reader.states<OnnState>('onn-state', owner)[0]?.data;
const effects = (h: Harness): number => deviceState<{effects: number}>(h, 'onn').effects;
const command = (family: string, data: object) => ({key: `bunny.cmd.${family}.onn`, draft: {type: `org.bunny.${family.slice(0, family.lastIndexOf('-'))}.${family.slice(family.lastIndexOf('-') + 1)}.requested`, subject: 'onn', dataschema: `https://bunny.invalid/events/${family}/2.0`, data}});
export const scenarios: readonly Scenario[] = [{
  id: 'onn-controls', title: 'explicit ONN controls share the authenticated dispatcher and survive restart without replay',
  seed: {modules: ['core', 'onn'], follows: [{owner, families: ['device', 'onn-state']}], sections: {onn: ONN_SIMULATED_SECTION}},
  steps: [
    expect('core and ONN are running', h => running(h, ['core', 'onn'])),
    expect('a read publishes neutral current-app evidence', h => status(h)?.connection === 'available' && status(h)?.currentApp.status === 'known' || 'current app unknown'),
    holds('opening and inspecting sends no input', h => effects(h) === 0 || 'inspection caused an effect', 100),
    ...['up', 'down', 'left', 'right', 'select', 'back', 'home', 'play-pause'].flatMap((key, index) => [
      act(`operator presses ${key}`, h => dispatchOnce(h, 'operator', `key-${index}`, command('onn-key-press', {key}), `onn-key-${index}`)),
      expect(`${key} reports transmission without claiming playback`, h => recorded(h, `onn-key-${index}`, 'succeeded', 'transmitted')),
    ]),
    ...['youtube', 'stremio'].flatMap(app => [
      act(`operator opens ${app}`, h => dispatchOnce(h, 'operator', app, command('onn-app-open', {app}), `onn-${app}`)),
      expect(`${app} has a tracked completion`, h => recorded(h, `onn-${app}`, 'succeeded', 'transmitted')),
    ]),
    act('operator inserts synthetic focused text', h => dispatchOnce(h, 'operator', 'text', command('onn-text', {text: 'SYNTHETIC_ONN_INPUT'}), 'onn-text-1')),
    expect('text completion is transmitted', h => recorded(h, 'onn-text-1', 'succeeded', 'transmitted')),
    act('the same logical text request is retried', h => dispatchOnce(h, 'operator', 'text-retry', command('onn-text', {text: 'SYNTHETIC_ONN_INPUT'}), 'onn-text-1')),
    holds('the same request has only one effect', h => effects(h) === 11 || `${effects(h)} effects`, 100),
    expect('reader control is refused at the authenticated edge', answers({as: 'reader', method: 'POST', path: '/api/v2/commands/onn-key-press', body: {target: 'onn', data: {key: 'right'}, requestId: 'onn-reader'}}, answer => refusedWith(answer, 403, 'forbidden'))),
    act('the physical remote selects YouTube in the simulator', h => {h.simulate({device: 'onn', action: 'physical-youtube'});}),
    act('time passes for the read-only observation', h => h.wait(5100)),
    expect('the app changes without a compensating command', h => {const app = status(h)?.currentApp; return app?.status === 'known' && app.value === 'youtube' && effects(h) === 11 || 'physical change caused work or was not read';}),
    act('runtime restarts on its own state', h => h.restart()),
    holds('restart and reconnection cause no command replay', h => effects(h) === 11 || 'restart repeated input', 100),
    act('the simulated device becomes unavailable', h => {h.simulate({device: 'onn', action: 'offline'});}),
    act('time passes for the unavailable read', h => h.wait(5100)),
    expect('connection is unavailable and current app is unknown', h => status(h)?.connection === 'unavailable' && status(h)?.currentApp.status === 'unknown' || 'offline state differs'),
    act('an offline press is admitted for a truthful terminal result', h => dispatchOnce(h, 'operator', 'offline', command('onn-key-press', {key: 'right'}), 'onn-offline')),
    expect('offline action fails without transmission or effect', async h => await recorded(h, 'onn-offline', 'failed', 'none') === true && effects(h) === 11 || 'offline evidence differs'),
    expect('credentials and text stay out of public projections and diagnostics', async h => await noToken(h) === true
      && !JSON.stringify(h.logs()).includes('SYNTHETIC_ONN_INPUT') && !JSON.stringify(h.published()).includes('SYNTHETIC_ONN_INPUT') || 'sensitive input was retained'),
    expect('the dispatcher recorded each accepted action', h => answered(h, 'text', 'accepted')),
  ],
},{
  id:'onn-title-history',title:'ONN retains private title observations and source progress across physical changes, gaps and restart',
  captureTimeoutMs:180_000,
  capture:async(context,harness)=>{
    const {onnHistoryBrowser}=await import('../../../verify/onn-history-browser.js');
    await onnHistoryBrowser(context,harness);
  },
  seed:{modules:['core','onn'],follows:[{owner,families:['onn-history-state']}],sections:{onn:ONN_SIMULATED_SECTION}},
  steps:[
    expect('core and ONN are running',h=>running(h,['core','onn'])),
    act('synthetic physical remote selects YouTube',h=>{h.simulate({device:'onn',action:'physical-youtube'});}),
    act('a collection period passes',h=>h.wait(5100)),
    expect('YouTube title is fresh with selected-title semantics',h=>{const s=h.reader.states<HistoryState>('onn-history-state',owner)[0]?.data;return s?.status==='fresh'&&s.current[0]?.metadata?.title==='Synthetic YouTube title 1'||'YouTube title missing';}),
    expect('the authenticated stored query includes provenance and no watched totals',answers({as:'reader',method:'GET',path:'/modules/onn/content/history?app=youtube'},answer=>{const p=bodyOf<HistoryPage>(answer);return answer.status===200&&p?.items[0]?.observation.provenance.semantics==='selected-title-observed'&& !('watchedMs'in p)||'history projection differs';})),
    act('physical remote pauses playback',h=>{h.simulate({device:'onn',action:'physical-pause'});}),
    act('the pause observation arrives',h=>h.wait(5100)),
    expect('reported pause is retained without extrapolation',h=>h.reader.states<HistoryState>('onn-history-state',owner)[0]?.data.current[0]?.playback?.state===2||'pause not observed'),
    act('physical remote selects a Stremio episode',h=>{h.simulate({device:'onn',action:'physical-stremio'});}),
    act('the episode observation arrives',h=>h.wait(5100)),
    expect('Stremio exposes series and episode',h=>{const s=h.reader.states<HistoryState>('onn-history-state',owner)[0]?.data.current[0];return s?.app==='stremio'&&s.metadata?.subtitle==='Synthetic episode 1'||'episode not observed';}),
    act('physical remote changes to another episode',h=>{h.simulate({device:'onn',action:'physical-next'});}),
    act('the changed episode arrives',h=>h.wait(5100)),
    expect('the episode changes without software input',h=>h.reader.states<HistoryState>('onn-history-state',owner)[0]?.data.current[0]?.metadata?.subtitle==='Synthetic episode 2'&&effects(h)===0||'episode change differs'),
    act('physical remote exits playback',h=>{h.simulate({device:'onn',action:'physical-exit'});}),
    act('the empty observation arrives',h=>h.wait(5100)),
    expect('current content clears',h=>h.reader.states<HistoryState>('onn-history-state',owner)[0]?.data.current.length===0||'old title remains current'),
    act('runtime restarts on latest private state',h=>h.restart()),
    expect('stored episodes and originals survive restart',answers({as:'reader',method:'GET',path:'/modules/onn/content/history?app=stremio'},answer=>answer.status===200&&(bodyOf<HistoryPage>(answer)?.items.length??0)>=2||'retained episode history missing')),
    act('source becomes unavailable',h=>{h.simulate({device:'onn',action:'offline'});}),
    act('the unavailable observation arrives',h=>h.wait(5100)),
    expect('loss is explicit and no command was replayed',h=>{const s=h.reader.states<HistoryState>('onn-history-state',owner)[0]?.data;return s?.status==='unavailable'&&s.coverage.recentGaps.some(g=>g.reason==='unavailable')&&effects(h)===0||'loss/effects differ';}),
  ],
}];
