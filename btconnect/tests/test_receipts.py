import base64
import json
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from test_connector import env as env, connect, tool, rpc, CALLBACK, CHALLENGE
from btco_ebay.receipts import ReceiptSigner, DOMAIN
from btco_ebay.config import SCOPE, WRITE_SCOPE


def test_access_request_challenges_without_writes_then_reports_consented(env):
    client, provider, _, state = env
    _, tokens = connect(env)
    before = len(state['requests'])
    result = rpc(client, tokens['access_token'], 'tools/call', {'name':'request_listing_access','arguments':{}}).json()['result']
    assert result['isError'] and result['_meta']['mcp/www_authenticate']
    assert len(state['requests']) == before
    _, tokens = connect(env, scope=SCOPE+' '+WRITE_SCOPE)
    result = tool(client, tokens['access_token'], 'request_listing_access')
    assert result['connector_listing_scope'] and not result['publication_enabled']


def test_existing_read_client_can_request_fresh_consent_without_upgrading_old_token(env):
    client, _, settings, state = env
    identity, tokens = connect(env)
    before = len(state['requests'])
    response = client.get('/authorize',params={'client_id':identity['client_id'],'response_type':'code','redirect_uri':CALLBACK,'scope':SCOPE+' '+WRITE_SCOPE,'code_challenge':CHALLENGE,'code_challenge_method':'S256','resource':settings.resource})
    assert '/consent?' in response.headers['location']
    assert 'Listing permission requested' in client.get(response.headers['location']).text
    assert not tool(client,tokens['access_token'],'get_listing_readiness')['connector_listing_scope']
    assert len(state['requests']) == before


def test_receipt_export_is_persisted_seller_bound_and_key_survives_restart(env):
    client, provider, settings, _ = env
    _, tokens = connect(env)
    signer = ReceiptSigner(provider.store)
    item_id = '999000000001'
    with pytest.raises(ValueError, match='No verified'):
        signer.export('seller-123', item_id)
    receipt = {'schema':'btco.publication.v1','seller_id':'seller-123','item_id':item_id,'title':'Synthetic comic — test only'}
    provider.store.put('publication','seller-123:'+item_id,receipt)
    envelope = tool(client,tokens['access_token'],'get_publication_receipt',{'item_id':item_id})
    public = tool(client,tokens['access_token'],'get_connection_status')['receipt_verification_key']
    payload = base64.b64decode(envelope['payload_b64'])
    Ed25519PublicKey.from_public_bytes(base64.b64decode(public['public_key_b64'])).verify(base64.b64decode(envelope['signature_b64']),DOMAIN+payload)
    assert json.loads(payload) == receipt
    from btco_ebay.store import Store
    restarted = ReceiptSigner(Store(settings.db_path,settings.encryption_key))
    assert restarted.descriptor == signer.descriptor
    assert restarted.export('seller-123',item_id) == envelope
    with pytest.raises(ValueError,match='No verified'):
        restarted.export('other-seller',item_id)
    response = rpc(client,tokens['access_token'],'tools/call',{'name':'get_publication_receipt','arguments':{'item_id':'malformed'}})
    assert response.json()['result']['isError']
    # Only the public verification key is returned to clients.
    assert 'private_key' not in json.dumps(public)
    raw = open(settings.db_path,'rb').read()
    assert base64.b64decode(provider.store.get('signing-key','publication-v1')['private_key']) not in raw
