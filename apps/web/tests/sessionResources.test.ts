import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import { buildSessionResources, useSessionResources, type SessionResource } from '../src/features/sessions/sessionResources';
import { useSessionResourceReader } from '../src/features/sessions/useSessionResourceReader';
import { safeBrowserViewerUrl } from '../src/features/sessions/browserViewer';
import type { QaRequestDetail, QaRun } from '../src/features/qa/types';
import type { TestSessionDetail } from '../src/features/test-sessions/types';

const scopes: EffectScope[] = [];
afterEach(() => scopes.splice(0).forEach(scope => scope.stop()));
const tick = async () => { for (let index = 0; index < 6; index++) await nextTick(); };
function detail(id = 'current', projectId = 'project'): QaRequestDetail { return { id, projectId, title: id, objective: 'Test', phase: 'RUNNING', version: 1, createdAt: '', updatedAt: '', target: 'https://example.com', environment: 'STAGING', acceptanceNotes: null, selectedArtifactId: null, contextSnapshots: [], artifacts: [], runs: [], reviews: [], events: [], operations: [] }; }
function session(): TestSessionDetail { return { id: 'session', projectId: 'project', title: 'Session', version: 1, archivedAt: null, createdAt: '', updatedAt: '', currentRequestId: 'current', messages: [], requests: [detail(), detail('past'), detail('foreign','other')], pendingProposal: null, turnStatus: null, preparation: null }; }
function resource(id='past'): SessionResource { return { id:'results:'+id, kind:'results', scopeKey:'owner:project:session', requestId:id }; }
function mount<T>(action: () => T): T { const scope=effectScope(); scopes.push(scope); return scope.run(action)!; }
function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(done=>resolve=done); return {promise,resolve}; }

describe('session resource ownership and tab lifecycle',()=>{
  it('references owned records and exposes no browser for a historical controller selection',()=>{
    const current=detail(); current.runs=[{executionJob:{id:'execution'}} as QaRun];
    const catalog=buildSessionResources('owner:project:session','project',session(),current);
    assert.equal(catalog.filter(item=>item.kind==='browser').length,1);
    assert.ok(!catalog.some(item=>item.requestId==='foreign'));
    const past=detail('past'); past.runs=current.runs;
    assert.ok(!buildSessionResources('owner:project:session','project',session(),past).some(item=>item.kind==='browser'));
    assert.equal(JSON.stringify(catalog).includes('leaseToken'),false);
  });
  it('hides without closing or losing pinned order, and closes without invoking Stop',()=>{
    const scope=ref('owner:project:session'),catalog=ref(buildSessionResources(scope.value,'project',session(),detail()));
    const state=mount(()=>useSessionResources(scope,catalog));
    state.open('sources');state.open('results:past');state.pin('results:past');
    assert.equal(state.tabs.value[0]!.id,'results:past');state.hide();
    assert.equal(state.openIds.value.length,2);state.show();assert.equal(state.selected.value?.id,'results:past');
    state.close('results:past');assert.equal(state.selected.value?.id,'sources');assert.deepEqual(state.pinnedIds.value,[]);
  });
  for(const boundary of ['owner','project','session'])it(`clears all retained references synchronously on ${boundary} changes`,()=>{
    const scope=ref('owner:project:session'),catalog=ref([resource()]);const state=mount(()=>useSessionResources(scope,catalog));
    state.open(resource().id);state.pin(resource().id);state.expanded.value=true;
    scope.value=boundary+':changed';assert.deepEqual(state.openIds.value,[]);assert.equal(state.selected.value,null);assert.equal(state.hidden.value,true);assert.equal(state.expanded.value,false);
  });
  it('bounds retained readers and refuses foreign descriptors or deleted resources',()=>{
    const scope=ref('owner:project:session'),catalog=ref(Array.from({length:13},(_,index)=>resource(String(index))));
    const state=mount(()=>useSessionResources(scope,catalog));for(let index=0;index<12;index++)assert.equal(state.open(resource(String(index)).id),true);
    assert.equal(state.open(resource('12').id),false);assert.equal(state.limitReached.value,true);
    catalog.value=catalog.value.filter(item=>item.id!==resource('0').id);assert.equal(state.openIds.value.length,11);
    catalog.value.push({...resource('foreign'),scopeKey:'other'});assert.equal(state.open(resource('foreign').id),false);
  });
});

describe('independent session resource reader',()=>{
  for(const boundary of ['scope','resource','inactive','dispose'])it(`discards a delayed response after ${boundary}`,async()=>{
    const pending=deferred<QaRequestDetail>(),scope=ref(resource().scopeKey),selected=ref(resource()),active=ref(true);
    let effect:EffectScope;const reader=(()=>{effect=effectScope();scopes.push(effect);return effect.run(()=>useSessionResourceReader({scopeKey:scope,resource:selected,projectId:'project',active},()=>pending.promise))!;})();
    if(boundary==='scope')scope.value='other';if(boundary==='resource')selected.value=resource('different');if(boundary==='inactive')active.value=false;if(boundary==='dispose')effect!.stop();
    pending.resolve(detail('past'));await tick();assert.equal(reader.detail.value,null);
  });
  for(const mismatch of ['request','project'])it(`rejects a wrong ${mismatch} response and allows an acknowledged retry`,async()=>{
    let wrong=true;const reader=mount(()=>useSessionResourceReader({scopeKey:resource().scopeKey,resource:resource(),projectId:'project',active:true},async()=>detail(wrong&&mismatch==='request'?'different':'past',wrong&&mismatch==='project'?'other':'project')));
    await tick();assert.equal(reader.failed.value,true);assert.equal(reader.detail.value,null);
    wrong=false;await reader.refresh();assert.equal((reader.detail.value as QaRequestDetail | null)?.id,'past');assert.equal(reader.failed.value,false);
  });
  it('retains its run when a newer run appears and never switches the active controller',async()=>{
    const old={id:'old'} as QaRun,newer={id:'new'} as QaRun;let response={...detail('past'),runs:[old]};
    const reader=mount(()=>useSessionResourceReader({scopeKey:resource().scopeKey,resource:resource(),projectId:'project',active:true},async()=>response));
    await tick();assert.equal(reader.runId.value,'old');response={...response,runs:[newer,old]};await reader.refresh();assert.equal(reader.run.value?.id,'old');
    response={...response,runs:[newer]};await reader.refresh();assert.equal(reader.runId.value,'old');assert.equal(reader.run.value,null);
  });
});

it('accepts only signed HTTPS viewer bootstrap URLs (loopback HTTP for local fixtures)',()=>{
  assert.equal(safeBrowserViewerUrl('https://viewer.example.com/open#signed','https://app.example.com'),'https://viewer.example.com/open#signed');
  for(const value of ['javascript:alert(1)','https://user:pass@viewer.example.com/open#signed','https://viewer.example.com/open?ticket=secret#signed','https://viewer.example.com/open','http://viewer.example.com/open#signed'])assert.equal(safeBrowserViewerUrl(value,'https://app.example.com'),null);
  assert.ok(safeBrowserViewerUrl('http://127.0.0.1:9000/open#test','http://127.0.0.1:5173'));
});
