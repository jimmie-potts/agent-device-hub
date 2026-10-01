import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {fixture} from './fixture.mjs';
const browser=await chromium.launch({headless:true}),f=await fixture({catalog:true,browserAccess:'trusted-loopback',empty:true});
const page=await browser.newPage({reducedMotion:'reduce'});page.setDefaultTimeout(15000);
try {
 for(let i=2;i<26;i++)f.catalogData.playlists.push({id:`00000000-0000-4000-8000-${String(100+i).padStart(12,'0')}`,name:`Named playlist ${i+1}`,revision:1,itemCount:1,repeat:false,shuffle:false});
 f.states.pixel.capabilities.media.playlistIds=f.catalogData.playlists.map(p=>p.id);
 await page.goto(f.hub.url+'/#/component/pixel');
 const component=page.getByRole('region',{name:'pixel',exact:true}),grid=component.locator('[data-widget=pixoo-media]'),playlists=component.locator('[data-widget=pixoo-playlists]'),select=component.getByLabel('Saved playlist');
 await playlists.getByRole('button',{name:/Evening colors/}).waitFor();
 await select.waitFor();
 const failures=[];
 const names=async()=>await select.locator('option').allTextContents();
 await page.waitForTimeout(500);
 if(!(await names()).includes('Named playlist 26'))failures.push('all declared playlist names must load before paging');
 await playlists.getByRole('button',{name:'Next page',exact:true}).click();await playlists.getByRole('button',{name:/Named playlist 26/}).waitFor();
 if(!(await names()).includes('Evening colors'))failures.push('paging must retain names on the previous page');
 f.catalogData.media[0].compatible=true;
 f.pixoo.serverId='11111111-1111-4111-8111-111111111111';f.pixoo.nextRequestId=f.pixoo.serverId+':1';
 await grid.getByText('Preview available · playback outside configured profile',{exact:true}).waitFor({state:'hidden',timeout:12000}).catch(()=>failures.push('server epoch change must refresh compatibility at unchanged catalog revision'));
 for(let i=26;i<102;i++)f.catalogData.playlists.push({id:`00000000-0000-4000-8000-${String(100+i).padStart(12,'0')}`,name:`Named playlist ${i+1}`,revision:1,itemCount:1,repeat:false,shuffle:false});
 f.states.pixel.capabilities.media.playlistIds=f.catalogData.playlists.slice(0,25).map(p=>p.id).concat(f.catalogData.playlists[101].id);
 await select.locator('option').filter({hasText:'Named playlist 102'}).waitFor({state:'attached'}).catch(()=>failures.push('declared names beyond the first catalog page must resolve by bounded detail reads'));
 if(failures.length)console.log(JSON.stringify({names:await names(),reads:f.catalogData.reads.filter(p=>p.includes('/catalog/playlists'))}));
 assert.deepEqual(failures,[]);
 assert.deepEqual(f.writes,[]);
 console.log('Pixoo restart and playlist-name paging regressions passed');
} finally {await page.close();await f.close();await browser.close();}
