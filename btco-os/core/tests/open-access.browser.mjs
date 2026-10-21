import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../store.mjs';
import {createApp} from '../server.mjs';

const fixtureDir=await mkdtemp(join(tmpdir(),'btcore-browser-bulk-'));
const origin='http://127.0.0.1:3211';
const store=await openStore({sqlitePath:':memory:',allowSqlite:true});
const {server}=await createApp({store,origin,allowLocal:true,accessMode:'open',objectStore:{kind:'object'}});
await new Promise(r=>server.listen(3211,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.BTCORE_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.getByRole('heading',{name:'Make room for what’s next.'}).waitFor();
 if(process.env.BTCORE_SCREENSHOT_DIR)await page.screenshot({path:process.env.BTCORE_SCREENSHOT_DIR+'/open-desktop.png',fullPage:true});
 assert.equal(await page.locator('#auth-form').count(),0);assert.equal(await page.getByRole('button',{name:'Sign out',exact:true}).count(),0);
 await page.locator('.sidebar [data-nav="settings"]').click();
 await page.getByRole('heading',{name:'Open and ready.'}).waitFor();assert.equal(await page.locator('input[type="password"]').count(),0);
 await page.locator('.sidebar [data-nav="inventory"]').click();await page.getByRole('button',{name:'Add item',exact:true}).first().click();
 await page.locator('#item-form [name="title"]').fill('Synthetic no-login acceptance');
 await page.getByRole('button',{name:'Save inventory'}).click();await page.getByRole('button',{name:'Record a sale',exact:true}).waitFor();
 await page.reload();await page.getByRole('heading',{name:'Make room for what’s next.'}).waitFor();
 assert.equal((await store.workspace()).inventory.items.length,1);
 const mobile=await browser.newPage({viewport:{width:390,height:844}});
 await mobile.goto(origin);await mobile.getByRole('heading',{name:'Make room for what’s next.'}).waitFor();
 if(process.env.BTCORE_SCREENSHOT_DIR)await mobile.screenshot({path:process.env.BTCORE_SCREENSHOT_DIR+'/open-mobile.png',fullPage:true});
 assert.equal(await mobile.locator('#auth-form').count(),0);
 assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await mobile.getByRole('button',{name:'Bulk upload',exact:true}).click();
 await mobile.locator('#batch-kind').selectOption('card');await mobile.getByLabel('Add card fronts only',{exact:true}).waitFor();
 const jpeg=await sharp({create:{width:180,height:240,channels:3,background:'#345b45'}}).jpeg().toBuffer();
 const large=Buffer.concat([jpeg,Buffer.alloc(3*1024*1024-jpeg.length)]);
 const files=[];for(let i=0;i<24;i++){const file=join(fixtureDir,`synthetic-large-${i}.jpg`);await writeFile(file,large);files.push(file);}
 await mobile.getByLabel('Add card fronts only',{exact:true}).setInputFiles(files);
 assert.equal(await mobile.locator('.batch-card').count(),24);
 assert.equal(await mobile.locator('#main .form-error').textContent(),'');
 await mobile.getByText('Photo space remaining: 10.0 GB.',{exact:false}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS: direct desktop/mobile entry, settings without passwords, saved record survives refresh, fresh browser shares workspace, card batch accessible, 72 MiB phone-sized batch accepted.');
}finally{await browser.close();await new Promise(r=>server.close(r));await store.close();await rm(fixtureDir,{recursive:true,force:true});}
