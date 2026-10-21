import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {openStore} from '../store.mjs';
import {createApp} from '../server.mjs';
const origin='http://127.0.0.1:3231',store=await openStore({sqlitePath:':memory:',allowSqlite:true});
const app=await createApp({store,origin,allowLocal:true,accessMode:'open',workerAutoStart:false});await new Promise(r=>app.server.listen(3231,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.BTCORE_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 await page.goto(origin);await page.getByRole('button',{name:'The Vault',exact:true}).click();
 await page.locator('#inventory-cdp-csv').setInputFiles({name:'synthetic-cdp.csv',mimeType:'text/csv',buffer:Buffer.from('ID,SKU,Title,Quantity,Cabinet,Shelf,Box,Row,Section,Purchase Price\nSOURCE-1,MASTER-007,Example synthetic card,1,Office,01,B005,1,2,12.34\nSOURCE-2,MASTER-008,Missing location card,1,,,,,,0.00\n')});
 await page.getByRole('heading',{name:'Date of CDP export',exact:true}).waitFor();await page.locator('[name="observedAt"]').fill('2026-01-01T12:00');await page.getByRole('button',{name:'Preview migration',exact:true}).click();await page.getByRole('heading',{name:'Review inventory migration',exact:true}).waitFor();assert.equal((await store.workspace()).inventory.items.length,0);
 await page.getByRole('button',{name:'Import inventory',exact:true}).click();await page.getByRole('button',{name:'Example synthetic card',exact:true}).waitFor();await page.getByText('Office → Box B005 → Row 1 → Section 2 (Shelf 01)',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Location issues',exact:true}).click();await page.getByRole('heading',{name:'Location issues',exact:true}).waitFor();await page.getByText(/2 records · 1 missing/).waitFor();await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.locator('#search').fill('MASTER-007');assert.equal(await page.locator('#inventory-table tbody tr').count(),1);
 assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 console.log('PASS: mobile CDP migration preview/import, exact location, missing-location audit and SKU search.');
}finally{await browser.close();await new Promise(r=>app.server.close(r));await store.close();}
