import pytest
from copy import deepcopy
from btco_ebay.listing_drafts import CardListingDraft, ListingDraft, parse_listing, ConditionDescriptor
from btco_ebay.card_conditions import validate_descriptors
from btco_ebay.publishing import inventory_matches
from btco_ebay.listing_validation import validate_new_standards
from test_listings import bundle, publisher, run

def card(data):
    return {**data, 'product_type':'card','draft_id':'btco-card-synthetic',
        'photos':data['photos'][:1], 'inspection':None, 'category_id':'261328',
        'identity':{'subject':'Test Player','set_name':'Test Set','year':2024,'number':'1','verified':True,'evidence':'Synthetic photo inspection only.'},
        'item_specifics':{'Player/Athlete':['Test Player'],'Set':['Test Set'],'Year Manufactured':['2024'],'Card Number':['1']},
        'condition':'USED_VERY_GOOD','condition_descriptors':[{'name':'40001','values':['400011']}]}

def test_front_only_card_publishes_once_and_preserves_master_sku(bundle):
    repo,data,images=bundle;data=card(data)
    draft=parse_listing(data);assert isinstance(draft,CardListingDraft)
    validate_new_standards(draft)
    pub,fake,row=publisher((repo,data,images));result=run(pub,row)
    assert result['receipt']['master_sku']==' CDP-Master-1 '
    assert fake.item['conditionDescriptors']==[{'name':'40001','values':['400011']}]
    assert fake.calls==['upload','put','create','publish']
    assert run(pub,row)==result and fake.calls.count('publish')==1
    changed=deepcopy(fake.item);changed['conditionDescriptors'][0]['values']=['400012']
    assert not inventory_matches(changed,fake.item)

@pytest.mark.parametrize('failure',['put','create','publish'])
def test_card_uncertain_write_recovers_without_second_write(bundle,failure):
    repo,data,images=bundle;pub,fake,row=publisher((repo,card(data),images));fake.failure=failure
    try:run(pub,row)
    except Exception:pass
    fake.failure=None
    try:run(pub,row)
    except Exception:pass
    assert fake.calls.count(failure)<=1

def test_comic_serialization_and_photo_requirement_unchanged(bundle):
    _,data,_=bundle;assert parse_listing(data).revision()==ListingDraft.model_validate(data).revision()
    data['photos']=data['photos'][:1]
    with pytest.raises(ValueError):parse_listing(data)

@pytest.mark.parametrize('change',[{'photos':[]},{'condition_descriptors':[]},{'master_sku':None},{'condition':'USED_GOOD'},{'category_id':'259104'},{'condition_descriptors':[{'name':'27501','values':['275010']}]}])
def test_card_invalid_contract_rejected(bundle,change):
    with pytest.raises(ValueError):parse_listing({**card(bundle[1]),**change})

def test_grade_must_match_current_grader_metadata():
    metadata={'conditionDescriptors':[
      {'conditionDescriptorId':'27501','conditionDescriptorValues':[{'conditionDescriptorValueId':'275010'}]},
      {'conditionDescriptorId':'27502','conditionDescriptorValues':[{'conditionDescriptorValueId':'275020','conditionDescriptorValueConstraints':[{'applicableToConditionDescriptorId':'27501','applicableToConditionDescriptorValueIds':['275010']}]}]}]}
    choices=[ConditionDescriptor(name='27501',values=['275010']),ConditionDescriptor(name='27502',values=['275020'])]
    validate_descriptors(metadata,choices)
    with pytest.raises(ValueError):validate_descriptors(metadata,[ConditionDescriptor(name='27501',values=['999']),choices[1]])
    metadata['conditionDescriptors'][1]['conditionDescriptorValues'][0]['conditionDescriptorValueConstraints'][0]['applicableToConditionDescriptorValueIds']=['999']
    with pytest.raises(ValueError,match='grader'):validate_descriptors(metadata,choices)

def test_core_callback_is_exact_allowlist_and_opt_in():
    from dataclasses import replace
    from cryptography.fernet import Fernet
    from btco_ebay.auth import Provider
    from btco_ebay.config import Settings
    settings=Settings('https://connector.example','id','secret','runame',Fernet.generate_key().decode())
    uri='https://core.example/api/ebay/callback'
    assert not Provider(settings,None,None).callback_allowed(uri)
    provider=Provider(replace(settings,core_callback_url=uri),None,None)
    assert provider.callback_allowed(uri)
    for bad in [uri+'?evil=1',uri+'/',uri.replace('core.example','core.example.evil'),uri.replace('https:','http:')]:assert not provider.callback_allowed(bad)

def test_cards_share_batch_engine_with_individual_condition_checks(bundle):
    import asyncio
    from btco_ebay.listing_batches import ListingBatches
    from btco_ebay.publishing import Publisher
    from test_listing_batches import MultiSelling
    repo,source,images=bundle;repo.store.put('grant','family',{'user_id':'seller'},family='family')
    entries=[]
    for n in range(2):
        d=card(source);d.update(draft_id=f'btco-card-{n}',physical_item_id=f'copy-{n}',master_sku=f'CARD-{n}',title=f'Synthetic card {n}')
        d['photos']=[{**source['photos'][n],'role':'front'}]
        d['condition_descriptors']=[{'name':'40001','values':['40001'+str(n)]}]
        entries.append({'item_key':str(n),'label':d['title'],'draft':d})
    fake=MultiSelling(images);engine=ListingBatches(repo,Publisher(repo,fake,True,collector=fake.collect))
    engine.submit('seller',{'batch_id':'btco-batch-cards','inventory_location':'TEST','items':entries})
    review=asyncio.run(engine.prepare('seller','family','btco-batch-cards'))
    assert len(review['listings'])==2 and len(fake.policy_reads)==2
    engine.approve('seller','btco-batch-cards',review['review_revision'],'Owner approved full synthetic card review and originals.')
    result=asyncio.run(engine.publish('seller','family','btco-batch-cards',review['review_revision'],max_items=2))
    assert result['verified_count']==2 and fake.calls.count('publish')==2
    asyncio.run(engine.publish('seller','family','btco-batch-cards',review['review_revision'],max_items=2))
    assert fake.calls.count('publish')==2

def test_graded_card_and_envelope_price_guard(bundle):
    from btco_ebay.card_conditions import validate_card_shipping
    data=card(bundle[1]);data.update(condition='LIKE_NEW',condition_descriptors=[{'name':'27501','values':['275010']},{'name':'27502','values':['275022']},{'name':'27503','additionalInfo':'12345678'}])
    draft=parse_listing(data);assert draft.inventory_payload(['https://image.example'])['conditionDescriptors'][-1]=={'name':'27503','additionalInfo':'12345678'}
    policy={'fulfillment_policy':{'shippingOptions':[{'shippingServices':[{'shippingServiceCode':'US_eBayStandardEnvelope'}]}]}}
    with pytest.raises(ValueError,match='bubble'):validate_card_shipping(policy,draft)
    data=card(bundle[1]);data['price_usd']='21'
    with pytest.raises(ValueError,match='bubble'):validate_card_shipping(policy,parse_listing(data))
    data['price_usd']='20';validate_card_shipping(policy,parse_listing(data))
