"""CI only: real container acceptance, no production credentials or eBay calls."""
import base64
import http.client
import json
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import time
import uuid

root = Path(__file__).resolve().parent
os.chdir(root)
def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)
run('python3','initialize.py','core.example.test','connect.example.test')
private = root/'private'
# All secrets here are newly generated, disposable synthetic test values.
key = base64.urlsafe_b64encode(os.urandom(32)).decode()
(private/'connector.env').write_text(
    f'TOKEN_ENCRYPTION_KEY={key}\nEBAY_CLIENT_ID=synthetic\nEBAY_CLIENT_SECRET=synthetic\n'
    'EBAY_RUNAME=synthetic\nEBAY_ALLOWED_SELLER=ballardtradingco\nBTCO_PUBLICATION_ENABLED=false\n')
(private/'connector-data').mkdir()
run('sudo','chown','10001:10001',str(private/'connector-data'))
original_caddy = (root/'Caddyfile').read_text()
(root/'Caddyfile').write_text('core.example.test {\n tls internal\n reverse_proxy core:3000\n}\n'
                            'connect.example.test {\n tls internal\n reverse_proxy connector:8000\n}\n')
(root/'compose.test.yaml').write_text('networks:\n  default:\n    internal: true\n')
compose = ['docker','compose','-f','compose.yaml','-f','compose.test.yaml']
cookie = ''
csrf = ''
def request(path, data=None, *, host='core.example.test', auth=True):
    global cookie, csrf
    conn = http.client.HTTPSConnection('127.0.0.1',443,context=ssl._create_unverified_context(),timeout=15)
    headers={'Host':host,'Origin':'https://'+host}
    if auth: headers.update({'Cookie':cookie,'X-CSRF-Token':csrf})
    if data is not None: headers['Content-Type']='application/json'
    conn.request('POST' if data is not None else 'GET',path,json.dumps(data) if data is not None else None,headers)
    response=conn.getresponse(); raw=response.read()
    if response.getheader('Set-Cookie'): cookie=response.getheader('Set-Cookie').split(';')[0]
    try: result=json.loads(raw)
    except ValueError: result=raw.decode()
    if isinstance(result,dict) and result.get('csrf'): csrf=result['csrf']
    status=response.status; conn.close()
    return status,result
try:
    run(*compose,'up','-d','--wait','database')
    run(*compose,'run','--rm','provision')
    run(*compose,'--profile','publisher','up','-d','--wait','core','connector','edge')
    for attempt in range(30):
        try:
            if request('/healthz')[0]==200: break
        except (OSError, http.client.HTTPException): pass
        time.sleep(1)
    assert request('/healthz')[1]['version']=='0.7.4'
    assert request('/api/workspace',auth=False)[0]==401
    assert request('/api/setup',{'setupCode':'wrong','email':'owner@example.test','password':'synthetic-owner-password-123'})[0]==401
    assert request('/api/setup',{'setupCode':(private/'owner-setup-code.txt').read_text().strip(),
           'email':'owner@example.test','password':'synthetic-owner-password-123'})[0]==201
    assert request('/api/items',{'expectedRevision':0,'operationId':str(uuid.uuid4()),
           'data':{'title':'Synthetic independent-host item','kind':'card','quantity':1}})[0]==200
    assert request('/api/workspace')[1]['state']['revision']==1
    # Runtime role must not own schema/migration permissions.
    run(*compose,'exec','-T','core','node','--input-type=module','-e',
        'import pg from "pg"; const c=new pg.Client({connectionString:process.env.BTCORE_APP_DATABASE_URL});'
        'await c.connect();let denied=false;try{await c.query("CREATE TABLE should_fail(id int)")}'
        'catch(e){denied=e.code==="42501"}finally{await c.end()}if(!denied)process.exit(1);')
    assert request('/health',host='connect.example.test',auth=False)[0]==200
    assert request('/mcp',{'jsonrpc':'2.0','id':1,'method':'tools/list'},host='connect.example.test',auth=False)[0]==401
    run(*compose,'restart','database','core','connector')
    run(*compose,'up','-d','--wait','core')
    assert request('/api/workspace')[1]['state']['inventory']['items'][0]['title']=='Synthetic independent-host item'
    print('PASS: proxy TLS, private access, owner setup, app-role isolation, saved-state restart, non-root connector and unauthorized MCP rejection.')
finally:
    run(*compose,'--profile','publisher','down','-v','--remove-orphans')
    (root/'Caddyfile').write_text(original_caddy)
    (root/'compose.test.yaml').unlink(missing_ok=True)
    (root/'.env').unlink(missing_ok=True)
    run('sudo','rm','-rf',str(private))
