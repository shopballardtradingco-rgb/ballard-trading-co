import {openStore} from '../store.mjs';
import {createApp} from '../server.mjs';
import {digest} from '../auth.mjs';
const store=await openStore({sqlitePath:process.env.BTCORE_PREVIEW_DB??':memory:',allowSqlite:true});
const {server}=await createApp({store,origin:'http://127.0.0.1:3100',allowLocal:true,setupTokenHash:digest('synthetic-preview-setup')});
server.listen(3100,'127.0.0.1',()=>console.log('Synthetic local acceptance app listening on 3100'));
process.on('SIGTERM',()=>server.close(async()=>{await store.close();process.exit(0);}));
