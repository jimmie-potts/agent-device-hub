const fs = require('fs'), path = require('path'), os = require('os');
const assert = require('assert/strict');
const {pathToFileURL} = require('url');

async function check(browser, output) {
  const root = __dirname;
  fs.mkdirSync(output, {recursive:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.setDefaultTimeout(15000);
  const errors=[], external=[], failed=[];
  page.on('pageerror', e=>errors.push(e.message));
  page.on('request', r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
  page.on('requestfailed', r=>failed.push(r.url()));
  await page.route(/^https?:/, r=>r.abort());
  const visit = async file=>{await page.goto(pathToFileURL(path.join(root,file)).href);};
  const fit = async file=>assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),`Horizontal page overflow: ${file}`);
  try {
    await visit('index.html');
    assert.equal(await page.locator('.card').count(),6);
    for (const width of [1440,390]) {
      await page.setViewportSize({width,height:1000}); await fit('index');
      await page.screenshot({path:path.join(output,`reference-${width}.png`),fullPage:true});
    }
    await page.setViewportSize({width:1440,height:1000});
    for (const service of ['pixoo','nanoleaf-controller','nanoleaf-map']) {
      const spec=JSON.parse(fs.readFileSync(path.join(root,'openapi',service+'.json')));
      await visit('api/'+service+'.html');
      await page.getByRole('heading',{name:spec.info.title,exact:true}).waitFor();
      const groups=new Map();
      for(const [route,methods] of Object.entries(spec.paths))for(const [method,operation] of Object.entries(methods)) {
        const tag=operation.tags[0];
        groups.set(tag,[...(groups.get(tag)||[]),'/'+method.toUpperCase()+route]);
      }
      // Scalar mounts operation details when their group enters the viewport.
      for(const [tag,endings] of groups) {
        await page.locator(`[id$="/tag/${tag.toLowerCase().replaceAll(' ','-')}"]`).scrollIntoViewIfNeeded();
        await page.waitForFunction(endings=>endings.every(end=>[...document.querySelectorAll('[id]')].some(node=>node.id.endsWith(end))),endings);
      }
      assert.equal(await page.getByRole('button',{name:/Test Request|Send Request|Ask AI|Ask Scalar/}).count(),0);
      await fit(service);
      await page.screenshot({path:path.join(output,service+'-api.png')});
      if(service==='pixoo') {
        await page.getByRole('button',{name:/^Open Search/}).click();
        const search=page.getByRole('combobox');
        await search.fill('Duplicate a playlist');
        await page.getByRole('option').filter({hasText:'Duplicate a playlist'}).first().waitFor();
        await page.keyboard.press('Escape');
      }
      await page.setViewportSize({width:390,height:844}); await fit(service+' mobile');
      await page.screenshot({path:path.join(output,service+'-api-mobile.png')});
      await page.setViewportSize({width:1440,height:1000});
    }
    let tableCount=0;
    for (const name of ['pixoo-library','pixoo-owner','nanoleaf']) {
      const schema=JSON.parse(fs.readFileSync(path.join(root,'schemas',name+'.json')));
      await visit(`database/${name}/index.html`);
      assert.equal(await page.locator('#database_objects tbody tr').count(),schema.tables.length);
      await page.screenshot({path:path.join(output,name+'-tables.png')});
      for(const table of schema.tables) {
        await visit(`database/${name}/tables/${table.name}.html`);
        await page.locator('#standard_table').waitFor();
        const text=await page.locator('#standard_table').innerText();
        for(const column of table.columns)assert(text.includes(column.name),`Missing column: ${name}.${table.name}.${column.name}`);
        tableCount++;
      }
      await visit(`database/${name}/relationships.html`);
      if(name==='pixoo-library')assert(await page.locator('object.diagram').count()>0);
      await page.screenshot({path:path.join(output,name+'-relationships.png')});
      await page.setViewportSize({width:390,height:844});
      await visit(`database/${name}/index.html`); await fit(name+' mobile');
      await page.screenshot({path:path.join(output,name+'-mobile.png')});
      await page.setViewportSize({width:1440,height:1000});
    }
    assert.equal(tableCount,28);
    assert.deepEqual(errors,[]); assert.deepEqual(external,[]); assert.deepEqual(failed,[]);
    const receipt={ok:true,operations:37,tables:28,viewports:['1440x1000','390x844'],checks:['Scalar operation coverage','Scalar search','no live request buttons','all table columns','relationship diagrams','offline assets','mobile layout','no page errors']};
    fs.writeFileSync(path.join(output,'reference-browser.json'),JSON.stringify(receipt,null,2)+'\n');
    console.log(JSON.stringify(receipt));
  } finally {await page.close();}
}

module.exports={check};
if (require.main===module) {
  (async()=>{
    const {chromium}=require(process.env.GUIDE_PLAYWRIGHT_MODULE || 'playwright');
    const browser=await chromium.launch({headless:true,executablePath:process.env.GUIDE_CHROMIUM_PATH,args:['--no-sandbox']});
    try {await check(browser,process.env.BUNNY_DESIGN_RECEIPTS || fs.mkdtempSync(path.join(os.tmpdir(),'bunny-reference-')));}
    finally {await browser.close();}
  })().catch(error=>{console.error(error);process.exitCode=1;});
}
