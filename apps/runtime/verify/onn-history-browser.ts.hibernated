import assert from 'node:assert/strict';
import {AxeBuilder} from '@axe-core/playwright';
import type {Page, Locator, Route} from 'playwright';
import type {CaptureContext} from '@jimmie-potts/app-verify';
import type {HistoryPage, HistoryDetail} from '@jimmie-potts/onn';
import type {Harness} from '../tests/scenarios/framework.js';
import {historyBrowserFixture} from './onn-history-fixture.js';
import {HARNESS_PATH} from './protocol.js';

/** Same synthetic browser path for CI and independent disposable Acceptance. No installed target. */
export async function onnHistoryBrowser(t: CaptureContext, run: Harness): Promise<void> {
  const page = t.page as Page;
  page.setDefaultTimeout(10_000);
  const errors: string[] = [], commands: string[] = [], external: string[] = [];
  page.on('pageerror', error => {errors.push(error.name);});
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== new URL(t.url).origin) external.push(url.origin);
    if (request.method() === 'POST' && /\/api\/v2\/commands\//u.test(url.pathname)) commands.push(url.pathname);
  });
  const effects = (): unknown => (run.devices().onn as {effects: number}).effects;
  assert.equal(effects(), 0);
  await page.goto(new URL('/#/module/onn/controls', t.url).href);
  await page.locator('main#main[data-feed="connected"]').waitFor();
  const current = page.getByRole('region', {name:'Current ONN content'});
  const history = page.getByRole('region', {name:'ONN title history'});
  const detail = page.getByRole('region', {name:'ONN observation detail'});
  let step = 0;
  // Captured videos name the synthetic input and show the actual target before each activation.
  const indicate = async (label: string, target?: Locator): Promise<void> => {
    step += 1;
    let point = {x:24,y:64};
    if (target !== undefined) {
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox(); assert.ok(box !== null);
      point = {x:box.x + box.width / 2,y:box.y + box.height / 2};
      await target.evaluate(element => { (element as HTMLElement).style.outline = '3px solid #fbbf24'; });
    }
    await page.evaluate(({label,point,step}) => {
      let caption = document.getElementById('onn-test-caption');
      if (caption === null) {caption = document.createElement('div'); caption.id = 'onn-test-caption'; document.body.append(caption);}
      caption.textContent = `Synthetic demo ${step}: ${label}`;
      Object.assign(caption.style,{position:'fixed',top:'8px',left:'8px',zIndex:'9999',background:'#111827',color:'#fff',padding:'8px',fontSize:'14px',pointerEvents:'none',maxWidth:'90vw'});
      let cursor = document.getElementById('onn-test-cursor');
      if (cursor === null) {cursor = document.createElement('div'); cursor.id = 'onn-test-cursor'; document.body.append(cursor);}
      Object.assign(cursor.style,{position:'fixed',left:`${point.x - 9}px`,top:`${point.y - 9}px`,width:'18px',height:'18px',border:'3px solid #fbbf24',borderRadius:'50%',zIndex:'9998',pointerEvents:'none',transition:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'left 120ms linear, top 120ms linear'});
    },{label,point,step});
    await page.mouse.move(point.x,point.y,{steps:8});
    await page.waitForTimeout(180);
  };
  const finishAction = async (target: Locator): Promise<void> => {
    await page.waitForTimeout(240);
    await page.evaluate(() => {const cursor = document.getElementById('onn-test-cursor'); if (cursor !== null) cursor.style.background = 'transparent';});
    await target.evaluate(element => {(element as HTMLElement).style.outline = '';}).catch(() => {});
    await page.waitForTimeout(140);
  };
  const pulse = async (): Promise<void> => {await page.evaluate(() => {const cursor = document.getElementById('onn-test-cursor'); if (cursor !== null) cursor.style.background = '#fbbf24';});};
  const click = async (target: Locator, label: string, keyboard = false): Promise<void> => {
    await indicate(label,target); await pulse();
    if (keyboard) {await target.focus(); await target.press('Enter');} else await target.click();
    await finishAction(target);
  };
  const fill = async (target: Locator, value: string, label: string): Promise<void> => {
    await indicate(label,target); await pulse(); await target.click(); await target.fill(value); await finishAction(target);
  };
  const select = async (target: Locator, value: string, label: string): Promise<void> => {
    await indicate(label,target); await pulse(); await target.selectOption(value); await finishAction(target);
  };
  const simulate = async (action: string): Promise<void> => {
    await current.evaluate(element => element.scrollIntoView({block:'center'}));
    const target = current.getByRole('heading',{name:'Current ONN content',exact:true});
    await indicate(`Simulated physical remote: ${action}`,target);
    run.simulate({device:'onn',action}); await run.wait(5100);
    await target.evaluate(element => {(element as HTMLElement).style.outline = '';});
  };
  await t.expect('current observations change and clear through the real synced owner without commands',async () => {
    await current.getByText('Collection unavailable',{exact:true}).waitFor();
    run.simulate({device:'onn',action:'online'}); await simulate('physical-youtube');
    await current.getByText('Synthetic YouTube title 1',{exact:true}).waitFor();
    await current.getByText('Fresh observation',{exact:true}).waitFor();
    assert.match(await current.innerText(),/selected-title observed/i);
    await simulate('physical-stremio');
    await current.getByText('Synthetic episode 1',{exact:true}).waitFor();
    assert.equal(await current.getByText('Synthetic YouTube title 1',{exact:true}).count(),0);
    await simulate('physical-next'); await current.getByText('Synthetic episode 2',{exact:true}).waitFor();
    await simulate('physical-exit');
    await current.getByText('No supported current content in the latest accepted sample.',{exact:true}).waitFor();
    assert.equal(await current.getByText('Synthetic episode 2',{exact:true}).count(),0);
  });
  await t.expect('real authenticated history reads agree with the displayed occurrence and detail',async () => {
    const result = await run.gateway({as:'reader',method:'GET',path:'/modules/onn/content/history?app=stremio&limit=50'});
    assert.equal(result.status,200);
    const owner = JSON.parse(result.text) as HistoryPage;
    await select(history.getByLabel('App',{exact:true}),'stremio','Select Stremio history');
    await click(history.getByRole('button',{name:'Search history',exact:true}),'Search retained Stremio titles',true);
    for (const item of owner.items) await history.getByRole('listitem',{name:`Occurrence ${item.id}`,exact:true}).waitFor();
    const first = owner.items[0]; assert.ok(first !== undefined);
    await click(history.getByRole('listitem',{name:`Occurrence ${first.id}`,exact:true}).getByRole('button',{name:'View observations'}),'Open retained occurrence',true);
    await detail.getByRole('article').first().waitFor();
    assert.equal(await detail.evaluate(element => document.activeElement === element),true,'keyboard activation focuses details');
    const details = await run.gateway({as:'reader',method:'GET',path:`/modules/onn/content/history-detail?id=${encodeURIComponent(first.id)}&limit=50`});
    assert.equal(details.status,200);
    for (const observation of (JSON.parse(details.text) as HistoryDetail).observations) await detail.getByRole('article',{name:`Observation ${observation.id}`,exact:true}).waitFor();
    await click(detail.getByRole('button',{name:'Close details'}),'Close details',true);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'View observations');
  });
  const prior = await page.evaluate(() => {const date = new Date(); date.setDate(date.getDate() - 1); date.setHours(0,0,0,0); const dateText = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; const ms = date.getTime(); date.setDate(date.getDate() + 1); return {ms,date:dateText,toMs:date.getTime()};});
  const fixture = await historyBrowserFixture(prior.ms);
  const historyPattern = '**/modules/onn/content/history?*', detailPattern = '**/modules/onn/content/history-detail?*';
  const reply = async (route: Route): Promise<void> => {
    const url = new URL(route.request().url());
    const query: Record<string,unknown> = Object.fromEntries(url.searchParams);
    for (const key of ['limit','fromMs','toMs']) if (typeof query[key] === 'string') query[key] = Number(query[key]);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.pathname.endsWith('history-detail') ? fixture.detail(query) : fixture.history(query))});
  };
  try {
    await indicate('Use canonical history-owner queries over synthetic prior-day originals');
    await page.route(historyPattern,reply); await page.route(detailPattern,reply);
    await fill(history.getByLabel('From date',{exact:true}),prior.date,'Set prior-day beginning');
    await fill(history.getByLabel('Through date',{exact:true}),prior.date,'Set prior-day end');
    await select(history.getByLabel('App',{exact:true}),'','Select both supported apps');
    await click(history.getByRole('button',{name:'Search history',exact:true}),'Search both apps on the prior local calendar day',true);
    await t.expect('prior-day filters and both continuation paths match the owning queries',async () => {
      const first = fixture.history({fromMs:prior.ms,toMs:prior.toMs,limit:50});
      assert.equal(await history.getByRole('listitem',{name:/^Occurrence /u}).count(), first.items.length);
      assert.ok(first.nextCursor !== null);
      const episode = first.items[0]; assert.ok(episode !== undefined);
      await click(history.getByRole('listitem',{name:`Occurrence ${episode.id}`,exact:true}).getByRole('button',{name:'View observations'}),'Inspect last observed episode',true);
      const firstDetail = fixture.detail({id:episode.id,limit:50});
      await detail.getByRole('article',{name:`Observation ${firstDetail.observations[0]?.id}`,exact:true}).waitFor();
      assert.ok(firstDetail.nextCursor !== null);
      await click(detail.getByRole('button',{name:'Next observation page',exact:true}),'Next contributing observation page',true);
      const nextDetail = fixture.detail({id:episode.id,limit:50,cursor:firstDetail.nextCursor});
      await detail.getByRole('article',{name:`Observation ${nextDetail.observations[0]?.id}`,exact:true}).waitFor();
      await click(detail.getByRole('button',{name:'Close details'}),'Close occurrence',true);
      await click(history.getByRole('button',{name:'Next history page',exact:true}),'Next retained title page',true);
      const next = fixture.history({fromMs:prior.ms,toMs:prior.toMs,limit:50,cursor:first.nextCursor});
      await history.getByRole('listitem',{name:`Occurrence ${next.items[0]?.id}`,exact:true}).waitFor();
      assert.equal(await history.getByRole('listitem',{name:/^Occurrence /u}).count(),next.items.length);
      assert.match(await history.innerText(),/Unsupported identity|Ambiguous/u);
    });
    await fill(history.getByLabel('Title contains',{exact:true}),'SYNTHETIC prior YouTube title 60','Filter one long prior-day YouTube title');
    await select(history.getByLabel('App',{exact:true}),'youtube','Select YouTube history');
    await click(history.getByRole('button',{name:'Search history',exact:true}),'Read filtered titles',true);
    await history.getByRole('listitem',{name:/^Occurrence /u}).first().waitFor();
    assert.match(await history.innerText(),/<script>synthetic<\/script>/u,'long source text remains literal');
    assert.equal(await history.locator('script').count(),0);
    await t.screenshot('onn-history-desktop');
    await page.setViewportSize({width:390,height:844});
    await page.emulateMedia({reducedMotion:'reduce'});
    await click(history.getByRole('button',{name:'Refresh history',exact:true}),'Refresh history with the phone keyboard',true);
    await history.getByRole('listitem',{name:/^Occurrence /u}).first().waitFor();
    await t.expect('phone and desktop history are keyboard accessible without overflow',async () => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),true);
      assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(item => item.id),[]);
    });
    await t.screenshot('onn-history-phone');
    await page.setViewportSize({width:1280,height:800});
    await t.expect('malformed and failed reads clear old pages; superseded replies cannot repopulate them',async () => {
      await page.route(historyPattern,route => route.fulfill({status:200,contentType:'application/json',body:'{"schema":"unsupported"}'}));
      await click(history.getByRole('button',{name:'Refresh history',exact:true}),'Reject unsupported history document');
      await history.getByText('This read is unavailable or uses an unsupported format.',{exact:true}).waitFor();
      assert.equal(await history.getByRole('listitem',{name:/^Occurrence /u}).count(),0);
      await page.unroute(historyPattern); await page.route(historyPattern,route => route.fulfill({status:503,contentType:'application/json',body:'{}'}));
      await click(history.getByRole('button',{name:'Refresh history',exact:true}),'Show failed history read');
      await history.getByText('This read failed. Try refreshing.',{exact:true}).waitFor();
      await page.unroute(historyPattern);
      let release: (() => void) | undefined;
      const held = new Promise<void>(resolve => {release = resolve;});
      let requests = 0;
      await page.route(historyPattern,async route => {requests += 1; if (requests === 1) await held; await reply(route);});
      await click(history.getByRole('button',{name:'Refresh history',exact:true}),'Hold one old response');
      await page.waitForFunction(() => document.querySelector('[aria-label="ONN title history"]')?.textContent?.includes('Loading history'));
      await fill(history.getByLabel('Title contains',{exact:true}),'SYNTHETIC no match','Change query while old read is pending');
      await click(history.getByRole('button',{name:'Search history',exact:true}),'Submit superseding query',true);
      await history.getByText(/^No matching titles in this page/u).waitFor();
      release?.(); await page.waitForTimeout(100);
      assert.equal(await history.getByRole('listitem',{name:/^Occurrence /u}).count(),0);
    });
    await page.unroute(historyPattern); await page.unroute(detailPattern);
    await t.expect('disconnect and reconnect reload current evidence without input or replay',async () => {
      const draft = history.getByLabel('Title contains',{exact:true});
      await fill(draft,'SYNTHETIC unsent reconnect draft','Keep an unsent history filter across reconnect');
      const streamPattern = '**/api/sdk/v1/stream';
      let releaseStream = (): void => {};
      const heldStream = new Promise<void>(resolve => {releaseStream = resolve;});
      await page.route(streamPattern,async route => {await heldStream; await route.continue();});
      try {
        const replacement = page.waitForRequest(request => new URL(request.url()).pathname === '/api/sdk/v1/stream').then(() => true,() => false);
        await indicate('Drop the synthetic dashboard stream; hold its replacement connection');
        const harness = t.endpoints.harness; assert.ok(harness !== undefined);
        // The existing disposable control ends this source's stream; no device command is involved.
        const response = await fetch(new URL(`${HARNESS_PATH}/disconnect`,harness),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'bunny/parts/dashboard'}),signal:AbortSignal.timeout(5000)});
        assert.equal(response.status,200); assert.equal(await replacement,true);
        await page.locator('main#main[data-feed="reconnecting"]').waitFor();
        await history.getByText('Disconnected. Reconnect to read history.',{exact:true}).waitFor();
        assert.equal(await history.getByRole('button',{name:'Search history',exact:true}).isDisabled(),true);
        assert.equal(await history.getByRole('button',{name:'Refresh history',exact:true}).isDisabled(),true);
        assert.equal(await current.getByRole('button',{name:'Reload content',exact:true}).isDisabled(),true);
        assert.equal(await draft.inputValue(),'SYNTHETIC unsent reconnect draft');
        assert.equal(await history.getByRole('listitem',{name:/^Occurrence /u}).count(),0);
        await indicate('Release the replacement stream and inspect restored current evidence');
        releaseStream();
        await page.locator('main#main[data-feed="connected"]').waitFor();
        assert.equal(await draft.inputValue(),'SYNTHETIC unsent reconnect draft');
        await click(current.getByRole('button',{name:'Reload content',exact:true}),'Reload current content');
        await current.getByText('Fresh observation',{exact:true}).waitFor();
        await run.wait(10); assert.equal(effects(),0); assert.deepEqual(commands,[]); assert.deepEqual(external,[]);
      } finally {releaseStream(); await page.unrouteAll({behavior:'wait'});}
    });
    assert.deepEqual(errors,[]);
    await t.attach('onn-history-browser.json',JSON.stringify({synthetic:true,physical:false,ownerReads:true,priorLocalDay:true,historyPaging:true,detailPaging:true,keyboard:true,phone:true,axe:'passed',failedReads:true,supersededReplies:true,reconnect:true,deviceEffects:effects(),commands:commands.length},null,2));
  } finally {fixture.close(); await page.unroute(historyPattern); await page.unroute(detailPattern);}
}
