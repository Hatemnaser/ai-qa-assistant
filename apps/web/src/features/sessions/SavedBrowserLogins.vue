<script setup lang="ts">
import {ref,watch,onBeforeUnmount} from 'vue';
import {csrfFetch} from '../../api/csrf';
import {API_BASE_URL} from '../../config/api';
import {useI18n} from '../../i18n/useI18n';
const props=defineProps<{projectId:string;scopeKey:string}>(),{t}=useI18n();
type State={id:string;expiresAt:string;revoked:boolean;targetLabel?:string|null;targetUrl?:string|null};
const states=ref<State[]>([]),error=ref(''),busy=ref(false),available=ref(false);let generation=0,scopeGeneration=0;
const url=()=>`${API_BASE_URL}/api/projects/${encodeURIComponent(props.projectId)}/saved-browser-logins`;
async function refresh(reset=false){const token=++generation;error.value='';if(reset){states.value=[];available.value=false;}
  try{const response=await csrfFetch(url(),{credentials:'include'});if(token!==generation)return;if(!response.ok){if([401,403,409].includes(response.status)){states.value=[];available.value=false;}else error.value=t('projects.savedLogin.error');return;}const data=await response.json();if(token===generation){states.value=data.states;available.value=true;}}
  catch{if(token===generation)error.value=t('projects.savedLogin.error');}
}
watch(()=>[props.projectId,props.scopeKey],()=>{scopeGeneration++;busy.value=false;void refresh(true);},{immediate:true});onBeforeUnmount(()=>{generation++;scopeGeneration++;});
async function revoke(id:string){if(busy.value)return;const token=scopeGeneration;busy.value=true;error.value='';
  try{const response=await csrfFetch(url()+'/'+encodeURIComponent(id)+'/revoke',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({acknowledgeRevocation:true})});if(!response.ok)throw Error();if(token===scopeGeneration)await refresh();}
  catch{if(token===scopeGeneration)error.value=t('projects.savedLogin.error');}finally{if(token===scopeGeneration)busy.value=false;}
}
</script>
<template>
  <details v-if="available || error" class="test-session__action">
    <summary>{{t('projects.savedLogin.title')}}</summary><p>{{t('projects.savedLogin.note')}}</p>
    <button type="button" class="btn btn-secondary" :disabled="busy" @click="refresh()">{{t('testSessions.refresh')}}</button>
    <p v-if="!states.length">{{t('projects.savedLogin.empty')}}</p>
    <div v-for="state in states" :key="state.id" class="d-flex flex-wrap gap-2 align-items-center mb-2">
      <span>{{state.targetLabel || state.targetUrl || state.id.slice(0,8)}} · {{state.targetUrl}} · {{state.id.slice(0,8)}} · {{new Date(state.expiresAt).toLocaleString()}}</span>
      <span v-if="state.revoked">{{t('projects.savedLogin.revoked')}}</span>
      <button v-else type="button" class="btn btn-secondary" :disabled="busy" @click="revoke(state.id)">{{t('projects.savedLogin.revoke')}}</button>
    </div>
    <p v-if="error" role="alert">{{error}}</p>
  </details>
</template>
