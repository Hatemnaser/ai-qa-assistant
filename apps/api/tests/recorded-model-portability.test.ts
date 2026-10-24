import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {createAccountExportSource} from './helpers/accountExportPackage.ts';
import {createProjectExportSource} from './helpers/projectExportPackage.ts';
import {createAccountExportPackage} from '../src/modules/data-portability/account-export-package.ts';
import {createProjectExportPackage} from '../src/modules/data-portability/export-package.ts';
import {validateAccountImportPackage} from '../src/modules/data-portability/account-import-package.ts';
import {validateProjectImportPackage} from '../src/modules/data-portability/import-package.ts';

describe('recorded message models in portable archives',()=>{
 for(const kind of ['account','project'] as const)it(`${kind}: preserves native known and external original/unknown models through ZIP validation`,()=>{
  const account=createAccountExportSource(),project=createProjectExportSource();
  for(const source of [account,project]){
   const template=source.chats[0].messages[1];
   source.chats[0].messages=[
    {...template,id:'native-known',model:'gemini-2.5-flash',metadata:{imported:{archiveType:'account'}}},
    {...template,id:'external-unknown',model:'gemini-3.1-flash-lite',metadata:{imported:{provider:'chatgpt',originalModel:null}}},
    {...template,id:'external-known',model:'gemini-3.1-flash-lite',metadata:{imported:{provider:'chatgpt',originalModel:'gpt-source-model'}}},
    {...template,id:'native-failed',model:'retired-model',metadata:{isError:true,imported:{archiveType:'account'}}},
   ];
  }
  const messages=kind==='account'?readAccountMessages():validateProjectImportPackage(createProjectExportPackage(project,{includeChats:true}).archive).project.chats[0].messages;
  assert.deepEqual(messages.map(message=>message.model),['gemini-2.5-flash',null,'gpt-source-model','retired-model']);
  assert.deepEqual(messages.map(message=>message.isError),[false,false,false,true]);
  function readAccountMessages(){
   const imported=validateAccountImportPackage(createAccountExportPackage(account).archive);
   assert.equal(imported.importKind,'account_archive');
   if(imported.importKind!=='account_archive')throw new Error('Expected native account archive');
   return imported.chats[0].messages;
  }
 });
});
