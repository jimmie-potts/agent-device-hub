// Disposable runtime and fake robot; actual vendor MuJoCo is a separate owner-selected exercise.
import assert from 'node:assert/strict';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium} from 'playwright';
import {feed,startWorld} from './harness.ts';
function reachyItem(value:unknown):{id:string;revision:number}|undefined {
 if(Array.isArray(value)){for(const item of value){const found=reachyItem(item);if(found!==undefined)return found;}return undefined;}
 if(typeof value!=='object'||value===null)return undefined;
 if('id'in value&&typeof value.id==='string'&&'revision'in value&&typeof value.revision==='number'&&'item'in value&&typeof value.item==='object'&&value.item!==null&&'command'in value.item&&typeof value.item.command==='string'&&value.item.command.startsWith('org.bunny.reachy.'))return {id:value.id,revision:value.revision};
 for(const child of Object.values(value)){const found=reachyItem(child);if(found!==undefined)return found;}return undefined;
}
const world=await startWorld({reachy:true,companions:true}),browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 await page.goto(`${world.url}/#/module/reachy-mini/controls`);await feed(page,'connected');
 const panel=page.getByRole('region',{name:'Reachy robot controls'});await panel.getByRole('status').filter({hasText:'Simulator available'}).waitFor();
 const mcpStatus=await world.reachyMcp('reachy-mini_status',{});assert.match(JSON.stringify(mcpStatus),/simulated/);const refused=await world.reachyMcp('core_send_command',{family:'reachy-gesture',target:'reachy-sim',data:{gesture:'notice'}});assert.match(JSON.stringify(refused),/forbidden/);
 assert.equal(world.reachy.effects.length,0);assert.match(await panel.innerText(),/Simulation/);assert.equal(await panel.getByRole('button',{name:'Notice gesture',exact:true}).isDisabled(),true);
 await panel.getByRole('button',{name:'Take over',exact:true}).focus();await page.keyboard.press('Enter');await panel.getByText('Manual takeover',{exact:true}).waitFor();
 await panel.getByRole('button',{name:'Notice gesture',exact:true}).click();await panel.getByText(/^Completed: succeeded\./).first().waitFor();assert.equal(world.reachy.state().moves,2);
 world.reachy.autoComplete=false;await panel.getByRole('button',{name:'Attention gesture',exact:true}).click();await panel.getByText('Active attention task',{exact:true}).waitFor();
 assert.equal(await panel.getByRole('button',{name:'Stop task',exact:true}).isEnabled(),true);await panel.getByRole('button',{name:'Stop task',exact:true}).click();await panel.getByText('No active task',{exact:true}).waitFor();assert.equal(world.reachy.effects.filter(x=>x.kind==='cancel').length,1);
 const saved=reachyItem(await world.reachyMcp('core_inbox',{}));assert.ok(saved,'cancelled gesture has a tracked inbox item');const beforeResend=world.reachy.effects.length;const replay=await world.reachyMcp('core_handle_inbox',{id:saved.id,expectedRevision:saved.revision,action:'send-again'});assert.match(JSON.stringify(replay),/forbidden/);assert.equal(world.reachy.effects.length,beforeResend,'MCP cannot move through saved-command resend');
 for(const width of [320,390,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await panel.screenshot({path:'/tmp/reachy-browser.png'});
 const axe=await new AxeBuilder({page}).analyze();assert.deepEqual(axe.violations,[]);assert.deepEqual(errors,[]);
 await page.reload();await feed(page,'connected');await panel.getByRole('status').filter({hasText:'Simulator available'}).waitFor();assert.equal(world.reachy.state().moves,3,'reload is passive');
 world.reachy.act('offline');await panel.getByRole('status').filter({hasText:/Simulator (unavailable|stale)/}).waitFor();assert.equal(await panel.getByRole('button',{name:'Notice gesture',exact:true}).isDisabled(),true);assert.equal((await world.assistantRead()).status,200,'an unavailable robot does not disable virtual companions');
 console.log('Reachy browser: keyboard, bounded gestures, independent stop, reload, narrow/reduced-motion and axe passed');
}finally{await browser.close();await world.close();}
