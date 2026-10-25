import assert from 'node:assert/strict';
import {test} from 'node:test';
import {qaEvidenceAvailable} from '../src/features/qa/evidenceAvailability';
import type {QaEvidence} from '../src/features/qa/types';
test('expired, missing and deleted screenshots do not satisfy evidence requirements',()=>{
 const evidence={kind:'SCREENSHOT',assets:[{asset:{status:'READY',evidenceExpiresAt:'2026-10-14T12:00:00Z'}}]} as QaEvidence;
 assert.equal(qaEvidenceAvailable(evidence,Date.parse('2026-10-14T11:59:59Z')),true);
 assert.equal(qaEvidenceAvailable(evidence,Date.parse('2026-10-14T12:00:00Z')),false);
 for(const status of ['EXPIRED','MISSING','DELETE_PENDING']){evidence.assets[0]!.asset.status=status;assert.equal(qaEvidenceAvailable(evidence,0),false);}
 assert.equal(qaEvidenceAvailable({...evidence,assets:[]}),false);assert.equal(qaEvidenceAvailable({...evidence,kind:'TEXT',assets:[]}),true);
});

test('valid external screenshots fulfill requirements while expired local bindings still block them',()=>{
 const evidence={kind:'SCREENSHOT',externalReference:'https://evidence.example.test/proof.png',assets:[]} as unknown as QaEvidence;
 assert.equal(qaEvidenceAvailable(evidence),true);
 for(const reference of ['http://example.test/proof.png','https://user:password@example.test/proof.png','invalid',null])
  assert.equal(qaEvidenceAvailable({...evidence,externalReference:reference}),false);
 const expired={asset:{status:'READY',evidenceExpiresAt:'2026-10-14T12:00:00Z'}} as QaEvidence['assets'][number];
 assert.equal(qaEvidenceAvailable({...evidence,assets:[expired]},Date.parse('2026-10-14T12:00:00Z')),false);
 assert.equal(qaEvidenceAvailable({...evidence,assets:[{...expired,asset:{...expired.asset,status:'MISSING'}}]}),false);
});
