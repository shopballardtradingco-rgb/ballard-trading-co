import importlib.util
import json
import re
import subprocess
from copy import deepcopy
from pathlib import Path

import pytest
from test_listings import bundle as bundle
from btco_ebay.listing_drafts import ListingDraft

spec = importlib.util.spec_from_file_location('review_approval', Path(__file__).parents[1] / 'scripts/review_approval.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def row_for(bundle):
    _, source, _ = bundle
    d = ListingDraft.model_validate(source)
    return {'draft': d.model_dump(mode='json'), 'revision': d.revision(), 'state': 'draft', 'job': {}, 'approval': None}


def test_button_binds_exact_saved_revision_and_refuses_stale_or_published_reviews(bundle):
    row = row_for(bundle)
    fragment = module.build(row)
    assert 'Approve this listing' in fragment
    assert row['revision'] in fragment
    for patch in [{'revision': '0'*64}, {'state': 'published'}, {'job': {'phase': 'inventory'}}, {'approval': {'approved': True}}]:
        with pytest.raises(ValueError):
            module.build({**row, **patch})
    changed = deepcopy(row)
    changed['draft']['price_usd'] = '9'
    with pytest.raises(ValueError):
        module.build(changed)


def test_review_button_escapes_content_and_never_sends_without_a_real_checked_click(bundle):
    row = row_for(bundle)
    row['draft']['title'] = 'Synthetic </script><img src=x onerror=alert(1)>'
    row['revision'] = ListingDraft.model_validate(row['draft']).revision()
    fragment = module.build(row)
    assert '<img src=x' not in fragment
    payload = re.search(r'id="btco-approval-payload">(.*?)</script>', fragment, re.S).group(1)
    script = re.findall(r'<script>(.*?)</script>', fragment, re.S)[0]
    harness = r'''
const vm=require('node:vm'),assert=require('node:assert/strict');
const input=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
(async()=>{
for(const host of [true,false]){
 const calls=[],nodes={};
 for(const id of ['btco-reviewed','btco-approve','btco-approval-status','btco-approval-payload'])nodes[id]={checked:false,disabled:id==='btco-approve',textContent:id==='btco-approval-payload'?input.payload:'',handlers:{},addEventListener(n,f){this.handlers[n]=f;}};
 const ctx={document:{getElementById:id=>nodes[id]},navigator:{userActivation:{isActive:true}},window:{addEventListener(){},...(host?{openai:{sendFollowUpMessage:async p=>calls.push(p)}}:{})}};
 vm.runInNewContext(input.script,ctx);assert.equal(calls.length,0);assert.equal(nodes['btco-approve'].disabled,true);
 nodes['btco-reviewed'].checked=true;nodes['btco-reviewed'].handlers.change();
 await nodes['btco-approve'].handlers.click({isTrusted:false});assert.equal(calls.length,0);
 await nodes['btco-approve'].handlers.click({isTrusted:true});assert.equal(calls.length,host?1:0);
 if(host){assert.equal(calls[0].context.revision,input.revision);assert.match(nodes['btco-approval-status'].textContent,/request sent/);await nodes['btco-approve'].handlers.click({isTrusted:true});assert.equal(calls.length,1);}
}
})().catch(e=>{console.error(e);process.exit(1)});
'''
    subprocess.run(['node', '-e', harness], input=json.dumps({'script': script, 'payload': payload, 'revision': row['revision']}), text=True, check=True, capture_output=True)
