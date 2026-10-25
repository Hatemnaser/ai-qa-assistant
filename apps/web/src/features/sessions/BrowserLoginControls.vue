<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useI18n } from '../../i18n/useI18n';
import { browserLoginRequest, type BrowserLoginStatus } from './browserLoginApi';

const props=defineProps<{projectId:string;executionId:string;scopeKey:string;active:boolean}>();
const emit=defineEmits<{stop:[]}>();
const {t}=useI18n();
const status=ref<BrowserLoginStatus|null>(null), error=ref(''), busy=ref(false), link=ref<string|null>(null);
// An unsuccessful write may have reached the server. Only an acknowledged retry
// resolves it; ordinary status polling must not silently discard the user's choice.
const pendingConsent=ref<boolean|null>(null);
const privacyKey=computed(()=>{
  if(status.value?.login.phase==='READY')return 'projects.browserLogin.readyNote';
  if(pendingConsent.value!==null)return 'projects.savedLogin.consentUnresolved';
  if(status.value?.authenticationKind==='SAVED_STATE')return 'projects.savedLogin.restoringNote';
  return status.value?.savedLogin?.consent ? 'projects.savedLogin.saveNote' : 'projects.browserLogin.private';
});
let generation=0,statusRequest=0, timer:ReturnType<typeof setInterval>|undefined, polling=false;
function clear(){generation++;if(timer)clearInterval(timer);timer=undefined;status.value=null;link.value=null;error.value='';busy.value=false;polling=false;pendingConsent.value=null;}
function current(token:number){return token===generation&&props.active;}
async function refresh(){
  if(polling||busy.value||!props.active)return;
  const token=generation,sequence=++statusRequest;polling=true;
  try{
    const value=await browserLoginRequest<BrowserLoginStatus>(props.projectId,props.executionId);
    if(!current(token)||sequence!==statusRequest)return;
    status.value=value;
    if(value.login.phase!=='LOGIN'||value.state!=='LIVE')link.value=null;
    if(value.login.phase==='NONE'){if(timer)clearInterval(timer);timer=undefined;}
  }catch(cause){
    if(!current(token))return;
    const code=(cause as {code?:string}).code;
    if(code==='BROWSER_RUNTIME_NOT_ACTIVE'){if(timer)clearInterval(timer);timer=undefined;}
    else if(code!=='BROWSER_RUNTIME_NOT_FOUND')error.value=t('projects.browserLogin.error');
  }finally{if(current(token))polling=false;}
}
watch(()=>[props.scopeKey,props.projectId,props.executionId,props.active],()=>{clear();if(props.active){void refresh();timer=setInterval(()=>void refresh(),1000);}},{immediate:true});
onBeforeUnmount(clear);
async function act(action:'begin'|'complete'|'viewer'){
  const value=status.value;if(!value||busy.value||!props.active||value.state!=='LIVE'||!value.login.controlEpoch)return;
  if(action==='complete'&&pendingConsent.value!==null)return;
  const token=generation;statusRequest++;busy.value=true;error.value='';
  try{
    if(action==='viewer'){
      const result=await browserLoginRequest<{url:string}>(props.projectId,props.executionId,'/login/viewer');
      if(current(token))link.value=result.url;
    }else{
      await browserLoginRequest(props.projectId,props.executionId,`/login/${action}`,{controlEpoch:value.login.controlEpoch,...(action==='complete'?{acknowledgeFinished:true}:{})});
      if(current(token)){link.value=null;await refresh();}
    }
  }catch{if(current(token))error.value=t('projects.browserLogin.error');}
  finally{if(current(token))busy.value=false;}
}
function consent(event:Event){
  const checkbox=event.target as HTMLInputElement, desired=checkbox.checked;
  // Restore the native DOM immediately, even if Vue's last :checked value has
  // not changed. The visible choice always represents confirmed server state.
  checkbox.checked=status.value?.savedLogin?.consent===true;
  if(pendingConsent.value!==null)return;
  return saveConsent(desired);
}
async function saveConsent(desired:boolean){
  const value=status.value;
  if(!props.active||value?.state!=='LIVE'||value.login.phase!=='LOGIN'||!value.savedLogin?.enabled||!value.login.controlEpoch||busy.value)return;
  const token=generation;statusRequest++;busy.value=true;error.value='';pendingConsent.value=desired;
  try{
    const result=await browserLoginRequest<BrowserLoginStatus>(props.projectId,props.executionId,'/login/save-consent',{controlEpoch:value.login.controlEpoch,saveLogin:desired});
    if(!current(token))return;
    if(result.executionId!==value.executionId||result.login.controlEpoch!==value.login.controlEpoch||result.savedLogin?.consent!==desired)throw new Error('Unconfirmed consent');
    status.value=result;pendingConsent.value=null;
  }
  catch{if(current(token))error.value=t('projects.savedLogin.consentUnresolved');}
  finally{if(current(token))busy.value=false;}
}
function retryConsent(){if(pendingConsent.value!==null)return saveConsent(pendingConsent.value);}
</script>

<template>
  <section v-if="status && status.login.phase!=='NONE'" class="test-session__action" :aria-label="t('projects.browserLogin.title')">
    <strong>{{t('projects.browserLogin.title')}}</strong>
    <p :role="error===t(privacyKey) ? 'alert' : undefined">{{t(privacyKey)}}</p>
    <p role="status">{{status.state==='LIVE' ? t(`projects.browserLogin.phase.${status.login.phase}`) : t('projects.browserLogin.stopping')}}</p>
    <div class="d-flex flex-wrap gap-2">
      <button v-if="status.state==='LIVE' && status.login.phase==='WAITING' && status.authenticationKind!=='SAVED_STATE'" type="button" class="btn btn-primary" :disabled="busy" @click="act('begin')">{{t('projects.browserLogin.begin')}}</button>
      <template v-if="status.state==='LIVE' && status.login.phase==='LOGIN'">
        <button type="button" class="btn btn-secondary" :disabled="busy" @click="act('viewer')">{{t('projects.browserLogin.link')}}</button>
        <a v-if="link" class="btn btn-secondary" :href="link" target="_blank" rel="noopener noreferrer">{{t('projects.browserLogin.open')}}</a>
        <button type="button" class="btn btn-primary" :disabled="busy || pendingConsent!==null" @click="act('complete')">{{t('projects.browserLogin.complete')}}</button>
      </template>
      <button v-if="status.state==='LIVE'" type="button" class="btn btn-secondary" :disabled="busy" @click="emit('stop')">{{t('projects.browserLogin.stop')}}</button>
    </div>
    <label v-if="status.state==='LIVE' && status.login.phase==='LOGIN' && status.savedLogin?.enabled" class="form-check mt-2">
      <input type="checkbox" class="form-check-input" :checked="status.savedLogin.consent" :disabled="busy || pendingConsent!==null" @change="consent">
      <span class="form-check-label">{{t('projects.savedLogin.consent')}}</span>
    </label>
    <button v-if="status.state==='LIVE' && status.login.phase==='LOGIN' && pendingConsent!==null" type="button" class="btn btn-secondary" :disabled="busy" @click="retryConsent">{{t('projects.savedLogin.retryConsent')}}</button>
    <p v-if="status.savedLogin?.savedLoginId" role="status">{{t('projects.savedLogin.saved')}}</p>
    <p v-if="error && error!==t(privacyKey)" role="alert">{{error}}</p>
  </section>
</template>
