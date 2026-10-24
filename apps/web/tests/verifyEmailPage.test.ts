import assert from 'node:assert/strict';
import {it} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {ModuleKind,transpileModule} from 'typescript';
import {compileScript,parse} from 'vue/compiler-sfc';
import * as vue from 'vue';
import {useAuthRequest} from '../src/features/auth/useAuthRequest.ts';
const file=new URL('../src/features/auth/pages/VerifyEmailPage.vue',import.meta.url);
const js=transpileModule(compileScript(parse(await readFile(file,'utf8'),{filename:fileURLToPath(file)}).descriptor,{id:'verify-email-test'}).content,{compilerOptions:{module:ModuleKind.CommonJS}}).outputText;
function mount(token:string,request:(token:string,password:string)=>Promise<unknown>){
 const module={exports:{} as {default:{setup:(props:unknown,context:unknown)=>unknown}}};
 new Function('require','module','exports',js)((id:string)=>{
  if(id==='vue')return vue;
  if(id.includes('useI18n'))return {useI18n:()=>({t:(key:string)=>key})};
  if(id.includes('authApi'))return {verifyEmail:request};
  if(id.includes('authToken'))return {consumeAuthTokenFromLocation:()=>token};
  if(id.includes('useAuthRequest'))return {useAuthRequest};
  if(id.includes('passwordPolicy'))return {PASSWORD_MIN_LENGTH:15,PASSWORD_MAX_LENGTH:128};
  if(id.endsWith('.vue'))return {};
  throw Error('Unexpected dependency: '+id);
 },module,module.exports);
 return module.exports.default.setup({themeToggleLabel:'Theme'},{expose(){},emit(){}}) as {
  newPassword:vue.Ref<string>;confirmPassword:vue.Ref<string>;verified:vue.Ref<boolean>;errorMessage:vue.Ref<string>;isSubmitting:vue.Ref<boolean>;submitVerification:()=>Promise<void>;
 };
}
it('does not automatically activate on opening a link; requires an explicit matching credential',async()=>{
 const calls:unknown[]=[];const view=mount('mailbox-proof',async(...args)=>{calls.push(args);});await vue.nextTick();assert.equal(calls.length,0);
 view.newPassword.value='Chosen owner passphrase';view.confirmPassword.value='Different passphrase';await view.submitVerification();assert.equal(calls.length,0);assert.equal(view.errorMessage.value,'errors.auth.resetMismatch');
 view.confirmPassword.value=view.newPassword.value;await view.submitVerification();assert.deepEqual(calls,[['mailbox-proof','Chosen owner passphrase']]);assert.equal(view.verified.value,true);assert.equal(view.newPassword.value,'');assert.equal(view.confirmPassword.value,'');
});
it('a missing proof cannot send a password or show activation success',async()=>{
 let calls=0;const view=mount('',async()=>{calls++;});await view.submitVerification();assert.equal(calls,0);assert.equal(view.verified.value,false);assert.equal(view.errorMessage.value,'errors.auth.verifyMissingToken');
});
it('a failed activation preserves input for an explicit retry and cannot submit twice while pending',async()=>{
 let calls=0,release!:()=>void;const pending=new Promise<void>(r=>release=r);const view=mount('mailbox-proof',async()=>{calls++;if(calls===1){await pending;throw Error('Temporary persistence failure');}});
 view.newPassword.value=view.confirmPassword.value='Chosen owner passphrase';const first=view.submitVerification();assert.equal(view.isSubmitting.value,true);await view.submitVerification();assert.equal(calls,1);release();await first;
 assert.equal(view.verified.value,false);assert.equal(view.newPassword.value,'Chosen owner passphrase');assert.equal(view.errorMessage.value,'Temporary persistence failure');
 await view.submitVerification();assert.equal(calls,2);assert.equal(view.verified.value,true);assert.equal(view.errorMessage.value,'');
});
