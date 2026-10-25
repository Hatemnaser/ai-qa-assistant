import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {unzipSync,strFromU8,strToU8,zipSync} from 'fflate';
import {toQaReportRequest} from '../src/modules/qa-requests/qa-report.mapper.ts';
import {collectQaReportBinaries,createQaReportDownload,formatQaHistoryMarkdown} from '../src/modules/qa-requests/qa-report.package.ts';
import {validateQaHistory} from '../src/modules/qa-requests/qa-report.reader.ts';
import {toPublicQaRequest} from '../src/modules/qa-requests/qa-request.dto.ts';
import {createProjectExportPackage} from '../src/modules/data-portability/export-package.ts';
import {createAccountExportPackage} from '../src/modules/data-portability/account-export-package.ts';
import {validateProjectImportPackage} from '../src/modules/data-portability/import-package.ts';
import {validateAccountImportPackage} from '../src/modules/data-portability/account-import-package.ts';
import {createProjectExportSource} from './helpers/projectExportPackage.ts';
import {createAccountExportSource,createAccountBinaryAssets} from './helpers/accountExportPackage.ts';
import {createAccountDataPortabilityService} from '../src/modules/data-portability/account-data-portability.service.ts';
import {qaHistory,qaReportRaw,QA_REPORT_NOW} from './helpers/qaReport.ts';
import type {AssetRecord} from '../src/modules/assets/assets.types.ts';

