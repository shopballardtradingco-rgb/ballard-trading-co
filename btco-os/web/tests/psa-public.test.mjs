import test from 'node:test';
import assert from 'node:assert/strict';
import {psaPublicLinks} from '../domain/psa-public.mjs';

test('public certificate links retain exact certificate identity including leading zeroes',()=>{
  const links=psaPublicLinks(' 00123456 ');
  assert.equal(new URL(links.official).origin,'https://www.psacard.com');
  assert.equal(new URL(links.official).pathname,'/cert/00123456/psa');
  assert.equal(new URL(links.google).origin,'https://www.google.com');
  assert.equal(new URL(links.google).searchParams.get('q'),'site:psacard.com/cert/ "00123456"');
});
test('public lookup rejects URLs, embedded query operators, tokens and malformed certificate values',()=>{
  for(const value of ['',12345678,null,'1234','1234567890123','https://evil.example/12345678','24311536" OR site:evil.example','<script>12345678</script>','1234\n5678','not-a-provider-token'])assert.equal(psaPublicLinks(value),null);
});
