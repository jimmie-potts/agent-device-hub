const fs = require('fs'), path = require('path'), os = require('os');
const assert = require('assert/strict');
const {pathToFileURL} = require('url');
const crypto = require('crypto');
let modulePath;
for (const p of [process.env.GUIDE_PLAYWRIGHT_MODULE, 'playwright'].filter(Boolean)) {
  try {modulePath = require.resolve(p); break;} catch {}
}
assert(modulePath, 'Set GUIDE_PLAYWRIGHT_MODULE to an installed Playwright module.');
const {chromium} = require(modulePath);
const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache/ms-playwright');
const installed = fs.existsSync(cache) ? fs.readdirSync(cache).sort((a,b) => b.localeCompare(a,undefined,{numeric:true})) : [];
const executablePath = [process.env.GUIDE_CHROMIUM_PATH, chromium.executablePath(), ...installed.filter(n=>n.startsWith('chromium-')).map(n=>path.join(cache,n,'chrome-linux64/chrome'))].find(p=>p && fs.existsSync(p));
assert(executablePath, 'Set GUIDE_CHROMIUM_PATH to an installed Chromium executable.');
(async () => {
  const root = __dirname;
  const out = process.env.BUNNY_DESIGN_RECEIPTS || fs.mkdtempSync(path.join(os.tmpdir(), 'bunny-design-'));
  fs.mkdirSync(out, {recursive:true});
  const data = JSON.parse(fs.readFileSync(path.join(root,'design.json'),'utf8'));
  const browser = await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    const errors=[], external=[];
    page.on('pageerror', e=>errors.push(e.message));
    page.on('request', r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
    await page.route(/^https?:/, r=>r.abort());
    const visit = async file=>{await page.goto(pathToFileURL(path.join(root,file)).href);};
    const fit = async ()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), 'Horizontal page overflow');
    await visit('index.html');
    assert.equal(await page.locator('.component-card').count(),data.components.length);
    await page.locator('#search').fill('music');
    assert(await page.locator('.component-card:visible').count()>0);
    assert(await page.locator('.component-card:visible').count()<data.components.length);
    await page.locator('#search').fill('no-such-component-xyz');
    assert(await page.locator('#empty').isVisible());
    await page.locator('#search').fill('');
    assert.equal(await page.locator('.component-card:visible').count(),data.components.length);
    // System map: first screen, selection by mouse, keyboard and list, links, and zoom.
    const mapNodes=Object.keys(data.map.nodes), mapSvg=page.locator('.atlas-canvas[data-diagram^="arch-"] > svg'), panel=page.locator('#map-detail'), mapNode=id=>page.locator('.atlas-canvas[data-diagram^="arch-"] [data-node-id$="-'+id+'"]');
    await page.evaluate(()=>scrollTo(0,0));
    const mapBox=await mapSvg.boundingBox();
    assert(mapBox.y>=0 && mapBox.y+mapBox.height<=1000, `System map inside the first screen at 1440x1000: top ${Math.round(mapBox.y)} bottom ${Math.round(mapBox.y+mapBox.height)}`);
    assert.equal(await page.locator('.atlas-canvas[data-diagram^="arch-"] [data-node-id]').count(),mapNodes.length,'One selectable box per map component');
    assert.equal(await page.locator('.node-detail').count(),mapNodes.length,'One detail block per map component');
    assert.equal(await panel.getAttribute('data-node')??'','');
    await mapNode('hubRoutes').click();
    assert.equal(await panel.getAttribute('data-node'),'hubRoutes');
    assert((await panel.innerText()).includes('/api/monitor/v1/changes'),'Hub routes are discoverable from the map');
    assert(await panel.locator('a[href^="https://github.com/"]').count()>=1,'Owning code link');
    assert(await panel.locator('a[href^="components/"]').count()>=1,'Design document link');
    await page.keyboard.press('Escape'); assert.equal(await panel.getAttribute('data-node'),'');
    await mapNode('core').focus(); await page.keyboard.press('Tab');
    assert(await page.evaluate(()=>document.activeElement.hasAttribute('data-node-id')),'Tab moves between map boxes');
    await page.keyboard.press('Enter');
    const selected=await panel.getAttribute('data-node'); assert(mapNodes.includes(selected),'Enter selects the focused box');
    assert.equal(await mapNode(selected).getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.atlas-canvas[data-diagram^="seq-"] [tabindex="0"][data-node-id]').count(),0,'Walkthrough participants are not inert buttons');
    await page.keyboard.press('Escape');
    await page.locator('#map-index > summary').click(); await page.locator('.node-button[data-node="hubStore"]').click();
    assert.equal(await panel.getAttribute('data-node'),'hubStore'); assert((await panel.innerText()).includes('state.sqlite'),'Storage ownership is discoverable');
    assert(await panel.locator('a[href^="reference/"]').count()>=1,'Dated reference link');
    await page.locator('.detail-clear').click(); assert.equal(await panel.getAttribute('data-node'),'');
    {const width=()=>mapSvg.evaluate(e=>e.getBoundingClientRect().width); const base=await width(); await page.locator('.atlas-map .zoom-in').click(); assert(await width()>base*1.2,'Zoom widens the map'); assert(await page.locator('.atlas-map .map-stage').evaluate(e=>e.scrollWidth>e.clientWidth),'Zoomed map scrolls inside its stage'); await fit(); await page.locator('.atlas-map .zoom-fit').click(); assert.equal(Math.round(await width()),Math.round(base));}
    await page.screenshot({path:path.join(out,'map-selected.png')});
    // Walkthrough: one phase open at a time, highlighted arrows, diagram labels open phases.
    const phases=page.locator('.walk-phase');
    assert.equal(await phases.count(),data.map.phases.length);
    assert.equal(await page.locator('.phase-body:not([hidden])').count(),0);
    await phases.nth(1).locator('.phase-button').click();
    assert(await phases.nth(1).evaluate(e=>e.classList.contains('is-open'))); assert.equal(await page.locator('.phase-body:not([hidden])').count(),1);
    const stepCount=(await phases.nth(1).getAttribute('data-steps')).split(',').length;
    assert.equal(await page.locator('.atlas-canvas[data-diagram^="seq-"] [data-edge-key].is-active').count(),stepCount,'Open phase highlights its arrows');
    assert(await phases.nth(1).locator('.phase-messages li').count()===stepCount && await phases.nth(1).locator('a[href^="https://github.com/"]').count()>=1);
    await page.locator('.atlas-canvas[data-diagram^="seq-"] [data-segment-id$="-3"]').click();
    assert(await phases.nth(3).evaluate(e=>e.classList.contains('is-open')),'Diagram phase labels open the phase'); assert.equal(await page.locator('.phase-body:not([hidden])').count(),1);
    await page.screenshot({path:path.join(out,'walkthrough-phase.png'),fullPage:false});
    await phases.nth(3).locator('.phase-button').click(); assert.equal(await page.locator('.phase-body:not([hidden])').count(),0);
    await page.goto(pathToFileURL(path.join(root,'index.html')).href+'#detail-core'); assert.equal(await panel.getAttribute('data-node'),'core','Deep link selects a map component');
    await visit('index.html');
    for (const theme of ['dark','light']) {
      if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('#theme-toggle').click();
      for (const [width,height] of [[1440,1000],[1920,1080]]) {
        await page.setViewportSize({width,height}); await fit();
        await page.screenshot({path:path.join(out,`overview-${width}-${theme}.png`)});
      }
    }
    for (const item of data.components) {
      await visit(`components/${item.id}.html`); await fit();
      assert.equal(await page.locator('h1').count(),1);
      assert.equal(await page.locator('nav a[aria-current="page"]').count(),1);
      assert(await page.locator('.evidence a').count()>0);
    }
    await visit('components/CORE-playback.html');
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:path.join(out,'playback-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844}); await fit();
    assert(!await page.locator('#sidebar').isVisible());
    await page.locator('#menu-toggle').click(); assert(await page.locator('#sidebar').isVisible());
    await page.locator('#search').fill('rules'); assert(await page.locator('.nav-item:visible').count()>0);
    await page.locator('#menu-toggle').click(); assert(!await page.locator('#sidebar').isVisible());
    await page.screenshot({path:path.join(out,'playback-mobile.png'),fullPage:true});
    await visit('index.html'); await fit();
    assert(await page.locator('.atlas-map .map-stage').evaluate(e=>e.scrollWidth>e.clientWidth),'Narrow widths scroll the map instead of shrinking it');
    assert(await page.locator('.atlas-canvas[data-diagram^="arch-"] > svg').evaluate(e=>e.getBoundingClientRect().width>=860),'Map keeps a readable width on mobile');
    await page.locator('#map-index > summary').click(); await page.locator('.node-button[data-node="nanoWorker"]').click(); assert.equal(await page.locator('#map-detail').getAttribute('data-node'),'nanoWorker');
    assert.equal((await page.locator('.map-reading').innerText()).match(/\[\[/g),null,'Map reading text has no unresolved [[issue]] markers'); assert.equal((await page.locator('.walk-reading').innerText()).match(/\[\[/g),null,'Walkthrough reading text has no unresolved [[issue]] markers');
    await page.screenshot({path:path.join(out,'overview-mobile.png'),fullPage:true});
    await visit('full-system-design.html');
    await page.setViewportSize({width:1440,height:1000}); await fit();
    assert.equal(await page.locator('article.document').count(),data.components.length);
    assert(await page.locator('a[href^="#"]').evaluateAll(links=>links.every(a=>document.getElementById(a.getAttribute('href').slice(1)))));
    await page.emulateMedia({media:'print'});
    assert(!await page.locator('#sidebar').isVisible());
    assert.equal(await page.locator('article.document:visible').count(),data.components.length);
    await page.pdf({path:path.join(out,'full-system-design.pdf'),format:'A4',printBackground:true});
    assert.equal(await page.locator('.atlas-canvas').count(),2,'Complete reading view embeds both shared diagrams'); assert.equal(await page.locator('#baseline-notes').getAttribute('open'),'');
    await visit('index.html');
    assert.equal(await page.locator('.node-detail:visible').count(),Object.keys(data.map.nodes).length,'Print shows every map detail'); assert.equal(await page.locator('.phase-body:visible').count(),data.map.phases.length,'Print shows every walkthrough phase'); assert(!await page.locator('#map-detail').isVisible()); assert(await page.locator('.map-reading:visible').isVisible(),'Print shows the map reading block'); assert(await page.locator('.walk-reading:visible').isVisible(),'Print shows the walkthrough reading block');
    await page.pdf({path:path.join(out,'overview.pdf'),format:'A4',printBackground:true});
    await page.emulateMedia({media:null});
    assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
    const receipt={ok:true,documents:data.components.length+2,viewports:['1440x1000','1920x1080','390x844'],themes:['dark','light'],checks:['navigation','search','no-results','system-map-first-screen','map-selection-mouse-keyboard-list','map-links','map-zoom','walkthrough-phases','deep-link','theme','mobile-menu','mobile-map-scroll','all-component-pages','anchors','print','print-map-details','no-external-requests','no-console-errors'],overviewSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex'),output:out};
    fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(receipt,null,2)+'\n');
    console.log(JSON.stringify(receipt,null,2));
    await require('./reference/check_reference.cjs').check(browser, path.join(out,'reference'));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