test('QA reports whitelist provenance and separate measured results, AI interpretation and historical review',()=>{
 const history=qaHistory(),encoded=JSON.stringify(history);assert.doesNotMatch(encoded,/DO_NOT_EXPORT|signed=|#login/u);
 assert.equal(history.requests[0]?.runs[0]?.results[0]?.observedResult,'Heading seen');assert.match(formatQaHistoryMarkdown(history),/AI interpretation/u);
 assert.equal(history.historicalOnly,true);
});
test('untrusted portable history rejects authority fields and wrong versions',()=>{
 assert.throws(()=>validateQaHistory({...qaHistory(),leaseToken:'injected'}),{code:'QA_HISTORY_INVALID'});
 assert.throws(()=>validateQaHistory({...qaHistory(),schemaVersion:2}),{code:'QA_HISTORY_INVALID'});
});
test('expired binary receipts survive public DTO after their asset is deleted',()=>{
 const raw=qaReportRaw();const evidence=raw.runs[0]!.evidence[0]!;Object.assign(evidence,{kind:'SCREENSHOT',assets:[{id:'binding-1',ordinal:0,asset:null,snapshot:{id:'old-asset',originalName:'proof.png',checksumSha256:'hash'},unavailableReason:'EXPIRED'}]});
 const dto=toPublicQaRequest(raw) as {runs:Array<{evidence:Array<{assets:Array<{asset:{status:string;originalName:string}}>}>}>};
 assert.equal(dto.runs[0]?.evidence[0]?.assets[0]?.asset.status,'EXPIRED');assert.equal(dto.runs[0]?.evidence[0]?.assets[0]?.asset.originalName,'proof.png');
});
test('JSON, Markdown and bounded ZIP are versioned and every file hash verifies',()=>{
 const bundle={history:qaHistory(),entries:new Map<string,Uint8Array>(),totalBytes:0};
 assert.equal(JSON.parse(createQaReportDownload(bundle,'JSON').bytes.toString()).schemaVersion,1);
 assert.match(createQaReportDownload(bundle,'MARKDOWN').bytes.toString(),/Expected: Heading visible/u);
 const files=unzipSync(createQaReportDownload(bundle,'ZIP').bytes),manifest=JSON.parse(strFromU8(files['manifest.json']!));
 for(const file of manifest.files)assert.equal(createHash('sha256').update(files[file.path]!).digest('hex'),file.sha256);
});
test('project portable QA uses version 3 and round-trips into inert history',()=>{
 const source=createProjectExportSource();source.qaHistory=qaHistory();const exported=createProjectExportPackage(source,{includeChats:true},QA_REPORT_NOW);
 const imported=validateProjectImportPackage(exported.archive);assert.equal(imported.project.qaHistory?.requests[0]?.recordOrigin,'IMPORTED_RECORD');
 assert.equal(imported.project.qaHistory?.requests[0]?.reviews[0]?.decision,'APPROVED');assert.equal(imported.project.qaHistory?.historicalOnly,true);
 assert.ok(imported.warnings.some(w=>w.includes('No execution')));assert.equal(imported.formatVersion,'3.0');
});
test('account portable QA round-trips as inert history',()=>{
 const source=createAccountExportSource();source.projects[0]!.qaHistory=qaHistory();source.projects[0]!.qaHistory!.projectId=source.projects[0]!.id;
 const imported=validateAccountImportPackage(createAccountExportPackage(source,QA_REPORT_NOW).archive);
 assert.equal(imported.importKind,'account_archive');if(imported.importKind==='account_archive')assert.equal(imported.projects[0]?.qaHistory?.historicalOnly,true);
});

const bytes=new TextEncoder().encode('fixture text');
function binaryFixture(content=bytes,mimeType='text/plain',name='proof.txt'){
 const checksum=createHash('sha256').update(content).digest('base64');
 const raw=qaReportRaw(),asset={id:'asset-1',ownerId:'user-1',projectId:'project-1',objectKey:'PRIVATE_KEY',purpose:'QA_EVIDENCE',status:'READY',originalName:name,declaredMimeType:mimeType,detectedMimeType:mimeType,expectedSizeBytes:content.length,sizeBytes:content.length,checksumSha256:checksum,etag:null,uploadExpiresAt:null,validationStartedAt:null,readyAt:QA_REPORT_NOW,createdAt:QA_REPORT_NOW,updatedAt:QA_REPORT_NOW,evidenceExpiresAt:new Date(QA_REPORT_NOW.getTime()+1000)} satisfies AssetRecord;
 Object.assign(raw.runs[0]!.evidence[0]!,{assets:[{id:'binding-1',ordinal:0,asset,snapshot:null}]});
 return {history:{...qaHistory(),requests:[toQaReportRequest(raw,QA_REPORT_NOW)]},sources:[{bindingId:'binding-1',asset}],storage:{async readObject(){return {bytes:content,metadata:{contentLength:content.length,contentType:mimeType,checksumSha256:checksum,etag:null}};}}};
}

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
test('account export service round-trips a QA-only image and keeps imported history inert',async()=>{
 const f=binaryFixture(png,'image/png','proof.png'),source=createAccountExportSource();
 source.projects[0]!.qaHistory=f.history;source.projects[0]!.qaBinarySources=f.sources;
 const service=createAccountDataPortabilityService({repository:{async findAccountExportData(){return source;}},storage:f.storage,now:()=>QA_REPORT_NOW});
 const exported=await service.exportAccountData(source.id),imported=validateAccountImportPackage(exported.archive);
 assert.equal(exported.manifest.formatVersion,'3.0');assert.equal(exported.manifest.contains.privateAssetFiles,true);assert.equal(exported.manifest.counts.binaryAssets,0);
 assert.equal(imported.importKind,'account_archive');if(imported.importKind!=='account_archive')return;
 assert.equal(imported.binaryAssets.length,0);
 const receipt=imported.projects[0]?.qaHistory?.requests[0]?.runs[0]?.evidence[0]?.binaries[0];
 assert.equal(receipt?.availability,'NOT_INCLUDED');assert.equal(receipt?.path,null);assert.equal(receipt?.checksumSha256,f.sources[0]!.asset.checksumSha256);
 assert.ok(imported.projects[0]?.qaHistory?.requests.every(request=>request.recordOrigin==='IMPORTED_RECORD'));
});
test('account v3 accepts mixed legacy and QA files and rejects false or unreferenced private-file claims',async()=>{
 const f=binaryFixture(png,'image/png','proof.png'),source=createAccountExportSource();source.projects[0]!.qaHistory=f.history;
 const bundle=await collectQaReportBinaries(source.id,f.history,f.sources,f.storage,()=>QA_REPORT_NOW,undefined,'qa-files/project-001'),bundles=new Map([[source.projects[0]!.id,bundle]]);
 const mixed=createAccountExportPackage(source,QA_REPORT_NOW,createAccountBinaryAssets(),bundles);
 const parsed=validateAccountImportPackage(mixed.archive);assert.equal(parsed.importKind,'account_archive');if(parsed.importKind==='account_archive')assert.equal(parsed.binaryAssets.length,1);
 for(const hasFiles of [false,true]){
  const archive=createAccountExportPackage(source,QA_REPORT_NOW,undefined,hasFiles?bundles:undefined).archive,entries=unzipSync(archive),manifest=JSON.parse(strFromU8(entries['manifest.json']!));
  manifest.contains.privateAssetFiles=!hasFiles;
  if(!hasFiles){const path='qa-files/project-001/001-stray.png';entries[path]=png;manifest.files.push({path,sizeBytes:png.length,sha256:createHash('sha256').update(png).digest('hex')});}
  entries['manifest.json']=strToU8(JSON.stringify(manifest));
  assert.throws(()=>validateAccountImportPackage(Buffer.from(zipSync(entries))),{code:'ACCOUNT_IMPORT_PACKAGE_INVALID'});
 }
 const entries=unzipSync(createAccountExportPackage(source,QA_REPORT_NOW,undefined,bundles).archive),path=[...bundle.entries.keys()][0]!,changed=Uint8Array.from(png);changed[changed.length-1]=changed[changed.length-1]!^1;entries[path]=changed;
 const manifest=JSON.parse(strFromU8(entries['manifest.json']!));manifest.files.find((file:{path:string})=>file.path===path).sha256=createHash('sha256').update(changed).digest('hex');entries['manifest.json']=strToU8(JSON.stringify(manifest));
 assert.throws(()=>validateAccountImportPackage(Buffer.from(zipSync(entries))),{code:'QA_HISTORY_IMPORT_INVALID'});
});
test('QA binary collector reads sequentially, verifies checksums and never exports object keys',async()=>{
 const f=binaryFixture(),bundle=await collectQaReportBinaries('user-1',f.history,f.sources,f.storage,()=>QA_REPORT_NOW);
 assert.equal(bundle.entries.size,1);assert.equal(bundle.history.requests[0]?.runs[0]?.evidence[0]?.binaries[0]?.availability,'AVAILABLE');assert.doesNotMatch(JSON.stringify(bundle.history),/PRIVATE_KEY/u);
});
test('v3 QA image files verify on import, while their receipts become inert file gaps',async()=>{
 const f=binaryFixture(),bundle=await collectQaReportBinaries('user-1',f.history,f.sources,f.storage,()=>QA_REPORT_NOW),source=createProjectExportSource();source.qaHistory=bundle.history;
 const pkg=createProjectExportPackage(source,{includeChats:false},QA_REPORT_NOW,undefined,bundle),parsed=validateProjectImportPackage(pkg.archive);
 assert.equal(parsed.formatVersion,'3.0');assert.equal(parsed.project.binaryAssets.length,0);
 assert.equal(parsed.project.qaHistory?.requests[0]?.runs[0]?.evidence[0]?.binaries[0]?.availability,'NOT_INCLUDED');assert.equal(parsed.project.qaHistory?.requests[0]?.runs[0]?.evidence[0]?.binaries[0]?.path,null);
});
test('expiry during a file read is reported as a gap',async()=>{
 const f=binaryFixture();let now=QA_REPORT_NOW;
 const bundle=await collectQaReportBinaries('user-1',f.history,f.sources,{async readObject(){now=new Date(now.getTime()+1001);return f.storage.readObject();}},()=>now);
 assert.equal(bundle.entries.size,0);assert.equal(bundle.history.requests[0]?.runs[0]?.evidence[0]?.binaries[0]?.availability,'EXPIRED');
});
test('wrong owner, missing object, changed bytes and byte ceiling produce explicit gaps',async()=>{
 for(const mode of ['owner','missing','changed','limit']){const f=binaryFixture();if(mode==='owner')f.sources[0]!.asset.ownerId='other';
  const bundle=await collectQaReportBinaries('user-1',f.history,f.sources,{async readObject(){if(mode==='missing')throw Error('Unavailable');const stored=await f.storage.readObject();return mode==='changed'?{...stored,bytes:new Uint8Array(bytes.length)}:stored;}},()=>QA_REPORT_NOW,mode==='limit'?0:1024);
  assert.equal(bundle.entries.size,0);assert.notEqual(bundle.history.requests[0]?.runs[0]?.evidence[0]?.binaries[0]?.availability,'AVAILABLE');
 }
});
