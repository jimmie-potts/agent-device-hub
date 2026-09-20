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
    await page.screenshot({path:path.join(out,'overview-mobile.png'),fullPage:true});
    await visit('full-system-design.html');
    await page.setViewportSize({width:1440,height:1000}); await fit();
    assert.equal(await page.locator('article.document').count(),data.components.length);
    assert(await page.locator('a[href^="#"]').evaluateAll(links=>links.every(a=>document.getElementById(a.getAttribute('href').slice(1)))));
    await page.emulateMedia({media:'print'});
    assert(!await page.locator('#sidebar').isVisible());
    assert.equal(await page.locator('article.document:visible').count(),data.components.length);
    await page.pdf({path:path.join(out,'full-system-design.pdf'),format:'A4',printBackground:true});
    assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
    const receipt={ok:true,documents:data.components.length+2,viewports:['1440x1000','1920x1080','390x844'],themes:['dark','light'],checks:['navigation','search','no-results','theme','mobile-menu','all-component-pages','anchors','print','no-external-requests','no-console-errors'],overviewSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex'),output:out};
    fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(receipt,null,2)+'\n');
    console.log(JSON.stringify(receipt,null,2));
    await require('./reference/check_reference.cjs').check(browser, path.join(out,'reference'));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
